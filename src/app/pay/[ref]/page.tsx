"use client";

// Public checkout page for WhatsApp payment links.
//
// Route: /pay/[ref]  — NO auth required (the customer is not a platform user).
// The ref is `wo_<orderId>` as produced by createOrderPaymentLink.
//
// Flow:
//   1. Page mounts → fetches /api/pay/[ref] for order data.
//   2. Customer sees order items + total in ZAR.
//   3. Paystack inline.js is loaded dynamically; clicking the button opens the
//      Paystack popup charged in ZAR cents (1 ZAR cent = 1 kobo; Paystack uses
//      the smallest unit of the currency, which for ZAR is cents, same as Rand
//      cents — i.e. amount in kobo equals amount in cents for ZAR).
//   4. On Paystack callback: POST /api/pay/[ref] to mark order paid.
//   5. Success screen shown.

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

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
  /** String representation of a BigInt (ZAR cents). */
  totalCents: string;
  status: string;
  customerContact: string;
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

/** Format ZAR cents as "R X,XXX.XX". */
function formatZar(cents: string | number): string {
  const num = typeof cents === "string" ? Number(cents) : cents;
  const rands = num / 100;
  return (
    "R " +
    rands.toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
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
              <span>{formatZar(item.priceCents * item.quantity)}</span>
            </div>
          ))}
        </div>

        <div className="checkout-total">
          <span>Total</span>
          <span>{formatZar(totalCents.toString())}</span>
        </div>

        <button
          className="checkout-pay-btn"
          onClick={handlePay}
          disabled={paying}
          aria-busy={paying}
        >
          {paying ? "Opening payment..." : `Pay ${formatZar(totalCents.toString())}`}
        </button>

        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          Secured by Paystack &bull; ZAR
        </p>
      </div>
    </div>
  );
}
