// Contracts for the W1 reliability stores (B1/B7/B8).
//
// Three stores back the approval + async flow. They mirror the repository
// factory pattern (src/lib/db): an in-memory impl (mock mode) and a
// Prisma/Postgres impl (when DATABASE_URL is real). The env-gated factory in
// ./index.ts chooses between them with ZERO code change at call sites.
//
// Every method is ASYNC so the same interface is satisfied by the Postgres impl
// (where consume is an atomic UPDATE ... WHERE consumed_at IS NULL). The
// in-memory impl resolves synchronously under the hood but keeps the async
// signature for parity.

// --- Approval nonce ledger ---------------------------------------------------

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

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "unknown_nonce" | "already_consumed" | "tenant_mismatch" };

export interface ApprovalNonceStore {
  /** Record a freshly issued approval (pending redemption). */
  recordIssued(record: Omit<ApprovalRecord, "consumedAt">): Promise<void>;
  /** Read an approval by nonce (observability/UI). */
  getApproval(nonce: string): Promise<ApprovalRecord | undefined>;
  /**
   * Atomically consume a nonce for single use. Returns ok ONLY the first time;
   * a replay returns already_consumed. The tenantId must match. In Postgres this
   * is `UPDATE ... WHERE nonce = $1 AND tenantId = $2 AND consumedAt IS NULL`
   * with the affected rowcount deciding the winner — single-use survives
   * concurrency + multiple lambda processes.
   */
  consumeNonce(nonce: string, tenantId: string): Promise<ConsumeResult>;
}

// --- Async operation store ---------------------------------------------------

export type OperationStatus = "pending" | "succeeded" | "failed";

export interface OperationRecord {
  id: string;
  tenantId: string;
  verb: string;
  /** What the operation acts on (e.g. a domain name), for UI + audit. */
  target: string;
  status: OperationStatus;
  detail: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** Wall-clock at/after which a clock-driven reconcile may settle it. */
  settleAt: number;
  result: Record<string, unknown> | null;
}

export interface StartOperationInput {
  tenantId: string;
  verb: string;
  target: string;
  idempotencyKey: string;
  /** When to settle by (epoch ms); the reconcile sweep settles at/after this. */
  settleAt: number;
}

export interface OperationStore {
  /**
   * Start (or re-attach to) an async operation. Idempotent on
   * (tenantId, idempotencyKey): a retry returns the existing operation instead
   * of duplicating the side effect. PER-TENANT scoping fixes the B7 leak.
   */
  startOperation(input: StartOperationInput): Promise<OperationRecord>;
  /**
   * Settle an operation to a terminal state (succeeded OR failed). Single
   * settlement entry point: the reconcile sweep and a real vendor webhook/cron
   * both call this. Tenant-scoped. Terminal states are immutable.
   */
  settleOperation(
    id: string,
    status: Exclude<OperationStatus, "pending">,
    detail: string,
    result?: Record<string, unknown> | null,
    tenantId?: string,
  ): Promise<OperationRecord | null>;
  /** Read an operation (tenant-scoped). */
  getOperation(id: string, tenantId: string): Promise<OperationRecord | null>;
  /** List a tenant's operations (newest first). */
  listOperations(tenantId: string): Promise<OperationRecord[]>;
  /** All operations still pending at/before `now` (for the reconcile sweep). */
  listPending(now: number, tenantId?: string): Promise<OperationRecord[]>;
  /**
   * Platform-wide reconcile sweep (B11): settle every pending operation whose
   * settleAt has elapsed, mock-style (deterministic success). Returns the count
   * settled. In Postgres this runs through a SECURITY DEFINER maintenance
   * function so the non-bypass cron role can settle across tenants without a
   * tenant session and without otherwise widening its RLS surface. In live mode
   * a vendor webhook settles with the real outcome (possibly `failed`) first.
   */
  reconcileAll(now: number): Promise<number>;
}

// --- Webhook dedup ledger ----------------------------------------------------

export interface WebhookDedupStore {
  /**
   * Mark an event as seen. Returns `true` if THIS call recorded it for the first
   * time (i.e. it should be processed), or `false` if it was already seen (a
   * redelivery → no-op). In Postgres this is an INSERT whose unique conflict on
   * (provider, eventId) makes the claim atomic + exactly-once.
   */
  claimEvent(provider: string, eventId: string): Promise<boolean>;
  /** True if the event has already been recorded (no mutation). */
  hasEvent(provider: string, eventId: string): Promise<boolean>;
}

export interface ReliabilityStores {
  approvals: ApprovalNonceStore;
  operations: OperationStore;
  webhookDedup: WebhookDedupStore;
}
