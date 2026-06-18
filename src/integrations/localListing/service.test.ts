import { beforeEach, describe, expect, it } from "vitest";
import { executeAction, readOperation } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued, __resetApprovalStore } from "@/integrations/core/approvalStore";
import {
  settleOperation,
  __resetOperationStore,
} from "@/integrations/core/operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import type { Business } from "@/lib/types";
import {
  deriveNap,
  napIsComplete,
  settleListingVerification,
  upsertListingForCreate,
} from "./service";

const repos = memoryRepositories;
const TENANT = DEV_TENANT_ID;

const completeBusiness: Business = {
  ...initialBusiness,
  name: "Joe's Plumbing",
  location: "Soweto, Johannesburg",
  whatsapp: "082 555 0198",
};

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

describe("W8 GBP — NAP single-source mapping", () => {
  it("derives Name/Area/Phone from the business profile (phone normalised to 27…)", () => {
    const nap = deriveNap(completeBusiness);
    expect(nap.name).toBe("Joe's Plumbing");
    expect(nap.area).toBe("Soweto, Johannesburg");
    // 082 555 0198 → 27825550198 (international form, the JSON-LD/wa.me source).
    expect(nap.phone).toBe("27825550198");
    expect(napIsComplete(nap)).toBe(true);
  });

  it("is incomplete when a NAP field is missing", () => {
    const nap = deriveNap({ ...completeBusiness, location: "" });
    expect(napIsComplete(nap)).toBe(false);
  });
});

describe("W8 GBP — gbp.create gating + async verification lifecycle", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("DENIES gbp.create for a FREE tenant (entitlement gate before the token)", async () => {
    const payload = { name: "Joe's Plumbing", area: "Soweto", phone: "27825550198", category: "Plumber" };
    const token = await approve("gbp.create", payload, "gbp-free");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "gbp.create",
        business: completeBusiness,
        payload,
        idempotencyKey: "gbp-free",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("entitlement_required");
  });

  it("requires an approval token (gated) even on a paid plan", async () => {
    await activatePlan(repos, TENANT, "growth");
    const payload = { name: "x", area: "y", phone: "27825550198", category: "Plumber" };
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "gbp.create",
        business: completeBusiness,
        payload,
        idempotencyKey: "gbp-notoken",
        // no approvalToken
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("missing_token");
  });

  it("ACCEPTS gbp.create (async 202) when entitled + approved, then settles the listing LIVE", async () => {
    await activatePlan(repos, TENANT, "growth");
    const payload = { name: "Joe's Plumbing", area: "Soweto", phone: "27825550198", category: "Plumber" };
    const token = await approve("gbp.create", payload, "gbp-ok");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "gbp.create",
        business: completeBusiness,
        payload,
        idempotencyKey: "gbp-ok",
        approvalToken: token,
        settleDelayMs: 0, // settle immediately so we can poll it live
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    const operationId = outcome.operation.id;

    // Persist the pending listing bound to the op (what the server action does).
    const listing = await upsertListingForCreate(repos, {
      tenantId: TENANT,
      business: completeBusiness,
      category: "Plumber",
      operationId,
    });
    expect(listing.status).toBe("pending_verification");

    // Poll the op (reconcile drives it succeeded), then settle the listing live.
    const op = await readOperation(operationId, TENANT);
    expect(op?.status).toBe("succeeded");
    const settled = await settleListingVerification(repos, TENANT, operationId, "live");
    expect(settled?.status).toBe("live");
    expect(settled?.googleLocationId).toBeTruthy();
  });

  it("settles the listing FAILED when the verification operation fails", async () => {
    await activatePlan(repos, TENANT, "growth");
    const operationId = "op-gbp-fail";
    const listing = await upsertListingForCreate(repos, {
      tenantId: TENANT,
      business: completeBusiness,
      category: "Plumber",
      operationId,
    });
    expect(listing.status).toBe("pending_verification");
    const settled = await settleListingVerification(repos, TENANT, operationId, "failed");
    expect(settled?.status).toBe("failed");
  });
});

// settleOperation imported above to keep the lifecycle helper's contract honest
// even though the mock reconcile drives the happy path.
void settleOperation;
