// W5 — Managed-hosting lifecycle + gating + metering tests (mock / DB-free).
// Proves:
//   * tier routing (plan → tier → backend) via provision settling to running,
//   * the provision verb is GATED + wallet-pre-flight-denied without
//     credits/entitlement (through the ActionRouter chokepoint),
//   * the metering tick debits cpu + storage EXACTLY ONCE per tick,
//   * teardown stops the meter (a torn-down deployment is no longer metered),
//   * the max-scale ceiling guardrail rejects an over-ceiling scale,
//   * the kill switch suspends a running deployment (cost-abuse stop).

import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetApprovalStore, recordIssued } from "@/integrations/core/approvalStore";
import { __resetOperationStore } from "@/integrations/core/operationStore";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import {
  enqueueProvision,
  enqueueScale,
  meterDeploymentTick,
  runProvisioningJob,
  setKillSwitch,
} from "./provision";

const repos = memoryRepositories;
const TENANT = DEV_TENANT_ID;
const SLUG = "joes-shop";

async function approve(verb: string, payload: Record<string, unknown>, key: string) {
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

/** Run the enqueued provisioning job to completion (the cron does this in prod). */
async function drainQueue() {
  const jobs = await repos.provisioningJobs.listRunnableAllTenants(Date.now());
  for (const job of jobs) {
    await runProvisioningJob(repos, job, async () => {
      /* op-settle is exercised by the DB test; here we only advance the row */
    });
  }
}

describe("W5 hosting — gating + tier routing + lifecycle", () => {
  beforeEach(async () => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("DENIES hosting.provision without the managedHosting entitlement", async () => {
    // Default Free tenant — no managedHosting. The entitlement gate fires BEFORE
    // the token is even checked.
    const payload = { slug: SLUG, region: "us", planName: "starter" };
    const token = await approve("hosting.provision", payload, "idem-ent");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.provision",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-ent",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("entitlement_required");
  });

  it("DENIES insufficient_credits when the wallet can't cover the plan (wallet pre-flight)", async () => {
    await activatePlan(repos, TENANT, "pro"); // entitled, but seed wallet is ~R10
    const payload = { slug: SLUG, region: "us", planName: "scale" }; // ~R1499
    const token = await approve("hosting.provision", payload, "idem-broke");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.provision",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-broke",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("insufficient_credits");
  });

  it("provisions through the tier backend: requested -> provisioning -> running", async () => {
    await activatePlan(repos, TENANT, "pro");
    await repos.wallet.credit(TENANT, 200_000_000n); // R2000, covers the estimate

    const payload = { slug: SLUG, region: "eu", planName: "scale" };
    const token = await approve("hosting.provision", payload, "idem-prov");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.provision",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-prov",
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;

    await enqueueProvision(repos, {
      tenantId: TENANT,
      slug: SLUG,
      region: "eu",
      planName: "scale",
      operationId: outcome.operation.id,
    });
    let dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(dep?.status).toBe("provisioning");
    expect(dep?.tier).toBe("kubernetes"); // scale → K8s tier routing

    await drainQueue();
    dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(dep?.status).toBe("running");
    expect(dep?.backendRef).toBeTruthy();
  });

  it("a container plan routes to the container tier", async () => {
    await activatePlan(repos, TENANT, "pro");
    await repos.wallet.credit(TENANT, 200_000_000n);
    await enqueueProvision(repos, {
      tenantId: TENANT,
      slug: SLUG,
      region: "us",
      planName: "starter",
      operationId: "op-c",
    });
    await drainQueue();
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(dep?.tier).toBe("container");
    expect(dep?.status).toBe("running");
  });
});

describe("W5 hosting — metering, teardown, scale ceiling, kill switch", () => {
  beforeEach(async () => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
    await activatePlan(repos, TENANT, "pro");
    await repos.wallet.credit(TENANT, 1_000_000_000n); // R10000, plenty
    await enqueueProvision(repos, {
      tenantId: TENANT,
      slug: SLUG,
      region: "eu",
      planName: "business",
      operationId: "op-prov",
    });
    const jobs = await repos.provisioningJobs.listRunnableAllTenants(Date.now());
    for (const job of jobs) {
      await runProvisioningJob(repos, job, async () => {});
    }
  });

  it("a metering tick debits cpu + storage EXACTLY ONCE per tick", async () => {
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(dep?.status).toBe("running");
    const before = await repos.wallet.getBalance(TENANT);

    const r1 = await meterDeploymentTick(repos, dep!, "2026-06-18T10");
    expect(r1.metered).toBe(true);
    const after1 = await repos.wallet.getBalance(TENANT);
    expect(after1 < before).toBe(true);

    // Same tick key again → idempotent, NO further debit.
    const r2 = await meterDeploymentTick(repos, dep!, "2026-06-18T10");
    expect(r2.metered).toBe(false);
    expect(await repos.wallet.getBalance(TENANT)).toBe(after1);

    // Exactly two usage rows for this tick (cpu + storage), not four.
    const rows = await repos.usage.listRecent(TENANT, 50);
    const tickRows = rows.filter((r) => r.idempotencyKey.includes("2026-06-18T10"));
    expect(tickRows).toHaveLength(2);
  });

  it("teardown stops the meter (a torn-down deployment is not metered)", async () => {
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    // Drive a teardown job directly through the runner.
    const job = await repos.provisioningJobs.create(TENANT, {
      deploymentId: dep!.id,
      kind: "teardown",
      operationId: "op-td",
      runAfter: Date.now(),
    });
    await runProvisioningJob(repos, job, async () => {});
    const torn = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(torn?.status).toBe("torn_down");

    // The metering tick only meters RUNNING rows → a torn-down one is skipped.
    const running = await repos.hostingDeployments.listRunningAllTenants();
    expect(running.find((d) => d.slug === SLUG)).toBeUndefined();
  });

  it("rejects a scale ABOVE the plan ceiling (cost-abuse guardrail)", async () => {
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    const overCeiling = dep!.maxReplicas + 5;
    const result = await enqueueScale(repos, {
      tenantId: TENANT,
      slug: SLUG,
      replicas: overCeiling,
      operationId: "op-scale-bad",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("exceeds_ceiling");
    // The deployment was NOT moved to scaling.
    expect((await repos.hostingDeployments.getBySlug(TENANT, SLUG))?.status).toBe(
      "running",
    );
  });

  it("allows a scale WITHIN the ceiling", async () => {
    const result = await enqueueScale(repos, {
      tenantId: TENANT,
      slug: SLUG,
      replicas: 1,
      operationId: "op-scale-ok",
    });
    expect(result.ok).toBe(true);
  });

  it("the kill switch suspends a running deployment + stops metering", async () => {
    await setKillSwitch(repos, TENANT, SLUG, true);
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    expect(dep?.status).toBe("suspended");
    expect(dep?.killSwitch).toBe(true);

    // A tick on a kill-switched deployment meters nothing + keeps it suspended.
    const r = await meterDeploymentTick(repos, dep!, "2026-06-18T11");
    expect(r.metered).toBe(false);
    expect(r.suspended).toBe(true);
  });

  it("suspends a running deployment the wallet can no longer fund (cost-safe)", async () => {
    const dep = await repos.hostingDeployments.getBySlug(TENANT, SLUG);
    // Drain the wallet so the NEXT tick cannot be funded.
    const balance = await repos.wallet.getBalance(TENANT);
    await repos.wallet.debit(TENANT, {
      kind: "test.drain",
      quantity: 1,
      unitCostMicro: balance,
      unitPriceMicro: balance,
      amountMicro: balance,
      period: "2026-06",
      idempotencyKey: "drain-1",
    });
    const r = await meterDeploymentTick(repos, dep!, "2026-06-18T12");
    expect(r.suspended).toBe(true);
    expect((await repos.hostingDeployments.getBySlug(TENANT, SLUG))?.status).toBe(
      "suspended",
    );
  });
});
