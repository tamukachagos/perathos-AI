"use client";

// Public checkout page for WhatsApp payment links.
//
// Route: /pay/[ref]  — NO auth required (the customer is not a platform user).
// The ref is `wo_<orderId>` as produced by createOrderPaymentLink.
//
// Flow:
//   1. Page mounts → fetches /api/pay/[ref] for order data.
//   2. Customer sees order items + total.
//   3a. ZAR / af-south: Paystack inline.js popup (existing path).
//   3b. Other currencies: Stripe Checkout redirect via /api/pay/[ref]/stripe-session.
//   4. On Paystack callback: POST /api/pay/[ref] to mark order paid.
//   5. Success screen shown.
//
// Currency note: WhatsappOrder has no `currency` DB column yet (ZAR-only schema).
// The `currency` field on OrderData defaults to "ZAR" until a migration adds it.

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { formatCents } from "@/lib/global/currency";

// --- Types -------------------------------------------------------------------

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
}

interface OrderData {
  ref: string;
  tenantId: string;
  businessName: string;
  items: OrderItem[];
  /** String representation of a BigInt (smallest currency unit). */
  totalCents: string;
  status: string;
  customerContact: string;
  /**
   * ISO 4217 currency code. Defaults to "ZAR" — the WhatsappOrder schema
   * does not yet carry a currency column. When a migration adds it, the API
   * will populate this field from the DB row.
   */
  currency?: string;
  /** Set when the GET returns 200 with error: "already_paid". */
  alreadyPaid?: boolean;
}

// --- Paystack inline type ---------------------------------------------------

declare global {
  interface Window {
    PaystackPop?: {
      setup(opts: {
        key: string;
        email: string;
        amount: number;
        currency: string;
        ref: string;
        metadata?: Record<string, unknown>;
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      }): { openIframe(): void };
    };
  }
}

// --- Helpers ----------------------------------------------------------------

/**
 * Format an amount in the given currency's smallest unit.
 * Delegates to formatCents from @/lib/global/currency for multi-currency
 * support. Falls back to ZAR if currency is unset (no DB column yet).
 */
function formatAmount(cents: string | number | bigint, currency = "ZAR"): string {
  return formatCents(Number(cents), currency);
}

