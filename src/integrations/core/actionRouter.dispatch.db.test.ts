// Async dispatch is REAL (B2): the ActionRouter actually calls adapter.action()
// for async gated verbs, and the terminal state can be `failed` (never an
// unconditional success). Verified against the persistent (Postgres) stores so
// the same path that runs on serverless is exercised.
//
// Runs only with a real DATABASE_URL (the db-tests CI job).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAction, readOperation } from "./actionRouter";
import { __resetStoreFactory } from "./stores";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "./approvalToken";
import { recordIssued } from "./approvalStore";
import { adapterRegistry } from "./registry";
import { prismaRepositories } from "@/lib/db/prisma/repositories";
import { resetDb, TENANT_A } from "@/lib/db/testdb";
import { activatePlan } from "@/lib/billing/service";
import { initialBusiness } from "@/lib/platformData";

const repos = prismaRepositories;

async function approve(verb: string, payload: Record<string, unknown>, key: string) {
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey: key, nonce, expiresAt });
  await recordIssued({
    nonce,
    tenantId: TENANT_A,
    verb,
    payloadHash,
    idempotencyKey: key,
    issuedAt: Date.now(),
    expiresAt,
  });
  return token;
}

beforeEach(async () => {
  __resetStoreFactory();
  await resetDb();
  // domain.register requires the customDomain entitlement → put A on Pro.
  await activatePlan(repos, TENANT_A, "pro");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("B2 — async dispatch actually calls the adapter; failed is reachable", () => {
  it("CALLS adapter.action() for an async gated verb", async () => {
    const spy = vi
      .spyOn(adapterRegistry.DomainProvider, "action")
      .mockResolvedValue({ ok: true, detail: "ok" });

    const payload = { domain: "calls-adapter.co.za" };
    const token = await approve("domain.register", payload, "idem-call");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT_A,
        actorId: "u1",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-call",
        approvalToken: token,
        settleDelayMs: 60_000, // stay pending so we observe the dispatch, not the sweep
      },
    );
    expect(outcome.status).toBe("accepted");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ verb: "domain.register" }),
    );
    if (outcome.status === "accepted") {
      // ok:true → stays pending (webhook/cron would settle it later).
      const op = await readOperation(outcome.operation.id, TENANT_A);
      expect(op?.status).toBe("pending");
    }
  });

  it("settles to FAILED when the adapter returns ok:false", async () => {
    vi.spyOn(adapterRegistry.DomainProvider, "action").mockResolvedValue({
      ok: false,
      detail: "registrar said no",
    });
    const payload = { domain: "rejected.co.za" };
    const token = await approve("domain.register", payload, "idem-rej");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT_A,
        actorId: "u1",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-rej",
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.operation.status).toBe("failed");
      const op = await readOperation(outcome.operation.id, TENANT_A);
      expect(op?.status).toBe("failed");
    }
  });

  it("settles to FAILED when the adapter throws", async () => {
    vi.spyOn(adapterRegistry.DomainProvider, "action").mockRejectedValue(
      new Error("network down"),
    );
    const payload = { domain: "threw.co.za" };
    const token = await approve("domain.register", payload, "idem-threw");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions },
      {
        tenantId: TENANT_A,
        actorId: "u1",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-threw",
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.operation.status).toBe("failed");
    }
  });
});
