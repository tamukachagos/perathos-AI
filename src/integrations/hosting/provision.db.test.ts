// W5 — Postgres-backed managed-hosting tests. Runs in the db-tests CI job
// (DATABASE_URL set, app role non-superuser/non-BYPASSRLS so RLS is enforced).
// Asserts:
//   * HostingDeployment + ProvisioningJob are TENANT-SCOPED under RLS (tenant B
//     cannot see tenant A's rows; the base client sees neither),
//   * the provision op settles EXACTLY ONCE through the durable queue runner
//     (the deployment reaches running; a re-run of a done job is a no-op),
//   * a metering tick debits the wallet EXACTLY ONCE per tick key (idempotent).

import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import { getRepositories } from "@/lib/db";
import { __resetStoreFactory } from "@/integrations/core/stores";
import {
  getOperation,
  startOperation,
} from "@/integrations/core/operationStore";
import { sweepProvisioningQueue, sweepHostingMeter } from "./sweep";
import { enqueueProvision, meterDeploymentTick } from "./provision";

describe("W5 hosting (Postgres) — tenant-scoped + exactly-once settle/meter", () => {
  beforeEach(async () => {
    __resetStoreFactory();
    await resetDb();
  });

  it("HostingDeployment + ProvisioningJob are tenant-scoped under RLS", async () => {
    const repos = await getRepositories();
    await withTenant(TENANT_A, () => repos.wallet.credit(TENANT_A, 1_000_000_000n));

    const op = await startOperation({
      tenantId: TENANT_A,
      verb: "hosting.provision",
      target: "a-shop",
      idempotencyKey: "a-prov-1",
      settleDelayMs: 60_000,
    });
    await enqueueProvision(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      region: "us",
      planName: "starter",
      operationId: op.id,
    });

    // Tenant A sees its own deployment + job.
    expect(await repos.hostingDeployments.list(TENANT_A)).toHaveLength(1);
    expect(await repos.provisioningJobs.list(TENANT_A)).toHaveLength(1);

    // Tenant B sees NONE (RLS + app scope).
    expect(await repos.hostingDeployments.getBySlug(TENANT_B, "a-shop")).toBeNull();
    expect(await repos.hostingDeployments.list(TENANT_B)).toHaveLength(0);
    expect(await repos.provisioningJobs.list(TENANT_B)).toHaveLength(0);

    // The unscoped base client (FORCE RLS, NULL tenant) sees neither.
    expect((await prisma.hostingDeployment.findMany({})).length).toBe(0);
    expect((await prisma.provisioningJob.findMany({})).length).toBe(0);
  });

  it("the provision op settles exactly once via the durable queue", async () => {
    const repos = await getRepositories();
    await withTenant(TENANT_A, () => repos.wallet.credit(TENANT_A, 1_000_000_000n));

    const op = await startOperation({
      tenantId: TENANT_A,
      verb: "hosting.provision",
      target: "a-shop",
      idempotencyKey: "a-prov-2",
      settleDelayMs: 60_000,
    });
    await enqueueProvision(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      region: "eu",
      planName: "scale",
      operationId: op.id,
    });

    // The cross-tenant sweep runs the queued job and settles the op.
    const processed = await sweepProvisioningQueue(Date.now());
    expect(processed).toBe(1);
    expect((await getOperation(op.id, TENANT_A))?.status).toBe("succeeded");
    const dep = await repos.hostingDeployments.getBySlug(TENANT_A, "a-shop");
    expect(dep?.status).toBe("running");
    expect(dep?.tier).toBe("kubernetes");

    // Re-running the sweep does nothing (the job is done; op stays succeeded).
    expect(await sweepProvisioningQueue(Date.now())).toBe(0);
    expect((await getOperation(op.id, TENANT_A))?.status).toBe("succeeded");
  });

  it("a metering tick debits the wallet exactly once per tick", async () => {
    const repos = await getRepositories();
    await withTenant(TENANT_A, () => repos.wallet.credit(TENANT_A, 1_000_000_000n));
    await enqueueProvision(repos, {
      tenantId: TENANT_A,
      slug: "a-shop",
      region: "us",
      planName: "business",
      operationId: "a-prov-3",
    });
    await sweepProvisioningQueue(Date.now());

    const dep = await repos.hostingDeployments.getBySlug(TENANT_A, "a-shop");
    expect(dep?.status).toBe("running");
    const before = await repos.wallet.getBalance(TENANT_A);

    // First tick debits; the same tick key again is a no-op (exactly-once).
    await meterDeploymentTick(repos, dep!, "2026-06-18T09");
    const after = await repos.wallet.getBalance(TENANT_A);
    expect(after < before).toBe(true);
    await meterDeploymentTick(repos, dep!, "2026-06-18T09");
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(after);

    // The cross-tenant sweep (no session) meters running rows; a re-tick with the
    // same key (currentTickKey) does not double-debit either.
    const beforeSweep = await repos.wallet.getBalance(TENANT_A);
    await sweepHostingMeter("2026-06-18T09");
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(beforeSweep);
  });
});
