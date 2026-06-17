// M6 — Billing service: the bridge between the SubscriptionRepository, the
// PaymentProvider billing verbs, and the pure entitlements resolver.
//
// Server-only (it touches repositories + the billing provider). Every function
// is tenant-scoped via an explicit tenantId resolved upstream from the session
// (src/lib/authz.ts). Runs end-to-end in mock mode with no DB and no secrets.

import type { Repositories, SubscriptionRecord } from "@/lib/db/types";
import type { Entitlements, PlanId } from "@/lib/billing/plans";
import { DEFAULT_PLAN, entitlementsFor, planFor } from "@/lib/billing/plans";
import {
  oneMonthFrom,
  selectBillingProvider,
  type CheckoutSession,
} from "@/integrations/payment/subscription";

/** A tenant's effective plan: the active subscription's plan, or Free. */
export function effectivePlan(
  sub: SubscriptionRecord | null,
): PlanId {
  if (!sub) return DEFAULT_PLAN;
  // Only active/trialing subscriptions grant the paid plan. A canceled (or
  // past_due/incomplete) subscription falls back to Free entitlements — except
  // a cancel-at-period-end subscription keeps its plan until the period ends.
  if (sub.status === "active" || sub.status === "trialing") return sub.plan;
  return DEFAULT_PLAN;
}

/** The effective entitlements for a tenant given its subscription row. */
export function entitlementsForSubscription(
  sub: SubscriptionRecord | null,
): Entitlements {
  return entitlementsFor(effectivePlan(sub));
}

/** Read a tenant's subscription (or null = Free). */
export async function getSubscription(
  repos: Repositories,
  tenantId: string,
): Promise<SubscriptionRecord | null> {
  return repos.subscriptions.get(tenantId);
}

/** Read a tenant's effective entitlements (loads the subscription first). */
export async function getEntitlements(
  repos: Repositories,
  tenantId: string,
): Promise<Entitlements> {
  const sub = await getSubscription(repos, tenantId);
  return entitlementsForSubscription(sub);
}

/**
 * Begin an upgrade: ask the billing provider for a checkout session. Free is not
 * a paid checkout (it is applied directly). The returned URL is where the UI
 * sends the user; in mock mode it is an in-app confirm route, with Paystack it
 * is the hosted checkout. NO charge happens here.
 */
export async function startUpgrade(
  tenantId: string,
  plan: PlanId,
  callbackUrl: string,
  customerEmail?: string | null,
): Promise<CheckoutSession> {
  const provider = selectBillingProvider();
  return provider.createCheckout({ tenantId, plan, callbackUrl, customerEmail });
}

/**
 * Activate a plan for a tenant (the lifecycle "active" transition). Called after
 * a successful (mock) checkout or by the webhook on a charge.success event.
 * Idempotent: re-activating the same plan just refreshes the period.
 */
export async function activatePlan(
  repos: Repositories,
  tenantId: string,
  plan: PlanId,
  opts: {
    provider?: string;
    providerSubscriptionId?: string | null;
    currentPeriodEnd?: string | null;
  } = {},
): Promise<SubscriptionRecord> {
  const paid = planFor(plan).priceCents > 0;
  const record = await repos.subscriptions.upsert(tenantId, {
    plan,
    status: "active",
    provider: opts.provider ?? "mock",
    providerSubscriptionId: opts.providerSubscriptionId ?? null,
    currentPeriodEnd:
      opts.currentPeriodEnd !== undefined
        ? opts.currentPeriodEnd
        : paid
          ? oneMonthFrom()
          : null,
    cancelAtPeriodEnd: false,
  });
  await repos.audit.append(tenantId, {
    actorId: null,
    action: "billing.activated",
    targetType: "subscription",
    targetId: record.id,
    metadata: { plan, provider: record.provider },
  });
  return record;
}

/**
 * Cancel a tenant's subscription. By default cancel-at-period-end (the plan
 * stays usable until currentPeriodEnd); pass `immediate` to drop to Free now.
 */
export async function cancelPlan(
  repos: Repositories,
  tenantId: string,
  opts: { immediate?: boolean } = {},
): Promise<SubscriptionRecord | null> {
  const sub = await repos.subscriptions.get(tenantId);
  if (!sub) return null;

  // Tell the provider (mock no-op beyond marking cancelAtPeriodEnd).
  if (sub.providerSubscriptionId) {
    const provider = selectBillingProvider();
    await provider.cancel({
      tenantId,
      providerSubscriptionId: sub.providerSubscriptionId,
    });
  }

  const record = await repos.subscriptions.upsert(tenantId, {
    plan: opts.immediate ? DEFAULT_PLAN : sub.plan,
    status: opts.immediate ? "canceled" : sub.status,
    currentPeriodEnd: opts.immediate ? null : sub.currentPeriodEnd,
    provider: sub.provider,
    providerSubscriptionId: sub.providerSubscriptionId,
    cancelAtPeriodEnd: !opts.immediate,
  });
  await repos.audit.append(tenantId, {
    actorId: null,
    action: "billing.canceled",
    targetType: "subscription",
    targetId: record.id,
    metadata: { immediate: Boolean(opts.immediate), plan: record.plan },
  });
  return record;
}
