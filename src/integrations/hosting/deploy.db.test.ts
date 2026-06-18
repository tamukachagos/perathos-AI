// W6 — Postgres-backed deploy. Runs in the db-tests CI job (DATABASE_URL set,
// app role non-superuser/non-BYPASSRLS so RLS is enforced). Asserts:
//   * the SiteRepo + Deployment records are TENANT-SCOPED under RLS (tenant B
//     cannot see tenant A's repo/deployment; the base client sees neither),
//   * the deploy op settles EXACTLY ONCE via the Vercel webhook path (a
//     redelivery is deduped; the op stays succeeded; the Deployment stays live).

import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import { getRepositories } from "@/lib/db";
import { __resetStoreFactory } from "@/integrations/core/stores";
import {
  getOperation,
  startOperation,
} from "@/integrations/core/operationStore";
import {
  createDeployment,
  mockProviderDeploymentId,
} from "./service";
import { POST as vercelWebhook } from "@/app/api/webhooks/vercel/route";
import { ensureSiteRepo, commitPublish } from "@/integrations/github/service";

function vercelRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/vercel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("W6 deploy (Postgres) — tenant-scoped records + exactly-once settle", () => {
  beforeEach(async () => {
    __resetStoreFactory();
    await resetDb();
  });

  it("SiteRepo + Deployment are tenant-scoped under RLS", async () => {
    const repos = await getRepositories();

    await ensureSiteRepo(repos, TENANT_A, "a-shop");
    await commitPublish(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      version: 1,
      payloadHash: "h",
    });
    const op = await startOperation({
      tenantId: TENANT_A,
      verb: "hosting.deploy",
      target: "a-shop",
      idempotencyKey: "a-dep-1",
      settleDelayMs: 60_000,
    });
    await createDeployment(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      operationId: op.id,
      version: 1,
    });

    // Tenant A sees its own repo + deployment.
    expect(await repos.siteRepos.list(TENANT_A)).toHaveLength(1);
    expect(await repos.deployments.list(TENANT_A)).toHaveLength(1);

    // Tenant B sees NONE (RLS + app scope).
    expect(await repos.siteRepos.getBySlug(TENANT_B, "a-shop")).toBeNull();
    expect(await repos.deployments.list(TENANT_B)).toHaveLength(0);

    // The unscoped base client (FORCE RLS, NULL tenant) sees neither.
    expect((await prisma.siteRepo.findMany({})).length).toBe(0);
    expect((await prisma.deployment.findMany({})).length).toBe(0);
  });

  it("the deploy op settles exactly once via the webhook path", async () => {
    const repos = await getRepositories();
    const op = await startOperation({
      tenantId: TENANT_A,
      verb: "hosting.deploy",
      target: "a-shop",
      idempotencyKey: "a-dep-2",
      settleDelayMs: 60_000,
    });
    const deployment = await createDeployment(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      operationId: op.id,
      version: 1,
    });
    const providerDeploymentId = mockProviderDeploymentId(op.id);

    // First delivery settles op -> succeeded, deployment -> live.
    const res1 = await vercelWebhook(
      vercelRequest({
        id: "wh-evt-1",
        type: "deployment.succeeded",
        payload: { deployment: { id: providerDeploymentId } },
      }),
    );
    expect((await res1.json()).ok).toBe(true);
    expect((await getOperation(op.id, TENANT_A))?.status).toBe("succeeded");
    expect((await repos.deployments.get(TENANT_A, deployment.id))?.status).toBe(
      "live",
    );

    // Redelivery is deduped (exactly-once): nothing re-applies.
    const res2 = await vercelWebhook(
      vercelRequest({
        id: "wh-evt-1",
        type: "deployment.succeeded",
        payload: { deployment: { id: providerDeploymentId } },
      }),
    );
    expect((await res2.json()).deduped).toBe(true);

    // Still succeeded / live, and only ONE webhook_events row exists for it.
    expect((await getOperation(op.id, TENANT_A))?.status).toBe("succeeded");
    expect((await repos.deployments.get(TENANT_A, deployment.id))?.status).toBe(
      "live",
    );
    const events = await prisma.webhookEvent.findMany({
      where: { provider: "vercel", eventId: "wh-evt-1" },
    });
    expect(events).toHaveLength(1);

    // Cross-tenant: the resolver only finds A's deployment, not B's view.
    const resolvedForOther = await withTenant(TENANT_B, () =>
      repos.deployments.getByOperationId(TENANT_B, op.id),
    );
    expect(resolvedForOther).toBeNull();
  });
});
