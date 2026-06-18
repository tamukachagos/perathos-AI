// W4 — Domain verbs through the ActionRouter + the read-only availability path.
// Mock / DB-free. Exercises: checkAvailability (price + availability, no charge),
// register is gated (denied w/o entitlement, denied w/o credits) and meters the
// wallet on accept, and the transfer auth-code round-trips encrypted.

import { beforeEach, describe, expect, it } from "vitest";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued, __resetApprovalStore } from "@/integrations/core/approvalStore";
import { __resetOperationStore } from "@/integrations/core/operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import {
  checkAvailabilityOptions,
  upsertDomainForTransfer,
} from "./service";
import { decryptAuthCode } from "./fieldCrypto";

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

describe("domain.checkAvailability — ungated, priced, no charge", () => {
  beforeEach(() => __resetMemoryStore());

  it("returns .co.za + .com options with ZAR prices and availability", async () => {
    const res = await checkAvailabilityOptions("joes-plumbing");
    expect(res.options.map((o) => o.hostname)).toEqual([
      "joes-plumbing.co.za",
      "joes-plumbing.com",
    ]);
    expect(res.options[0].priceZar).toMatch(/^R\d/);
    expect(typeof res.options[0].available).toBe("boolean");
    // No wallet movement: the seed balance is unchanged.
    expect(await repos.wallet.getBalance(TENANT)).toBe(1_000_000n);
  });

  it("rejects an internal/invalid base with no options", async () => {
    const res = await checkAvailabilityOptions("");
    expect(res.options).toHaveLength(0);
    expect(res.detail).toBeTruthy();
  });
});

describe("domain.register — gated + async + metered", () => {
  beforeEach(async () => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("DENIES without the customDomain entitlement (free tenant)", async () => {
    const payload = { domain: "newshop.co.za" };
    const token = await approve("domain.register", payload, "k-ent");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "k-ent",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("entitlement_required");
  });

  it("DENIES insufficient_credits when entitled but wallet too low", async () => {
    await activatePlan(repos, TENANT, "pro"); // entitled, but seed wallet ~R10
    const payload = { domain: "newshop.co.za" };
    const token = await approve("domain.register", payload, "k-credit");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "k-credit",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("insufficient_credits");
  });

  it("ACCEPTS + starts an async op when entitled + funded", async () => {
    await activatePlan(repos, TENANT, "pro");
    await repos.wallet.credit(TENANT, 30_000_000n); // R300 > R249
    const payload = { domain: "freshstore.co.za" };
    const token = await approve("domain.register", payload, "k-ok");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "k-ok",
        approvalToken: token,
        settleDelayMs: 0,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      // The async op carries the hostname as its target.
      expect(outcome.operation.target).toBe("freshstore.co.za");
    }
  });

  it("settles to failed for a TAKEN name (rejected registration)", async () => {
    await activatePlan(repos, TENANT, "pro");
    await repos.wallet.credit(TENANT, 30_000_000n);
    const payload = { domain: "taken.co.za" };
    const token = await approve("domain.register", payload, "k-taken");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "u",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "k-taken",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.operation.status).toBe("failed");
    }
  });
});

describe("domain.transfer — auth code persisted ENCRYPTED", () => {
  beforeEach(() => __resetMemoryStore());

  it("stores the auth code as ciphertext that decrypts back to the original", async () => {
    const record = await upsertDomainForTransfer(repos, {
      tenantId: TENANT,
      hostname: "moving.com",
      authCode: "AUTH-PLAIN-123",
    });
    expect(record.status).toBe("transfer_pending");
    expect(record.authCode).toBeTruthy();
    expect(record.authCode).not.toBe("AUTH-PLAIN-123"); // encrypted at rest
    expect(decryptAuthCode(record.authCode as string)).toBe("AUTH-PLAIN-123");
    expect(record.registrar).toBe("gtld");
    expect(record.tld).toBe("com");
  });
});
