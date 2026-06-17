import { beforeEach, describe, expect, it } from "vitest";
import { executeAction } from "./actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  hashPayload,
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

function approve(verb: string, payload: Record<string, unknown>, key: string) {
  const payloadHash = hashPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey: key, nonce, expiresAt });
  recordIssued({
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

describe("ActionRouter — M6 entitlement gating", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("denies a paid verb (domain.register) for a FREE tenant — before the token check", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-free");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT,
        actorId: "dev-user",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-free",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") {
      expect(outcome.reason).toBe("entitlement_required");
    }
  });

  it("allows the same verb once the tenant is on Growth", async () => {
    await activatePlan(repos, TENANT, "growth");
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-paid");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT,
        actorId: "dev-user",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-paid",
        approvalToken: token,
        now: Date.now(), // async verb settles immediately in tests
      },
    );
    // domain.register is async → 202 accepted once entitled + approved.
    expect(outcome.status).toBe("accepted");
  });

  it("entitlement check is SKIPPED when subscriptions repo is not wired (back-compat)", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-nosub");
    const outcome = await executeAction(
      { audit: repos.audit }, // no subscriptions dep
      {
        tenantId: TENANT,
        actorId: "dev-user",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-nosub",
        approvalToken: token,
        now: Date.now(),
      },
    );
    // No entitlement gate applied → proceeds to the async accept.
    expect(outcome.status).toBe("accepted");
  });
});
