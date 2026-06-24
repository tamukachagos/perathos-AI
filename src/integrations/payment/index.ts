import "server-only";
import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluatePayments } from "@/integrations/core/readiness";
import { isStripeConfigured } from "./stripeProvider";

// Payment links (Paystack / Yoco / PayFast). Connecting a payout account is
// a risky verb → approval.
export const paymentAdapter = createMockAdapter({
  interfaceName: "PaymentProvider",
  provider: "Paystack / Yoco / PayFast",
  approvalGated: true,
  evaluate: evaluatePayments,
});

/** True when PAYSTACK_SECRET_KEY is present in env. */
export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

/**
 * Returns the preferred payment gateway for a given region string.
 *
 * - "af-south" (Africa): Paystack first, Stripe fallback.
 * - All other regions: Stripe first, Paystack fallback.
 * - "mock" when neither is configured.
 *
 * Region is a short string resolved from Accept-Language or IP geolocation
 * at the call site. Pass "af-south" for ZAR/African orders, any other string
 * (e.g. "eu", "us", "global") for international orders.
 */
export function getPreferredGateway(
  region: string,
): "stripe" | "paystack" | "mock" {
  if (region === "af-south") {
    // Africa: prefer Paystack (ZAR native), fall back to Stripe.
    if (isPaystackConfigured()) return "paystack";
    if (isStripeConfigured()) return "stripe";
  } else {
    // Global: prefer Stripe, fall back to Paystack.
    if (isStripeConfigured()) return "stripe";
    if (isPaystackConfigured()) return "paystack";
  }
  return "mock";
}
