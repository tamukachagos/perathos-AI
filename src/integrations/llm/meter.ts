// W3 — LLM metering helper. Bridges a completed call's wholesale cost to the W2
// wallet/usage ledger in ONE step (ENTERPRISE_REVIEW §5.4/§6: "settle wallet in
// one transaction").
//
// It is a thin wrapper over recordUsage(): the metering `kind` is
// `llm.<tier>.<task>` so the W2 multiplierForKind() applies the right per-tier
// margin (CHEAP 3.0× … PREMIUM 1.4×) automatically. Exactly-once is the wallet's
// (tenantId, idempotencyKey) guarantee — a duplicate key never double-debits, so
// a retried route that re-meters the same logical call is safe.

import type { Repositories } from "@/lib/db/types";
import { recordUsage, type RecordUsageResult } from "@/lib/billing/metering";
import { meterKindForTask } from "./policy";
import type { LlmTask, LlmUsage } from "./types";

export interface MeterLlmInput {
  tenantId: string;
  task: LlmTask;
  usage: LlmUsage;
  /**
   * Exactly-once accounting key. Callers derive it from the logical operation
   * (e.g. the wizard's idempotency key) so a retry re-attaches rather than
   * double-charging. Defaults are NOT supplied — a caller must pass one.
   */
  idempotencyKey: string;
  /** Optional billing period override ("YYYY-MM"); defaults to current month. */
  period?: string;
}

/**
 * Record one LLM call against the W2 wallet. The completion's `costMicro` is the
 * WHOLESALE cost (one "unit", quantity 1); recordUsage() multiplies by the
 * tier's margin to get the retail price and atomically debits the wallet,
 * appending one usage row + one audit entry. Returns the W2 result (incl.
 * `applied:false` on a duplicate key — never a second debit).
 */
export async function meterLlmUsage(
  repos: Repositories,
  input: MeterLlmInput,
): Promise<RecordUsageResult> {
  return recordUsage(repos, {
    tenantId: input.tenantId,
    kind: meterKindForTask(input.task),
    quantity: 1,
    unitCostMicro: input.usage.costMicro,
    idempotencyKey: input.idempotencyKey,
    period: input.period,
  });
}
