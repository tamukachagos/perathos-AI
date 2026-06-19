// W2 — Billing / metering service (ENTERPRISE_REVIEW §5.4 / §6 / §8).
//
// The bridge between the wallet/usage/invoice repos, the margin config, and the
// Paystack top-up path. Server-only; every function is tenant-scoped via an
// explicit tenantId resolved upstream from the session (src/lib/authz.ts). Runs
// end-to-end in mock mode with no DB and no secrets.
//
// The wallet is the universal hard ceiling: recordUsage() decrements it
// atomically and exactly-once; requireCredits() (in the ActionRouter) refuses
// cost-bearing work before the wallet can be over-drawn.

import type { Repositories, DebitResult, InvoiceRecord } from "@/lib/db/types";
import {
  applyMargin,
  currentPeriod,
  MICRO_PER_CENT,
  multiplierForKind,
  TOKEN_TOPUP_SKU,
} from "@/lib/billing/meteringConfig";
import {
  initializePaystackTransaction,
  selectBillingProvider,
  type CheckoutSession,
} from "@/integrations/payment/subscription";
import { logger } from "@/lib/logger";

export interface RecordUsageInput {
  tenantId: string;
  /** e.g. "llm.cheap.profile.extract" | "hosting.cpu_hour" | "domain.register". */
  kind: string;
  /** Number of units (tokens, CPU-hours, count). Defaults to 1. */
  quantity?: number;
  /** Wholesale unit cost in ZAR micro-cents (what the operator pays upstream). */
  unitCostMicro: bigint;
  /**
   * Margin multiplier. When omitted it is derived from `kind` via the config
   * (multiplierForKind). Passing it explicitly lets W3/W5 override per-call.
   */
  marginMultiplier?: number;
  /** Exactly-once accounting key. A duplicate (tenantId, key) never re-debits. */
  idempotencyKey: string;
  /** Billing period "YYYY-MM"; defaults to the current UTC month. */
  period?: string;
}

export interface RecordUsageResult {
  /** False when this was a duplicate idempotencyKey (a no-op, prior result). */
  applied: boolean;
  /** Wallet balance AFTER the debit (or the unchanged balance on a duplicate). */
  balanceMicro: bigint;
  /** Retail unit price charged per unit (micro-cents). */
  unitPriceMicro: bigint;
  /** Total debited = unitPriceMicro × quantity (micro-cents). */
  amountMicro: bigint;
  /** The persisted usage record id. */
  usageId: string;
}

/**
 * Record a metered event: compute the retail unit price from the wholesale cost
 * × margin, then ATOMICALLY append the usage record AND decrement the wallet,
 * EXACTLY-ONCE keyed on (tenantId, idempotencyKey). A duplicate key is a no-op
 * that returns the prior result — it never double-debits.
 *
 * The atomicity + exactly-once live in the repo `debit()` (one Prisma
 * $transaction calling record_usage_debit() in Postgres; one critical section
 * in the in-memory impl), so this function is a thin pricing + audit wrapper.
 */
export async function recordUsage(
  repos: Repositories,
  input: RecordUsageInput,
): Promise<RecordUsageResult> {
  const quantity = input.quantity ?? 1;
  const multiplier = input.marginMultiplier ?? multiplierForKind(input.kind);
  const unitPriceMicro = applyMargin(input.unitCostMicro, multiplier);
  const amountMicro = unitPriceMicro * BigInt(quantity);
  const period = input.period ?? currentPeriod();

  const result: DebitResult = await repos.wallet.debit(input.tenantId, {
    kind: input.kind,
    quantity,
    unitCostMicro: input.unitCostMicro,
    unitPriceMicro,
    amountMicro,
    period,
    idempotencyKey: input.idempotencyKey,
  });

  // Audit only a NEW debit (a duplicate is a silent no-op so the ledger stays
  // clean). PII-free metadata: the kind + amount, never a payload.
  if (result.applied) {
    await repos.audit.append(input.tenantId, {
      actorId: null,
      action: "wallet.debited",
      targetType: "usage",
      targetId: result.record.id,
      metadata: {
        kind: input.kind,
        quantity,
        amountMicro: amountMicro.toString(),
        balanceMicro: result.balanceMicro.toString(),
        period,
      },
    });
  } else {
    logger.info("wallet.debit_deduped", {
      tenantId: input.tenantId,
      kind: input.kind,
    });
  }

  return {
    applied: result.applied,
    balanceMicro: result.balanceMicro,
    unitPriceMicro,
    amountMicro,
    usageId: result.record.id,
  };
}

