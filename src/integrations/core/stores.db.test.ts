// Persistent reliability stores — ATOMIC consume/claim + cross-tenant
// idempotency (B1/B7/B8). Runs against the Prisma store impl, which the factory
// selects because DATABASE_URL is set in the db-tests CI job.

import { beforeEach, describe, expect, it } from "vitest";
import { getStores, __resetStoreFactory } from "./stores";
import { isPersistentStores } from "./stores";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";

beforeEach(async () => {
  __resetStoreFactory();
  await resetDb();
});

describe("Persistent stores — atomic single-use + per-tenant idempotency", () => {
  it("selects the Postgres impl when DATABASE_URL is set", () => {
    expect(isPersistentStores()).toBe(true);
  });

  it("consumeNonce is atomic: exactly one of N concurrent consumes wins", async () => {
    const stores = await getStores();
    const nonce = "nonce-race-1";
    await stores.approvals.recordIssued({
      nonce,
      tenantId: TENANT_A,
      verb: "domain.register",
      payloadHash: "h",
      idempotencyKey: "k",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });

    // Fire many concurrent consumes of the SAME nonce. The atomic
    // UPDATE ... WHERE consumedAt IS NULL must let exactly one succeed.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        stores.approvals.consumeNonce(nonce, TENANT_A),
      ),
    );
    const wins = results.filter((r) => r.ok).length;
    expect(wins).toBe(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers.length).toBe(11);
    // Every loser is reported as already_consumed (single-use), not unknown.
    expect(losers.every((r) => !r.ok && r.reason === "already_consumed")).toBe(true);
  });

  it("consumeNonce rejects a tenant mismatch", async () => {
    const stores = await getStores();
    await stores.approvals.recordIssued({
      nonce: "n-tenant",
      tenantId: TENANT_A,
      verb: "v",
      payloadHash: "h",
      idempotencyKey: "k",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    const wrong = await stores.approvals.consumeNonce("n-tenant", TENANT_B);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("tenant_mismatch");
    // And A can still consume it afterwards (the mismatch did not burn it).
    const right = await stores.approvals.consumeNonce("n-tenant", TENANT_A);
    expect(right.ok).toBe(true);
  });

  it("operation idempotency is PER TENANT (B7): same key, two tenants, two ops", async () => {
    const stores = await getStores();
    const opA = await stores.operations.startOperation({
      tenantId: TENANT_A,
      verb: "domain.register",
      target: "a.co.za",
      idempotencyKey: "idem-1",
      settleAt: Date.now() + 60_000,
    });
    const opB = await stores.operations.startOperation({
      tenantId: TENANT_B,
      verb: "domain.register",
      target: "b.co.za",
      idempotencyKey: "idem-1", // SAME key as A
      settleAt: Date.now() + 60_000,
    });
    // Distinct operations — no cross-tenant leak.
    expect(opA.id).not.toBe(opB.id);
    expect(opA.target).toBe("a.co.za");
    expect(opB.target).toBe("b.co.za");

    // A retry within the SAME tenant+key re-attaches to the same op.
    const opARetry = await stores.operations.startOperation({
      tenantId: TENANT_A,
      verb: "domain.register",
      target: "a.co.za",
      idempotencyKey: "idem-1",
      settleAt: Date.now() + 60_000,
    });
    expect(opARetry.id).toBe(opA.id);

    // B cannot read A's op (tenant-scoped get).
    expect(await stores.operations.getOperation(opA.id, TENANT_B)).toBeNull();
    expect(await stores.operations.getOperation(opA.id, TENANT_A)).not.toBeNull();
  });

  it("settleOperation drives terminal state including failed, and is immutable once terminal", async () => {
    const stores = await getStores();
    const op = await stores.operations.startOperation({
      tenantId: TENANT_A,
      verb: "hosting.deploy",
      target: "slug",
      idempotencyKey: "idem-fail",
      settleAt: Date.now() + 60_000,
    });
    const failed = await stores.operations.settleOperation(
      op.id,
      "failed",
      "provider rejected",
      { reason: "x" },
      TENANT_A,
    );
    expect(failed?.status).toBe("failed");
    // A later settle attempt cannot flip a terminal op.
    const again = await stores.operations.settleOperation(
      op.id,
      "succeeded",
      "too late",
      null,
      TENANT_A,
    );
    expect(again?.status).toBe("failed"); // immutable
  });

  it("webhook dedup claimEvent is atomic exactly-once", async () => {
    const stores = await getStores();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        stores.webhookDedup.claimEvent("paystack", "evt-123"),
      ),
    );
    // Exactly one claim records it for the first time.
    expect(claims.filter(Boolean).length).toBe(1);
    expect(await stores.webhookDedup.hasEvent("paystack", "evt-123")).toBe(true);
  });

  it("reconcileAll settles elapsed pending ops platform-wide", async () => {
    const stores = await getStores();
    const past = Date.now() - 1000;
    await stores.operations.startOperation({
      tenantId: TENANT_A,
      verb: "domain.register",
      target: "x.co.za",
      idempotencyKey: "r-a",
      settleAt: past,
    });
    await stores.operations.startOperation({
      tenantId: TENANT_B,
      verb: "domain.register",
      target: "y.co.za",
      idempotencyKey: "r-b",
      settleAt: past,
    });
    const settled = await stores.operations.reconcileAll(Date.now());
    expect(settled).toBe(2);
    const a = await stores.operations.listOperations(TENANT_A);
    expect(a[0].status).toBe("succeeded");
  });
});
