// Async-operation store + mock reconciliation (M3).
//
// Slow vendor verbs (e.g. .co.za registration, mailbox provisioning) do not
// complete inline. The ActionRouter returns 202 + an OperationRef; the client
// polls GET /api/operations/:id. State is settled by `reconcile()`, which here
// is a deterministic mock that "settles" an operation once enough wall-clock has
// passed. In M4 the SAME settleOperation() is what a signed vendor webhook or a
// reconciliation Cron will call — the transport changes, the settlement does not.

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
  /** Mock-only: the wall-clock at/after which reconcile() settles it. */
  settleAt: number;
  result: Record<string, unknown> | null;
}

interface OperationStore {
  byId: Map<string, OperationRecord>;
  byIdempotencyKey: Map<string, string>; // idempotencyKey -> operationId
  seq: number;
}

const globalStore = globalThis as unknown as {
  __launchDeskOperations?: OperationStore;
};

function store(): OperationStore {
  if (!globalStore.__launchDeskOperations) {
    globalStore.__launchDeskOperations = {
      byId: new Map(),
      byIdempotencyKey: new Map(),
      seq: 0,
    };
  }
  return globalStore.__launchDeskOperations;
}

/** Default mock settlement delay; small so polling resolves quickly in dev. */
export const MOCK_SETTLE_MS = 1500;

export interface StartOperationInput {
  tenantId: string;
  verb: string;
  target: string;
  idempotencyKey: string;
  /** Override the mock settlement delay (tests pass 0 to settle immediately). */
  settleDelayMs?: number;
}

/**
 * Start (or re-attach to) an async operation. Idempotent on idempotencyKey: a
 * retry with the same key returns the existing operation instead of duplicating
 * the side effect — the core async-safety property the architecture calls for.
 */
export function startOperation(input: StartOperationInput): OperationRecord {
  const s = store();
  const existingId = s.byIdempotencyKey.get(input.idempotencyKey);
  if (existingId) {
    const existing = s.byId.get(existingId);
    if (existing) return existing;
  }
  s.seq += 1;
  const now = Date.now();
  const delay = input.settleDelayMs ?? MOCK_SETTLE_MS;
  const record: OperationRecord = {
    id: `op_${s.seq.toString(36)}_${now.toString(36)}`,
    tenantId: input.tenantId,
    verb: input.verb,
    target: input.target,
    status: "pending",
    detail: `${input.verb} for "${input.target}" is in progress.`,
    idempotencyKey: input.idempotencyKey,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    settleAt: now + delay,
    result: null,
  };
  s.byId.set(record.id, record);
  s.byIdempotencyKey.set(input.idempotencyKey, record.id);
  return record;
}

/**
 * Settle an operation to a terminal state. This is the SINGLE settlement entry
 * point: the mock reconcile() calls it on a timer, and in M4 a vendor webhook /
 * Cron will call it with the real outcome. Tenant-scoped to avoid cross-tenant
 * settlement.
 */
export function settleOperation(
  id: string,
  status: Exclude<OperationStatus, "pending">,
  detail: string,
  result: Record<string, unknown> | null = null,
  tenantId?: string,
): OperationRecord | null {
  const rec = store().byId.get(id);
  if (!rec) return null;
  if (tenantId && rec.tenantId !== tenantId) return null;
  if (rec.status !== "pending") return rec; // terminal states are immutable
  rec.status = status;
  rec.detail = detail;
  rec.result = result;
  rec.updatedAt = new Date().toISOString();
  return rec;
}

/**
 * Mock reconciliation: settle any pending operation whose settleAt has passed.
 * Reading an operation triggers this so polling alone drives it to completion
 * with no external scheduler. A real Cron (M4) calls a structurally identical
 * sweep.
 */
export function reconcile(now = Date.now()): void {
  for (const rec of store().byId.values()) {
    if (rec.status === "pending" && now >= rec.settleAt) {
      settleOperation(
        rec.id,
        "succeeded",
        `${rec.verb} for "${rec.target}" completed.`,
        { settledBy: "mock-reconciliation" },
      );
    }
  }
}

/** Read an operation (tenant-scoped), reconciling timers first. */
export function getOperation(
  id: string,
  tenantId: string,
): OperationRecord | null {
  reconcile();
  const rec = store().byId.get(id);
  if (!rec || rec.tenantId !== tenantId) return null;
  return rec;
}

/** List a tenant's operations (newest first), reconciling timers first. */
export function listOperations(tenantId: string): OperationRecord[] {
  reconcile();
  return [...store().byId.values()]
    .filter((o) => o.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Exposed for tests so they can run against a fresh operation store. */
export function __resetOperationStore(): void {
  globalStore.__launchDeskOperations = {
    byId: new Map(),
    byIdempotencyKey: new Map(),
    seq: 0,
  };
}
