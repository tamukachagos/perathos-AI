// Approval nonce ledger — the single-use store that makes otherwise-stateless
// HMAC tokens NON-replayable, tenant-scoped (B1/B8).
//
// This module is now a thin async facade over the env-gated reliability-store
// factory (./stores): in-memory in mock mode, Prisma/Postgres when DATABASE_URL
// is real. The Postgres consume is an ATOMIC `UPDATE ... WHERE consumedAt IS
// NULL` so single-use survives concurrency + multiple serverless processes
// (previously these lived in a per-process globalThis map, which broke on
// Vercel: approvals failed as "already used" on tokens never used).

import { getStores } from "./stores";
import { __resetReliabilityStores } from "./stores/memory";
import type { ApprovalRecord, ConsumeResult } from "./stores/types";

export type { ApprovalRecord, ConsumeResult } from "./stores/types";

/**
 * Exposed for tests so they can run against a fresh in-memory ledger. Resets the
 * whole in-memory reliability store (nonces + operations + webhook dedup share
 * one backing map). No-op against Postgres (tests there truncate tables).
 */
export function __resetApprovalStore(): void {
  __resetReliabilityStores();
}

/** Record a freshly issued approval (pending redemption). */
export async function recordIssued(
  record: Omit<ApprovalRecord, "consumedAt">,
): Promise<void> {
  const stores = await getStores();
  await stores.approvals.recordIssued(record);
}

export async function getApproval(
  nonce: string,
): Promise<ApprovalRecord | undefined> {
  const stores = await getStores();
  return stores.approvals.getApproval(nonce);
}

/**
 * Atomically consume a nonce for single use. Returns ok only the FIRST time;
 * any subsequent call with the same nonce (a replay) returns already_consumed.
 * The tenantId must match the tenant the approval was issued for.
 */
export async function consumeNonce(
  nonce: string,
  tenantId: string,
): Promise<ConsumeResult> {
  const stores = await getStores();
  return stores.approvals.consumeNonce(nonce, tenantId);
}
