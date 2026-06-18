// W6 (mock) — hosting.deploy gating + Vercel webhook settlement + custom domain.
//
// Asserts:
//   * hosting.deploy is GATED + ASYNC: a missing token denies; a valid token
//     starts a pending W1 operation (202/accepted) and the op is NOT metered.
//   * the Vercel webhook settles the op to live (deployment.succeeded) / failed
//     (deployment.error) and updates the Deployment row; it is deduped (a
//     redelivery is a no-op) and resolves the tenant from the deployment.
//   * custom-domain mapping is gated by the customDomain entitlement.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued, __resetApprovalStore } from "@/integrations/core/approvalStore";
import {
  getOperation,
  __resetOperationStore,
} from "@/integrations/core/operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import {
  createDeployment,
  mockProviderDeploymentId,
} from "./service";
import { connectCustomDomain } from "./customDomain";
import { POST as vercelWebhook } from "@/app/api/webhooks/vercel/route";

const repos = memoryRepositories;
const TENANT = DEV_TENANT_ID;

async function approve(
  verb: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<string> {
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey: key, nonce, expiresAt });
  await recordIssued({
    nonce,
    tenantId: TENANT,
    verb,
    payloadHash,
    idempotencyKey: key,
    issuedAt: Date.now(),
    expiresAt,
  });
  return token;
}

function vercelRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/vercel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("W6 hosting.deploy + Vercel webhook (mock)", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("hosting.deploy denies without a token (gated)", async () => {
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.deploy",
        business: initialBusiness,
        payload: { slug: "joes-shop" },
        idempotencyKey: "dep-1",
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("missing_token");
  });

  it("hosting.deploy with a valid token starts a pending op, not metered", async () => {
    const payload = { slug: "joes-shop" };
    const token = await approve("hosting.deploy", payload, "dep-ok");
    const balanceBefore = await repos.wallet.getBalance(TENANT);
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.deploy",
        business: initialBusiness,
        payload,
        idempotencyKey: "dep-ok",
        approvalToken: token,
        settleDelayMs: 60_000, // stay pending for the test
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    expect(outcome.operation.status).toBe("pending");
    expect(outcome.operation.target).toBe("joes-shop");
    // Static hosting is plan-included (§8): the wallet was NOT debited.
    expect(await repos.wallet.getBalance(TENANT)).toBe(balanceBefore);
  });

  it("the Vercel webhook settles the op to live + updates the Deployment, deduped", async () => {
    // Start a pending deploy op + a Deployment row bound to it.
    const payload = { slug: "joes-shop" };
    const token = await approve("hosting.deploy", payload, "dep-live");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.deploy",
        business: initialBusiness,
        payload,
        idempotencyKey: "dep-live",
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    const opId = outcome.operation.id;
    const deployment = await createDeployment(repos, {
      tenantId: TENANT,
      slug: "joes-shop",
      operationId: opId,
      version: 1,
    });
    const providerDeploymentId = mockProviderDeploymentId(opId);

    const res = await vercelWebhook(
      vercelRequest({
        id: "evt-1",
        type: "deployment.succeeded",
        payload: { deployment: { id: providerDeploymentId } },
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);

    // The op is now succeeded and the Deployment is live with a url.
    const op = await getOperation(opId, TENANT);
    expect(op?.status).toBe("succeeded");
    const settled = await repos.deployments.get(TENANT, deployment.id);
    expect(settled?.status).toBe("live");
    expect(settled?.url).toBeTruthy();

    // Redelivery of the SAME event id is deduped (no re-apply).
    const res2 = await vercelWebhook(
      vercelRequest({
        id: "evt-1",
        type: "deployment.succeeded",
        payload: { deployment: { id: providerDeploymentId } },
      }),
    );
    const json2 = await res2.json();
    expect(json2.deduped).toBe(true);
  });

  it("the Vercel webhook settles the op + deployment to FAILED on deployment.error", async () => {
    const payload = { slug: "shop-b" };
    const token = await approve("hosting.deploy", payload, "dep-fail");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.deploy",
        business: initialBusiness,
        payload,
        idempotencyKey: "dep-fail",
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    if (outcome.status !== "accepted") throw new Error("expected accepted");
    const opId = outcome.operation.id;
    const deployment = await createDeployment(repos, {
      tenantId: TENANT,
      slug: "shop-b",
      operationId: opId,
      version: 1,
    });

    const res = await vercelWebhook(
      vercelRequest({
        id: "evt-err",
        type: "deployment.error",
        payload: { deployment: { id: mockProviderDeploymentId(opId) } },
      }),
    );
    expect((await res.json()).ok).toBe(true);

    const op = await getOperation(opId, TENANT);
    expect(op?.status).toBe("failed");
    const settled = await repos.deployments.get(TENANT, deployment.id);
    expect(settled?.status).toBe("failed");
  });

  it("an unresolved deployment id acks without settling anything", async () => {
    const res = await vercelWebhook(
      vercelRequest({
        id: "evt-unknown",
        type: "deployment.succeeded",
        payload: { deployment: { id: "dpl_does_not_exist" } },
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.unresolved).toBe(true);
  });

  it("custom-domain mapping is DENIED for a free tenant (entitlement-gated)", async () => {
    // Free tenant (no plan): dns.write requires customDomain → denied.
    const result = await connectCustomDomain(repos, {
      tenantId: TENANT,
      actorId: "u",
      business: initialBusiness,
      slug: "joes-shop",
      hostname: "joes.co.za",
    });
    expect(result.status).toBe("denied");
  });

  it("custom-domain mapping CONNECTS for an entitled tenant", async () => {
    await activatePlan(repos, TENANT, "growth"); // includes customDomain
    const result = await connectCustomDomain(repos, {
      tenantId: TENANT,
      actorId: "u",
      business: initialBusiness,
      slug: "joes-shop",
      hostname: "joes.co.za",
    });
    expect(result.status).toBe("connected");
  });
});

describe("W6 Vercel webhook fail-closed", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
  });
  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined)
      delete (process.env as Record<string, unknown>).NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = ORIGINAL_NODE_ENV;
    delete process.env.LAUNCH_DESK_MOCK;
    delete process.env.VERCEL_WEBHOOK_SECRET;
  });

  it("rejects (401) in production when the secret is unset", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.LAUNCH_DESK_MOCK;
    delete process.env.VERCEL_WEBHOOK_SECRET;
    const res = await vercelWebhook(
      vercelRequest({ id: "evt-x", type: "deployment.succeeded" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_configured");
  });
});
