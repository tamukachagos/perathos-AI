import { beforeEach, describe, expect, it } from "vitest";
import {
  executeAction,
  readOperation,
} from "./actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  hashPayload,
  issueToken,
  mintNonce,
  verifyToken,
} from "./approvalToken";
import { recordIssued, __resetApprovalStore } from "./approvalStore";
import { __resetOperationStore } from "./operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";

const TENANT = DEV_TENANT_ID;
const ACTOR = "dev-user";

// Issue a valid, recorded approval token bound to verb+payload+idempotencyKey.
function approve(
  verb: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  opts: { ttlMs?: number; tenantId?: string } = {},
): string {
  const tenantId = opts.tenantId ?? TENANT;
  const payloadHash = hashPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + (opts.ttlMs ?? DEFAULT_TOKEN_TTL_MS);
  const token = issueToken({ verb, payloadHash, idempotencyKey, nonce, expiresAt });
  recordIssued({
    nonce,
    tenantId,
    verb,
    payloadHash,
    idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });
  return token;
}

type ExecParams = Parameters<typeof executeAction>[1];
function run(params: Partial<ExecParams>) {
  return executeAction(
    { audit: memoryRepositories.audit },
    {
      tenantId: TENANT,
      actorId: ACTOR,
      verb: "domain.register",
      business: initialBusiness,
      payload: { domain: "example.co.za" },
      idempotencyKey: "idem-1",
      ...params,
    },
  );
}

describe("ActionRouter — gating, token binding, audit, async", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
  });

  it("denies a gated verb with NO approval token, and audits the denial", async () => {
    const outcome = await run({ approvalToken: undefined });
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("missing_token");

    const log = await memoryRepositories.audit.list(TENANT);
    expect(log.some((e) => e.action === "action.denied")).toBe(true);
  });

  it("allows a gated verb WITH a valid bound token (async → accepted/202) and audits", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-async");
    const outcome = await run({
      payload,
      idempotencyKey: "idem-async",
      approvalToken: token,
    });
    expect(outcome.status).toBe("accepted");

    const log = await memoryRepositories.audit.list(TENANT);
    expect(log.some((e) => e.action === "action.allowed")).toBe(true);
  });

  it("rejects a SWAPPED payload (token bound to payload-hash)", async () => {
    const approvedPayload = { domain: "example.co.za" };
    const token = approve("domain.register", approvedPayload, "idem-swap");

    // Attacker swaps the payload after approval.
    const outcome = await run({
      payload: { domain: "attacker.co.za" },
      idempotencyKey: "idem-swap",
      approvalToken: token,
    });
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("payload_mismatch");
  });

  it("rejects a token redeemed for a DIFFERENT verb", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("dns.write", payload, "idem-verb");
    const outcome = await run({
      verb: "domain.register",
      payload,
      idempotencyKey: "idem-verb",
      approvalToken: token,
    });
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("verb_mismatch");
  });

  it("rejects a token with a mismatched idempotency key", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-A");
    const outcome = await run({
      payload,
      idempotencyKey: "idem-B",
      approvalToken: token,
    });
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("idempotency_mismatch");
  });

  it("is single-use: a replay of the same token is rejected", async () => {
    const payload = { account: "owner@example.com" };
    const token = approve("payment.configure", payload, "idem-replay");

    const first = await run({
      verb: "payment.configure",
      payload,
      idempotencyKey: "idem-replay",
      approvalToken: token,
    });
    expect(first.status).toBe("allowed"); // payment.configure is synchronous

    const replay = await run({
      verb: "payment.configure",
      payload,
      idempotencyKey: "idem-replay",
      approvalToken: token,
    });
    expect(replay.status).toBe("denied");
    if (replay.status === "denied") expect(replay.reason).toBe("replayed_token");
  });

  it("rejects an EXPIRED token", async () => {
    const payload = { domain: "example.co.za" };
    // Issue with a tiny TTL then verify well past expiry.
    const token = approve("domain.register", payload, "idem-exp", { ttlMs: 1 });
    // executeAction defaults now=Date.now(); pass a future `now` via params.
    const outcome = await executeAction(
      { audit: memoryRepositories.audit },
      {
        tenantId: TENANT,
        actorId: ACTOR,
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-exp",
        approvalToken: token,
        now: Date.now() + 10_000,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("expired_token");
  });

  it("writes an audit entry on BOTH allow and deny paths", async () => {
    // Deny.
    await run({ approvalToken: undefined, idempotencyKey: "d1" });
    // Allow.
    const payload = { account: "x@y.co.za" };
    const token = approve("payment.configure", payload, "a1");
    await run({
      verb: "payment.configure",
      payload,
      idempotencyKey: "a1",
      approvalToken: token,
    });

    const log = await memoryRepositories.audit.list(TENANT);
    expect(log.filter((e) => e.action === "action.denied").length).toBeGreaterThanOrEqual(1);
    expect(log.filter((e) => e.action === "action.allowed").length).toBeGreaterThanOrEqual(1);
    // Audit never leaks the raw payload/token, only the bound hash.
    const allow = log.find((e) => e.action === "action.allowed");
    expect(allow?.metadata).toHaveProperty("payloadHash");
    expect(JSON.stringify(allow?.metadata)).not.toContain("x@y.co.za");
  });

  it("async op returns an OperationRef then SETTLES via reconciliation", async () => {
    const payload = { domain: "example.co.za" };
    const token = approve("domain.register", payload, "idem-settle");
    // Passing `now` makes the mock op settle with zero delay.
    const outcome = await executeAction(
      { audit: memoryRepositories.audit },
      {
        tenantId: TENANT,
        actorId: ACTOR,
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: "idem-settle",
        approvalToken: token,
        now: Date.now(),
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;

    const op = readOperation(outcome.operation.id, TENANT);
    expect(op).not.toBeNull();
    // reconcile() ran on read; with zero delay it should be terminal.
    expect(op?.status).toBe("succeeded");

    // Cross-tenant read is denied.
    expect(readOperation(outcome.operation.id, "other-tenant")).toBeNull();
  });

  it("token verify: tamper with the signature is rejected", () => {
    const token = approve("dns.write", { domain: "x.co.za" }, "v");
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    const result = verifyToken(tampered);
    expect(result.ok).toBe(false);
  });

  it("ungated verbs run inline with no token and still audit", async () => {
    const outcome = await run({
      verb: "github.commit",
      payload: {},
      idempotencyKey: "g1",
      approvalToken: undefined,
    });
    expect(outcome.status).toBe("allowed");
    const log = await memoryRepositories.audit.list(TENANT);
    expect(log.some((e) => e.action === "action.allowed")).toBe(true);
  });
});
