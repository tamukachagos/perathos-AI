// Server-side state for approvals: the single-use nonce ledger that makes
// otherwise-stateless HMAC tokens NON-replayable, plus a lightweight record of
// issued approvals for observability/UI. In-memory and per-process — the same
// shape a real deployment would back with Redis/Postgres. Reset on restart.
//
// Tenant-scoped: every record carries the tenantId that requested the approval,
// so a token issued under one tenant cannot be consumed under another.

export interface ApprovalRecord {
  nonce: string;
  tenantId: string;
  verb: string;
  payloadHash: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
  /** Set when the token is redeemed exactly once. */
  consumedAt: number | null;
}

interface ApprovalStore {
  byNonce: Map<string, ApprovalRecord>;
}

const globalStore = globalThis as unknown as {
  __launchDeskApprovals?: ApprovalStore;
};

function store(): ApprovalStore {
  if (!globalStore.__launchDeskApprovals) {
    globalStore.__launchDeskApprovals = { byNonce: new Map() };
  }
  return globalStore.__launchDeskApprovals;
}

/** Record a freshly issued approval (pending redemption). */
export function recordIssued(record: Omit<ApprovalRecord, "consumedAt">): void {
  store().byNonce.set(record.nonce, { ...record, consumedAt: null });
}

export function getApproval(nonce: string): ApprovalRecord | undefined {
  return store().byNonce.get(nonce);
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "unknown_nonce" | "already_consumed" | "tenant_mismatch" };

/**
 * Atomically consume a nonce for single use. Returns ok only the FIRST time;
 * any subsequent call with the same nonce (a replay) returns already_consumed.
 * The tenantId must match the tenant the approval was issued for.
 */
export function consumeNonce(nonce: string, tenantId: string): ConsumeResult {
  const rec = store().byNonce.get(nonce);
  if (!rec) return { ok: false, reason: "unknown_nonce" };
  if (rec.tenantId !== tenantId) return { ok: false, reason: "tenant_mismatch" };
  if (rec.consumedAt !== null) return { ok: false, reason: "already_consumed" };
  rec.consumedAt = Date.now();
  return { ok: true };
}

/** Exposed for tests so they can run against a fresh ledger. */
export function __resetApprovalStore(): void {
  globalStore.__launchDeskApprovals = { byNonce: new Map() };
}
