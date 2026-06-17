"use server";

// M6 — Billing server actions the dashboard, /pricing, and billing settings call.
//
// All tenant scoping comes from requireTenant(); the client never supplies a
// tenant. In mock mode these run against the in-memory repo + the mock billing
// provider (no real charge): "upgrade" simulates an active subscription. With
// Paystack keys the same call sites drive a real checkout — no UI change.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { env } from "@/lib/env";
import {
  isPlanId,
  planFor,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";
import {
  activatePlan,
  cancelPlan,
  effectivePlan,
  startUpgrade,
} from "@/lib/billing/service";
import type { SubscriptionRecord } from "@/lib/db/types";

export interface BillingState {
  plan: PlanId;
  planName: string;
  status: SubscriptionRecord["status"] | "none";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string;
}

/** Read the current tenant's billing state for the settings view + dashboard. */
export async function getBillingStateAction(): Promise<BillingState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const sub = await repos.subscriptions.get(ctx.tenantId);
  const plan = effectivePlan(sub);
  const def: Plan = planFor(plan);
  return {
    plan,
    planName: def.name,
    status: sub?.status ?? "none",
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    provider: sub?.provider ?? "mock",
  };
}

export interface UpgradeResult {
  /** Where the client should send the user to complete checkout. */
  checkoutUrl: string;
  reference: string;
}

/**
 * Begin upgrading to a paid plan. Returns a checkout URL (mock confirm route now,
 * Paystack hosted checkout later). Free is applied directly (no checkout).
 */
export async function startUpgradeAction(plan: PlanId): Promise<UpgradeResult> {
  const ctx = await requireTenant();
  if (!isPlanId(plan)) throw new Error("Unknown plan.");

  // Downgrade/select Free: apply immediately, no checkout.
  if (planFor(plan).priceCents === 0) {
    const repos = await getRepositories();
    await cancelPlan(repos, ctx.tenantId, { immediate: true });
    revalidatePath("/billing");
    revalidatePath("/");
    return { checkoutUrl: "/billing", reference: "free" };
  }

  const callbackUrl = `${env.appUrl}/billing/confirm`;
  const session = await startUpgrade(ctx.tenantId, plan, callbackUrl, ctx.email);
  return { checkoutUrl: session.checkoutUrl, reference: session.reference };
}

/**
 * Confirm a (mock) successful checkout: activate the plan for the tenant. With
 * Paystack this is corroborated by the webhook; the mock activates on return.
 */
export async function confirmUpgradeAction(
  plan: PlanId,
  reference: string,
): Promise<BillingState> {
  const ctx = await requireTenant();
  if (!isPlanId(plan)) throw new Error("Unknown plan.");
  const repos = await getRepositories();
  await activatePlan(repos, ctx.tenantId, plan, {
    provider: "mock",
    providerSubscriptionId: reference,
  });
  revalidatePath("/billing");
  revalidatePath("/");
  return getBillingStateAction();
}

/** Cancel the current subscription (at period end by default). */
export async function cancelSubscriptionAction(
  immediate = false,
): Promise<BillingState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  await cancelPlan(repos, ctx.tenantId, { immediate });
  revalidatePath("/billing");
  revalidatePath("/");
  return getBillingStateAction();
}
