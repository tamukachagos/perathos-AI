// M6 — PaymentProvider subscription verbs (billing).
//
// This is the billing surface of the PaymentProvider adapter: create a checkout
// for a plan, cancel a subscription, and fetch its provider-side status. It is
// SEPARATE from the M3 ActionRouter `payment.configure` verb (which configures a
// customer's payout account) — these verbs bill the Launch Desk TENANT.
//
// MOCK now / Paystack-ready: the interface is shaped for Paystack's
// transaction/subscription API. In mock mode "upgrade" instantly simulates an
// active subscription (no real charge). Real card charging stays DORMANT behind
// env until PAYSTACK_SECRET_KEY exists; selectBillingProvider() picks the impl.

import { randomBytes } from "node:crypto";
import type { PlanId } from "@/lib/billing/plans";
import { planFor } from "@/lib/billing/plans";

/** A subscription as the billing provider sees it (provider-side truth). */
export interface ProviderSubscription {
  plan: PlanId;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  /** Provider's subscription id/code. */
  providerSubscriptionId: string;
  /** ISO timestamp the paid period ends (null when free/never billed). */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface CreateCheckoutInput {
  tenantId: string;
  plan: PlanId;
  /** Where the provider redirects after a (mock) successful payment. */
  callbackUrl: string;
  /** Email to bill (the tenant owner); never card data. */
  customerEmail?: string | null;
}

export interface CheckoutSession {
  /** URL to send the customer to in order to complete payment. */
  checkoutUrl: string;
  /** The provider subscription/transaction reference for this attempt. */
  reference: string;
}

export interface CancelInput {
  tenantId: string;
  providerSubscriptionId: string;
}

/** The provider name a billing impl reports (stored on the subscription row). */
export interface BillingProvider {
  readonly name: string;
  /** True when this provider actually charges cards (false for the mock). */
  readonly charges: boolean;
  /** Begin a checkout for a paid plan. */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Cancel at period end (the plan stays active until currentPeriodEnd). */
  cancel(input: CancelInput): Promise<ProviderSubscription>;
  /** Fetch the provider-side subscription status. */
  fetchStatus(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription | null>;
}

/** One month from `from`, as an ISO string — the mock billing period. */
export function oneMonthFrom(from: Date = new Date()): string {
  const end = new Date(from);
  end.setMonth(end.getMonth() + 1);
  return end.toISOString();
}

// --- Mock billing provider ---------------------------------------------------
// No real charge. createCheckout returns an internal mock-checkout URL that the
// upgrade flow treats as "instantly paid". cancel marks cancelAtPeriodEnd. A
// per-process map keeps just enough state for fetchStatus to be coherent.

const globalForBilling = globalThis as unknown as {
  __launchDeskBilling?: Map<string, ProviderSubscription>;
};
const billingStore = (globalForBilling.__launchDeskBilling ??= new Map());

export function mockBillingProvider(): BillingProvider {
  return {
    name: "mock",
    charges: false,
    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
      const reference = `mock_sub_${randomBytes(9).toString("hex")}`;
      // Record the would-be subscription so fetchStatus is coherent if polled.
      billingStore.set(reference, {
        plan: input.plan,
        status: "active",
        providerSubscriptionId: reference,
        currentPeriodEnd:
          planFor(input.plan).priceCents > 0 ? oneMonthFrom() : null,
        cancelAtPeriodEnd: false,
      });
      // Mock checkout: a route in-app that confirms the (free) "payment" and
      // activates the plan. With Paystack this becomes the hosted checkout URL.
      const url = new URL(input.callbackUrl);
      url.searchParams.set("reference", reference);
      url.searchParams.set("plan", input.plan);
      return { checkoutUrl: url.toString(), reference };
    },
    async cancel(input: CancelInput): Promise<ProviderSubscription> {
      const existing = billingStore.get(input.providerSubscriptionId);
      const sub: ProviderSubscription = existing ?? {
        plan: "free",
        status: "active",
        providerSubscriptionId: input.providerSubscriptionId,
        currentPeriodEnd: oneMonthFrom(),
        cancelAtPeriodEnd: false,
      };
      const canceled: ProviderSubscription = { ...sub, cancelAtPeriodEnd: true };
      billingStore.set(input.providerSubscriptionId, canceled);
      return canceled;
    },
    async fetchStatus(
      providerSubscriptionId: string,
    ): Promise<ProviderSubscription | null> {
      return billingStore.get(providerSubscriptionId) ?? null;
    },
  };
}

/**
 * Select the active billing provider. MOCK by default; returns the real Paystack
 * provider only once PAYSTACK_SECRET_KEY is present (M-future). Today only the
 * mock exists, so card charging is dormant with no keys — the M6 contract.
 */
export function selectBillingProvider(): BillingProvider {
  const hasPaystack = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  // When the real Paystack adapter lands it is constructed here; until then the
  // mock is always used so the whole billing UX runs with no secrets.
  if (hasPaystack) {
    // return paystackBillingProvider();  // (M-future, real charge)
  }
  return mockBillingProvider();
}

/** Exposed for tests: reset the per-process mock billing store. */
export function __resetBillingStore(): void {
  globalForBilling.__launchDeskBilling = new Map();
}