/** Dynamically load the Paystack inline.js script (idempotent). */
function loadPaystackScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PaystackPop) {
      resolve();
      return;
    }
    const existing = document.getElementById("paystack-inline-js");
    if (existing) {
      // Script already injected; wait for it to load.
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "paystack-inline-js";
    script.src = "https://js.paystack.co/v1/inline.js";
    script.onload = () => resolve();
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

// --- Page component ---------------------------------------------------------

export default function CheckoutPage() {
  const params = useParams<{ ref: string }>();
  const ref = decodeURIComponent(params.ref ?? "");

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  // Fetch order data on mount.
  useEffect(() => {
    if (!ref) return;
    fetch(`/api/pay/${encodeURIComponent(ref)}`)
      .then(async (res) => {
        const data = (await res.json()) as OrderData & {
          error?: string;
          alreadyPaid?: boolean;
        };
        if (res.status === 404) {
          setError("This payment link is not valid or has expired.");
          return;
        }
        if (data.error === "already_paid") {
          // Order already settled — show success immediately.
          setOrder({
            ref,
            tenantId: "",
            businessName: data.businessName ?? "",
            items: [],
            totalCents: "0",
            status: data.status ?? "paid",
            customerContact: "",
            alreadyPaid: true,
          });
          setPaid(true);
          return;
        }
        if (data.error) {
          setError(data.error);
          return;
        }
        setOrder(data as OrderData);
      })
      .catch(() => setError("Could not load the order. Please try again."))
      .finally(() => setLoading(false));
  }, [ref]);

  // Mark loading done when order is set.
  useEffect(() => {
    if (order) setLoading(false);
  }, [order]);

  const handlePay = useCallback(async () => {
    if (!order || paying) return;

    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
    if (!publicKey) {
      setError("Payment is not yet configured. Please contact the business.");
      return;
    }

    setPaying(true);
    try {
      await loadPaystackScript();
    } catch {
      setError("Failed to load payment system. Please refresh and try again.");
      setPaying(false);
      return;
    }

    if (!window.PaystackPop) {
      setError("Payment system unavailable. Please try again.");
      setPaying(false);
      return;
    }

    // Paystack ZAR: amount is in ZAR cents (kobo equivalent for ZAR).
    const amountInCents = Number(order.totalCents);

    // Use the customer's WhatsApp contact as the email placeholder if we don't
    // have an actual email. Paystack requires an email field; we use a synthetic
    // one derived from the contact so the popup shows something meaningful.
    const email = order.customerContact.includes("@")
      ? order.customerContact
      : `${order.customerContact.replace(/\D/g, "")}@checkout.launchdesk.app`;

    const handler = window.PaystackPop.setup({
      key: publicKey,
      email,
      amount: amountInCents,
      currency: "ZAR",
      ref: `ld_${ref}_${Date.now()}`,
      metadata: {
        custom_fields: [
          {
            display_name: "Order Ref",
            variable_name: "order_ref",
            value: ref,
          },
          {
            display_name: "Business",
            variable_name: "business_name",
            value: order.businessName,
          },
        ],
      },
      callback: async (response: { reference: string }) => {
        // Paystack confirmed payment — POST to our API to mark order paid.
        try {
          await fetch(`/api/pay/${encodeURIComponent(ref)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reference: response.reference }),
          });
        } catch {
          // Non-fatal: the Paystack webhook will settle the order server-side.
        }
        setPaid(true);
        setPaying(false);
      },
      onClose: () => {
        setPaying(false);
      },
    });

    handler.openIframe();
  }, [order, paying, ref]);

  /**
   * Stripe Checkout redirect — used for non-ZAR / non-af-south orders.
   * Calls /api/pay/[ref]/stripe-session to create a Stripe Checkout Session,
   * then redirects the browser to the hosted Stripe checkout URL.
   */
  const handleStripeCheckout = useCallback(async () => {
    if (!order || stripeLoading) return;
    setStripeLoading(true);
    setStripeError(null);
    try {
      const res = await fetch(
        `/api/pay/${encodeURIComponent(ref)}/stripe-session`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        setStripeError(data.error ?? "Failed to start Stripe checkout.");
        setStripeLoading(false);
      }
    } catch {
      setStripeError("Could not reach Stripe. Please try again.");
      setStripeLoading(false);
    }
  }, [order, stripeLoading, ref]);

  // --- Render -----------------------------------------------------------------

  if (loading) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <p style={{ color: "var(--muted)", textAlign: "center" }}>
            Loading order...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <div className="checkout-success">
            <h2 style={{ color: "var(--heading)" }}>Unable to Load Order</h2>
            <p style={{ color: "var(--muted)", marginTop: 8 }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="checkout-page">
        <div className="checkout-card">
          <div className="checkout-success">
            <div
              style={{
                fontSize: 48,
                marginBottom: 16,
                lineHeight: 1,
              }}
            >
              &#10003;
            </div>
            <h2>Payment received!</h2>
            <p style={{ color: "var(--muted)", marginTop: 8 }}>
              {"You'll get a WhatsApp confirmation shortly."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const totalCents = BigInt(order.totalCents);
  // Default to ZAR — no currency column in WhatsappOrder schema yet.
  const currency = order.currency ?? "ZAR";
  // Use Paystack inline for ZAR orders (af-south path); Stripe for everything else.
  const usePaystack = currency === "ZAR";

  return (
    <div className="checkout-page">
      <div className="checkout-card">
        <p className="checkout-biz">{order.businessName}</p>
        <h1 className="checkout-title">Complete your order</h1>

        <div className="checkout-items">
          {order.items.map((item, idx) => (
            <div className="checkout-item" key={idx}>
              <span>
                {item.name}
                {item.quantity > 1 && (
                  <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                    &times;{item.quantity}
                  </span>
                )}
              </span>
              <span>{formatAmount(item.priceCents * item.quantity, currency)}</span>
            </div>
          ))}
        </div>

        <div className="checkout-total">
          <span>Total</span>
          <span>{formatAmount(totalCents, currency)}</span>
        </div>

        {usePaystack ? (
          <button
            className="checkout-pay-btn"
            onClick={handlePay}
            disabled={paying}
            aria-busy={paying}
          >
            {paying
              ? "Opening payment..."
              : `Pay ${formatAmount(totalCents, currency)}`}
          </button>
        ) : (
          <>
            <button
              className="checkout-pay-btn"
              onClick={handleStripeCheckout}
              disabled={stripeLoading}
              aria-busy={stripeLoading}
            >
              {stripeLoading
                ? "Redirecting to Stripe..."
                : `Pay ${formatAmount(totalCents, currency)}`}
            </button>
            {stripeError && (
              <p
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: "var(--error, #e53e3e)",
                  textAlign: "center",
                }}
              >
                {stripeError}
              </p>
            )}
          </>
        )}

        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          {usePaystack
            ? `Secured by Paystack • ${currency}`
            : `Secured by Stripe • ${currency}`}
        </p>
      </div>
    </div>
  );
}
