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

// --- Real Paystack billing provider -----------------------------------------
// Uses the Paystack REST API (https://api.paystack.co) via fetch (no SDK). It
// stays DORMANT until PAYSTACK_SECRET_KEY is set — selectBillingProvider() only
// constructs it then. We pass metadata.tenantId + metadata.plan so the webhook
// can resolve the owning tenant, and map our PlanId -> Paystack plan codes from
// env (PAYSTACK_PLAN_GROWTH / PAYSTACK_PLAN_PRO). The secret key is read only
// server-side and never logged.

const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Our PlanId -> Paystack plan code, from env. Free has no Paystack plan. */
function paystackPlanCode(plan: PlanId): string | undefined {
  switch (plan) {
    case "growth":
      return process.env.PAYSTACK_PLAN_GROWTH?.trim() || undefined;
    case "pro":
      return process.env.PAYSTACK_PLAN_PRO?.trim() || undefined;
    default:
      return undefined; // free
  }
}

/** Map a Paystack subscription `status` string to our ProviderSubscription status. */
function mapPaystackStatus(
  status: string | undefined,
): ProviderSubscription["status"] {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "active";
    case "non-renewing":
    case "cancelled":
    case "canceled":
    case "complete":
      return "canceled";
    case "attention":
      return "past_due";
    default:
      return "incomplete";
  }
}

async function paystackFetch(
  secretKey: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: unknown;
  };
  if (!res.ok || json.status === false) {
    // Surface a generic error (never echo the secret); message is from Paystack.
    throw new Error(
      `paystack_error:${res.status}:${json.message ?? "unknown"}`,
    );
  }
  return json.data;
}

export interface PaystackInitializeInput {
  amountCents: number;
  currency: "ZAR";
  callbackUrl: string;
  customerEmail?: string | null;
  planCode?: string;
  metadata: Record<string, string | number | boolean | null | undefined>;
}

export async function initializePaystackTransaction(
  secretKey: string,
  input: PaystackInitializeInput,
): Promise<CheckoutSession> {
  const data = (await paystackFetch(secretKey, "/transaction/initialize", {
    method: "POST",
    body: {
      email: input.customerEmail ?? undefined,
      amount: input.amountCents,
      currency: input.currency,
      callback_url: input.callbackUrl,
      ...(input.planCode ? { plan: input.planCode } : {}),
      metadata: input.metadata,
    },
  })) as { authorization_url?: string; reference?: string };

  if (!data.authorization_url || !data.reference) {
    throw new Error("paystack_init_missing_fields");
  }
  return {
    checkoutUrl: data.authorization_url,
    reference: data.reference,
  };
}

export function paystackBillingProvider(): BillingProvider {
  const secretKey = process.env.PAYSTACK_SECRET_KEY!.trim();
  return {
    name: "paystack",
    charges: true,
    async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
      const plan = planFor(input.plan);
      // Initialize a transaction -> hosted checkout URL. Amount is in the
      // currency's subunit (ZAR cents), which matches Plan.priceCents. The
      // plan code (when set) turns this into a recurring subscription on charge.
      const planCode = paystackPlanCode(input.plan);
      return initializePaystackTransaction(secretKey, {
        amountCents: plan.priceCents,
        currency: plan.currency,
        callbackUrl: input.callbackUrl,
        customerEmail: input.customerEmail,
        planCode,
        metadata: { tenantId: input.tenantId, plan: input.plan },
      });
    },
    async cancel(input: CancelInput): Promise<ProviderSubscription> {
      // Fetch the subscription to get the email token Paystack requires to
      // disable it, then disable (cancel at period end — Paystack stops renewal).
      const sub = (await paystackFetch(
        secretKey,
        `/subscription/${encodeURIComponent(input.providerSubscriptionId)}`,
        { method: "GET" },
      )) as {
        subscription_code?: string;
        email_token?: string;
        status?: string;
        next_payment_date?: string;
        plan?: { plan_code?: string };
      };
      if (sub.subscription_code && sub.email_token) {
        await paystackFetch(secretKey, "/subscription/disable", {
          method: "POST",
          body: { code: sub.subscription_code, token: sub.email_token },
        });
      }
      return {
        plan: input.providerSubscriptionId ? planFromCode(sub.plan?.plan_code) : "free",
        status: "canceled",
        providerSubscriptionId: input.providerSubscriptionId,
        currentPeriodEnd: sub.next_payment_date ?? null,
        cancelAtPeriodEnd: true,
      };
    },
    async fetchStatus(
      providerSubscriptionId: string,
    ): Promise<ProviderSubscription | null> {
      try {
        const sub = (await paystackFetch(
          secretKey,
          `/subscription/${encodeURIComponent(providerSubscriptionId)}`,
          { method: "GET" },
        )) as {
          status?: string;
          next_payment_date?: string;
          plan?: { plan_code?: string };
        };
        return {
          plan: planFromCode(sub.plan?.plan_code),
          status: mapPaystackStatus(sub.status),
          providerSubscriptionId,
          currentPeriodEnd: sub.next_payment_date ?? null,
          cancelAtPeriodEnd: mapPaystackStatus(sub.status) === "canceled",
        };
      } catch {
        return null;
      }
    },
  };
}

/** Reverse-map a Paystack plan code back to our PlanId (best effort, env-driven). */
function planFromCode(code: string | undefined): PlanId {
  if (!code) return "free";
  if (code === process.env.PAYSTACK_PLAN_GROWTH?.trim()) return "growth";
  if (code === process.env.PAYSTACK_PLAN_PRO?.trim()) return "pro";
  return "free";
}

/**
 * Select the active billing provider. MOCK by default; returns the real Paystack
 * provider only once PAYSTACK_SECRET_KEY is present. With no key, card charging
 * is dormant and the whole billing UX runs on the mock — the M6 contract.
 */
export function selectBillingProvider(): BillingProvider {
  const hasPaystack = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  return hasPaystack ? paystackBillingProvider() : mockBillingProvider();
}

/** Exposed for tests: reset the per-process mock billing store. */
export function __resetBillingStore(): void {
  globalForBilling.__launchDeskBilling = new Map();
}
