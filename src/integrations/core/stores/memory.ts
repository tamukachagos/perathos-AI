// In-memory reliability stores (mock mode + tests).
//
// Active whenever there is no DATABASE_URL. Per-process globalThis maps — the
// same shape the prototype shipped — reset on restart. Single-process so the
// consume/claim "atomicity" is trivially satisfied by JS's run-to-completion;
// the Postgres impl is what makes it survive concurrency + multiple processes.

import type {
  ApprovalNonceStore,
  ApprovalRecord,
  ConsumeResult,
  OperationRecord,
  OperationStore,
  ReliabilityStores,
  StartOperationInput,
  WebhookDedupStore,
} from "./types";

interface MemStore {
  approvals: Map<string, ApprovalRecord>;
  operationsById: Map<string, OperationRecord>;
  operationsByKey: Map<string, string>; // `${tenantId}:${idempotencyKey}` -> id
  webhookEvents: Set<string>; // `${provider}:${eventId}`
  seq: number;
}

const globalForStores = globalThis as unknown as {
  __launchDeskReliability?: MemStore;
};

function mem(): MemStore {
  if (!globalForStores.__launchDeskReliability) {
    globalForStores.__launchDeskReliability = {
      approvals: new Map(),
      operationsById: new Map(),
      operationsByKey: new Map(),
      webhookEvents: new Set(),
      seq: 0,
    };
  }
  return globalForStores.__launchDeskReliability;
}

function opKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}:${idempotencyKey}`;
}

const approvals: ApprovalNonceStore = {
  async recordIssued(record: Omit<ApprovalRecord, "consumedAt">): Promise<void> {
    mem().approvals.set(record.nonce, { ...record, consumedAt: null });
  },
  async getApproval(nonce: string): Promise<ApprovalRecord | undefined> {
    return mem().approvals.get(nonce);
  },
  async consumeNonce(nonce: string, tenantId: string): Promise<ConsumeResult> {
    const rec = mem().approvals.get(nonce);
    if (!rec) return { ok: false, reason: "unknown_nonce" };
    if (rec.tenantId !== tenantId) return { ok: false, reason: "tenant_mismatch" };
    if (rec.consumedAt !== null) return { ok: false, reason: "already_consumed" };
    rec.consumedAt = Date.now();
    return { ok: true };
  },
};

const operations: OperationStore = {
  async startOperation(input: StartOperationInput): Promise<OperationRecord> {
    const s = mem();
    const key = opKey(input.tenantId, input.idempotencyKey);
    const existingId = s.operationsByKey.get(key);
    if (existingId) {
      const existing = s.operationsById.get(existingId);
      if (existing) return existing;
    }
    s.seq += 1;
    const now = Date.now();
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
      settleAt: input.settleAt,
      result: null,
    };
    s.operationsById.set(record.id, record);
    s.operationsByKey.set(key, record.id);
    return record;
  },
  async settleOperation(
    id,
    status,
    detail,
    result = null,
    tenantId,
  ): Promise<OperationRecord | null> {
    const rec = mem().operationsById.get(id);
    if (!rec) return null;
    if (tenantId && rec.tenantId !== tenantId) return null;
    if (rec.status !== "pending") return rec; // terminal states are immutable
    rec.status = status;
    rec.detail = detail;
    rec.result = result;
    rec.updatedAt = new Date().toISOString();
    return rec;
  },
  async getOperation(id, tenantId): Promise<OperationRecord | null> {
    const rec = mem().operationsById.get(id);
    if (!rec || rec.tenantId !== tenantId) return null;
    return rec;
  },
  async listOperations(tenantId): Promise<OperationRecord[]> {
    return [...mem().operationsById.values()]
      .filter((o) => o.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async listPending(now, tenantId): Promise<OperationRecord[]> {
    return [...mem().operationsById.values()].filter(
      (o) =>
        o.status === "pending" &&
        now >= o.settleAt &&
        (tenantId ? o.tenantId === tenantId : true),
    );
  },
  async reconcileAll(now): Promise<number> {
    let settled = 0;
    for (const rec of mem().operationsById.values()) {
      if (rec.status === "pending" && now >= rec.settleAt) {
        rec.status = "succeeded";
        rec.detail = `${rec.verb} for "${rec.target}" completed.`;
        rec.result = { settledBy: "cron-reconciliation" };
        rec.updatedAt = new Date().toISOString();
        settled += 1;
      }
    }
    return settled;
  },
};

const webhookDedup: WebhookDedupStore = {
  async claimEvent(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    const s = mem();
    if (s.webhookEvents.has(key)) return false;
    s.webhookEvents.add(key);
    return true;
  },
  async hasEvent(provider: string, eventId: string): Promise<boolean> {
    return mem().webhookEvents.has(`${provider}:${eventId}`);
  },
};

export const memoryStores: ReliabilityStores = {
  approvals,
  operations,
  webhookDedup,
};

/** Exposed for tests so they can run against fresh in-memory stores. */
export function __resetReliabilityStores(): void {
  globalForStores.__launchDeskReliability = {
    approvals: new Map(),
    operationsById: new Map(),
    operationsByKey: new Map(),
    webhookEvents: new Set(),
    seq: 0,
  };
}