/** Read a tenant's wallet balance (micro-cents; 0 when no wallet yet). */
export async function getBalance(
  repos: Repositories,
  tenantId: string,
): Promise<bigint> {
  return repos.wallet.getBalance(tenantId);
}

/**
 * Credit a wallet by `amountMicro` (a top-up / plan grant). In MOCK mode this is
 * the whole money path — the wallet is credited directly. With Paystack keys the
 * real money path goes through `startTopUpCheckout` (createCheckout as the
 * token_topup SKU); the webhook then calls this to credit on charge.success.
 */
export async function topUp(
  repos: Repositories,
  tenantId: string,
  amountMicro: bigint,
): Promise<bigint> {
  const balance = await repos.wallet.credit(tenantId, amountMicro);
  await repos.audit.append(tenantId, {
    actorId: null,
    action: "wallet.credited",
    targetType: "wallet",
    targetId: tenantId,
    metadata: {
      amountMicro: amountMicro.toString(),
      balanceMicro: balance.toString(),
    },
  });
  return balance;
}

/**
 * Begin a REAL-money top-up: reuse the Paystack createCheckout path with the
 * token_topup SKU (§6). Mock now (returns an in-app confirm URL); Paystack hosted
 * checkout once keyed. NO charge happens here; the wallet is credited on return
 * (mock) or by the webhook (live). `amountCentsZar` is the rand-cents the user
 * buys; we convert to micro-cents only when crediting.
 */
export async function startTopUpCheckout(
  tenantId: string,
  amountCentsZar: number,
  callbackUrl: string,
  customerEmail?: string | null,
): Promise<CheckoutSession> {
  const provider = selectBillingProvider();
  if (!provider.charges) {
    throw new Error("topup_checkout_requires_live_provider");
  }
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("paystack_not_configured");

  const amountMicro = BigInt(amountCentsZar) * MICRO_PER_CENT;
  return initializePaystackTransaction(secretKey, {
    amountCents: amountCentsZar,
    currency: "ZAR",
    callbackUrl,
    customerEmail,
    metadata: {
      tenantId,
      kind: TOKEN_TOPUP_SKU,
      amountMicro: amountMicro.toString(),
    },
  });
}

/**
 * Roll a period's usage into a single invoice: sum every usage row's amount for
 * the period and upsert the (tenant, period) invoice. Returns the invoice. The
 * actual charge is via the dormant Paystack BillingProvider (§5.4) — left as the
 * `open` status here; a later step (or the webhook) marks it `paid`.
 */
export async function rollInvoice(
  repos: Repositories,
  tenantId: string,
  period: string = currentPeriod(),
): Promise<InvoiceRecord> {
  const rows = await repos.usage.listByPeriod(tenantId, period);
  const totalMicro = rows.reduce((sum, r) => sum + r.amountMicro, 0n);
  const invoice = await repos.invoices.upsert(tenantId, period, totalMicro, "open");
  await repos.audit.append(tenantId, {
    actorId: null,
    action: "invoice.rolled",
    targetType: "invoice",
    targetId: invoice.id,
    metadata: {
      period,
      totalMicro: totalMicro.toString(),
      lineCount: rows.length,
    },
  });
  return invoice;
}

/**
 * Pre-flight credit check (the helper the ActionRouter calls). True when the
 * wallet can cover `estimateMicro`. An estimate of 0 (a free verb) always
 * passes. This is the LLM/hosting analogue of the entitlement gate: deny BEFORE
 * doing work the customer cannot pay for.
 */
export async function hasCredits(
  repos: Repositories,
  tenantId: string,
  estimateMicro: bigint,
): Promise<boolean> {
  if (estimateMicro <= 0n) return true;
  const balance = await repos.wallet.getBalance(tenantId);
  return balance >= estimateMicro;
}
