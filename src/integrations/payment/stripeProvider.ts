"use server";

export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY);
}

async function stripePost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const params = new URLSearchParams();
  function flatten(obj: Record<string, unknown>, prefix = "") {
    for (const [k, v] of Object.entries(obj)) {
      const key2 = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && v !== undefined) {
        if (typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, key2);
        else params.append(key2, String(v));
      }
    }
  }
  flatten(body);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Stripe error: ${JSON.stringify(data)}`);
  return data;
}

async function stripeGet(path: string): Promise<unknown> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(`Stripe error: ${JSON.stringify(data)}`);
  return data;
}

export interface StripeCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
}

export async function createStripeCheckoutSession(opts: {
  amountCents: number;
  currency: string;
  tenantId: string;
  planKey: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<StripeCheckoutResult> {
  const session = await stripePost("checkout/sessions", {
    mode: "subscription",
    "line_items[0][price_data][currency]": opts.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": opts.amountCents,
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": `Launch Desk ${opts.planKey} Plan`,
    "line_items[0][quantity]": 1,
    "metadata[tenantId]": opts.tenantId,
    "metadata[planKey]": opts.planKey,
    success_url: opts.successUrl ?? `${process.env.NEXTAUTH_URL}/dashboard?upgraded=true`,
    cancel_url: opts.cancelUrl ?? `${process.env.NEXTAUTH_URL}/dashboard`,
  }) as { url: string; id: string };
  return { checkoutUrl: session.url, sessionId: session.id };
}

export async function createStripePaymentLink(opts: {
  amountCents: number;
  currency: string;
  description: string;
  orderId?: string;
}): Promise<string> {
  const link = await stripePost("payment_links", {
    "line_items[0][price_data][currency]": opts.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": opts.amountCents,
    "line_items[0][price_data][product_data][name]": opts.description,
    "line_items[0][quantity]": 1,
    "metadata[orderId]": opts.orderId ?? "",
  }) as { url: string };
  return link.url;
}

export async function getStripeSubscriptionStatus(subscriptionId: string): Promise<{
  active: boolean;
  plan: string;
  expiresAt: string | null;
}> {
  try {
    const sub = await stripeGet(`subscriptions/${subscriptionId}`) as {
      status: string;
      metadata: { planKey?: string };
      current_period_end: number;
    };
    return {
      active: sub.status === "active" || sub.status === "trialing",
      plan: sub.metadata?.planKey ?? "growth",
      expiresAt: new Date(sub.current_period_end * 1000).toISOString(),
    };
  } catch {
    return { active: false, plan: "free", expiresAt: null };
  }
}
