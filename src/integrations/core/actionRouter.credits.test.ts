// W2 — ActionRouter credit gate (mock / DB-free). A cost-bearing verb is denied
// with `insufficient_credits` BEFORE any work when the wallet cannot cover the
// estimate, and fails CLOSED when the wallet repo is absent. Zero-cost verbs are
// unaffected.

import { beforeEach, describe, expect, it } from "vitest";
import { executeAction } from "./actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "./approvalToken";
import { recordIssued, __resetApprovalStore } from "./approvalStore";
import { __resetOperationStore } from "./operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";

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

describe("ActionRouter — W2 credit gate", () => {
  beforeEach(async () => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
    // Entitle so the credit gate (not the entitlement gate) is what we test.
    await activatePlan(repos, TENANT, "pro");
  });

  it("DENIES insufficient_credits when the wallet can't cover the estimate", async () => {
    // Seed wallet is ~R10; domain.register estimates ~R249 → too low.
    const payload = { domain: "broke.co.za" };
    const token = await approve("domain.register", payload, "idem-broke");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-broke",
        approvalToken: token,
        now: Date.now(),
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") {
      expect(outcome.reason).toBe("insufficient_credits");
    }
  });

  it("does NOT consume the approval token when denied on credits", async () => {
    const payload = { domain: "broke2.co.za" };
    const token = await approve("domain.register", payload, "idem-broke2");
    const deps = {
      audit: repos.audit,
      subscriptions: repos.subscriptions,
      wallet: repos.wallet,
    };
    const params = {
      tenantId: TENANT,
      actorId: "u",
      verb: "domain.register",
      business: initialBusiness,
      payload,
      idempotencyKey: "idem-broke2",
      approvalToken: token,
      now: Date.now(),
    };
    const first = await executeAction(deps, params);
    expect(first.status).toBe("denied");
    // After topping up, the SAME token still works → it wasn't burned.
    await repos.wallet.credit(TENANT, 30_000_000n); // R300
    const second = await executeAction(deps, params);
    expect(second.status).toBe("accepted");
  });

  it("ALLOWS once the wallet is funded above the estimate", async () => {
    await repos.wallet.credit(TENANT, 30_000_000n); // R300 (> R249)
    const payload = { domain: "funded.co.za" };
    const token = await approve("domain.register", payload, "idem-funded");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-funded",
        approvalToken: token,
        now: Date.now(),
      },
    );
    expect(outcome.status).toBe("accepted");
  });

  it("FAILS CLOSED — a cost-bearing verb is denied when the wallet repo is absent", async () => {
    const payload = { domain: "nowallet.co.za" };
    const token = await approve("domain.register", payload, "idem-nowallet");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions }, // no wallet dep
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-nowallet",
        approvalToken: token,
        now: Date.now(),
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") {
      expect(outcome.reason).toBe("insufficient_credits");
    }
  });

  it("a ZERO-cost gated verb is unaffected by the credit gate", async () => {
    // hosting.publish has no estimate → never blocked, even with no wallet dep.
    const payload = { slug: "joes-shop" };
    const token = await approve("hosting.publish", payload, "idem-pub");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "hosting.publish",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-pub",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("allowed");
  });
});
