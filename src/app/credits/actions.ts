"use server";

// W2 — Credits server actions: read the wallet balance + usage history, and a
// top-up action. Tenant scoping comes from requireTenant(); the client never
// supplies a tenant. In MOCK mode the top-up credits the wallet directly (no
// charge); with Paystack keys it would drive a real checkout via the
// token_topup SKU (startTopUpCheckout). Owner-facing values are RAND only.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { env } from "@/lib/env";
import {
  getBalance,
  startTopUpCheckout,
  topUp,
} from "@/lib/billing/metering";
import {
  currentPeriod,
  formatMicroZar,
  MICRO_PER_RAND,
} from "@/lib/billing/meteringConfig";
import { selectBillingProvider } from "@/integrations/payment/subscription";

/** A usage-history line, plain-language (kind label + amount), no model names. */
export interface UsageLine {
  id: string;
  /** Plain-language label derived from the kind (never a raw model name). */
  label: string;
  /** Rand display of the amount charged. */
  amountZar: string;
  /** ISO timestamp of the event. */
  createdAt: string;
}

export interface CreditsState {
  /** Wallet balance, Rand display (e.g. "R10.00"). */
  balanceZar: string;
  /** Balance as whole micro-cents in a string (client never needs bigint math). */
  balanceMicro: string;
  /** This period's spend, Rand display. */
  periodSpendZar: string;
  /** A soft monthly allowance (Rand display) for the progress bar. */
  allowanceZar: string;
  /** Progress: this period's spend as a % of the allowance (0–100, clamped). */
  usagePercent: number;
  period: string;
  recent: UsageLine[];
}

export type TopUpResult =
  | { kind: "credited"; state: CreditsState }
  | { kind: "checkout"; checkoutUrl: string; reference: string };

// A plain-language label for each metering kind family. We deliberately never
// surface model names or token counts to the owner (§6) — just what it was for.
function labelForKind(kind: string): string {
  const ns = kind.split(".")[0];
  switch (ns) {
    case "llm":
      return "AI assistance";
    case "hosting":
      return "Hosting usage";
    case "domain":
      return "Domain";
    case "email":
      return "Email";
    default:
      return "Usage";
  }
}

// A soft allowance for the progress bar. W2 uses a flat default; W3+ derives it
// from the plan's monthly credit grant. Kept here so the UI has a denominator.
const DEFAULT_ALLOWANCE_MICRO = 30n * MICRO_PER_RAND; // R30 (Growth-ish grant)

/** Read the current tenant's credits state for the /credits page + dashboard chip. */
export async function getCreditsStateAction(): Promise<CreditsState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const period = currentPeriod();

  const balanceMicro = await getBalance(repos, ctx.tenantId);
  const periodRows = await repos.usage.listByPeriod(ctx.tenantId, period);
  const periodSpend = periodRows.reduce((sum, r) => sum + r.amountMicro, 0n);
  const recentRows = await repos.usage.listRecent(ctx.tenantId, 20);

  const allowance = DEFAULT_ALLOWANCE_MICRO;
  const pct =
    allowance > 0n
      ? Math.min(100, Math.round(Number((periodSpend * 100n) / allowance)))
      : 0;

  return {
    balanceZar: formatMicroZar(balanceMicro),
    balanceMicro: balanceMicro.toString(),
    periodSpendZar: formatMicroZar(periodSpend),
    allowanceZar: formatMicroZar(allowance),
    usagePercent: pct,
    period,
    recent: recentRows.map((r) => ({
      id: r.id,
      label: labelForKind(r.kind),
      amountZar: formatMicroZar(r.amountMicro),
      createdAt: r.createdAt,
    })),
  };
}

/**
 * Top up the wallet by `amountRand` whole Rand. MOCK now: credits the wallet
 * directly (no charge) so the whole Credits UX is exercisable with no keys. With
 * Paystack keys this would instead begin a hosted checkout (token_topup SKU) and
 * credit on the webhook — see startTopUpCheckout in the metering service.
 */
export async function topUpAction(amountRand: number): Promise<TopUpResult> {
  const ctx = await requireTenant();
  if (!Number.isFinite(amountRand) || amountRand <= 0) {
    throw new Error("Enter a top-up amount greater than zero.");
  }
  // Cap a single mock top-up so a fat-fingered value can't mint a fortune.
  const capped = Math.min(Math.floor(amountRand), 100_000);
  if (capped <= 0) throw new Error("Enter a whole-Rand top-up amount.");

  const provider = selectBillingProvider();
  if (provider.charges) {
    const checkout = await startTopUpCheckout(
      ctx.tenantId,
      capped * 100,
      `${env.appUrl}/credits`,
      ctx.email,
    );
    return {
      kind: "checkout",
      checkoutUrl: checkout.checkoutUrl,
      reference: checkout.reference,
    };
  }

  const repos = await getRepositories();
  await topUp(repos, ctx.tenantId, BigInt(capped) * MICRO_PER_RAND);
  revalidatePath("/credits");
  revalidatePath("/");
  return { kind: "credited", state: await getCreditsStateAction() };
}
