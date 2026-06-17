// Async-operation store + reconciliation (B1/B2/B11/B17).
//
// Slow vendor verbs (.co.za registration, mailbox provisioning, hosting deploy)
// do not complete inline. The ActionRouter returns 202 + an OperationRef; the
// client polls GET /api/operations/:id. State is driven to terminal by
// `settleOperation` — called by the reconcile sweep (here + the cron) and, in
// live mode, by a signed vendor webhook. Terminal state can be `succeeded` OR
// `failed` (B2): settlement carries the real outcome, never an unconditional
// success.
//
// This module is a thin async facade over the env-gated reliability-store
// factory (./stores): in-memory in mock mode, Prisma/Postgres when DATABASE_URL
// is set. Idempotency is PER TENANT (B7).

import { getStores } from "./stores";
import { __resetReliabilityStores } from "./stores/memory";
import type {
  OperationRecord,
  OperationStatus,
} from "./stores/types";

export type { OperationRecord, OperationStatus } from "./stores/types";

/**
 * Exposed for tests so they can run against a fresh in-memory operation store.
 * Resets the shared in-memory reliability store. No-op against Postgres.
 */
export function __resetOperationStore(): void {
  __resetReliabilityStores();
}

/**
 * Default mock settlement delay. Small so polling resolves quickly in dev.
 * B17: this is independent of any injected test clock — a real clock keeps a
 * real delay. Tests opt into instant settlement by passing settleDelayMs: 0
 * explicitly, NOT by injecting `now`.
 */
export const MOCK_SETTLE_MS = 1500;

export interface StartOperationInput {
  tenantId: string;
  verb: string;
  target: string;
  idempotencyKey: string;
  /** Explicit settlement delay (ms). Defaults to MOCK_SETTLE_MS. */
  settleDelayMs?: number;
}

/**
 * Start (or re-attach to) an async operation. Idempotent on
 * (tenantId, idempotencyKey): a retry returns the existing operation instead of
 * duplicating the side effect.
 */
export async function startOperation(
  input: StartOperationInput,
): Promise<OperationRecord> {
  const stores = await getStores();
  const delay = input.settleDelayMs ?? MOCK_SETTLE_MS;
  return stores.operations.startOperation({
    tenantId: input.tenantId,
    verb: input.verb,
    target: input.target,
    idempotencyKey: input.idempotencyKey,
    settleAt: Date.now() + delay,
  });
}

/**
 * Settle an operation to a terminal state (succeeded OR failed). The SINGLE
 * settlement entry point: the reconcile sweep calls it, and a vendor
 * webhook/cron calls it with the real outcome. Tenant-scoped.
 */
export async function settleOperation(
  id: string,
  status: Exclude<OperationStatus, "pending">,
  detail: string,
  result: Record<string, unknown> | null = null,
  tenantId?: string,
): Promise<OperationRecord | null> {
  const stores = await getStores();
  return stores.operations.settleOperation(id, status, detail, result, tenantId);
}

/**
 * Reconcile: settle any pending operation whose settleAt has passed, mock-style
 * (deterministic success). In mock mode `getOperation` calls this so polling
 * alone drives an op to completion with no external scheduler. The real cron
 * (/api/cron/operations) runs a structurally identical sweep; a live adapter's
 * webhook supersedes it with the true outcome (which may be `failed`).
 *
 * Tenant-scoped under Postgres RLS: a tenantId is required to read+settle. The
 * cron resolves per-tenant; the mock-mode read path passes the reader's tenant.
 */
export async function reconcile(
  now = Date.now(),
  tenantId?: string,
): Promise<void> {
  const stores = await getStores();
  const pending = await stores.operations.listPending(now, tenantId);
  for (const rec of pending) {
    await stores.operations.settleOperation(
      rec.id,
      "succeeded",
      `${rec.verb} for "${rec.target}" completed.`,
      { settledBy: "mock-reconciliation" },
      rec.tenantId,
    );
  }
}

/**
 * Platform-wide reconcile sweep (B11), for the operations-reconcile cron. Runs
 * with NO tenant session: settles every elapsed pending operation across all
 * tenants and returns the count. In live mode a vendor webhook settles with the
 * real outcome (possibly `failed`) before the cron runs.
 */
export async function reconcileAll(now = Date.now()): Promise<number> {
  const stores = await getStores();
  return stores.operations.reconcileAll(now);
}

/** Read an operation (tenant-scoped), reconciling that tenant's timers first. */
export async function getOperation(
  id: string,
  tenantId: string,
): Promise<OperationRecord | null> {
  await reconcile(Date.now(), tenantId);
  const stores = await getStores();
  return stores.operations.getOperation(id, tenantId);
}

/** List a tenant's operations (newest first), reconciling timers first. */
export async function listOperations(
  tenantId: string,
): Promise<OperationRecord[]> {
  await reconcile(Date.now(), tenantId);
  const stores = await getStores();
  return stores.operations.listOperations(tenantId);
}
