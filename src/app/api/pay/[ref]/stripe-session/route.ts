// POST /api/pay/[ref]/stripe-session
//
// Creates a Stripe Checkout Session for a WhatsApp order ref (`wo_<orderId>`)
// and returns { checkoutUrl } for the client to redirect to.
//
// The WhatsappOrder schema does not yet carry a `currency` column (ZAR-only in
// the current DB). When global currencies are added via migration, replace the
// `currency: "ZAR"` constant here with `order.currency ?? "ZAR"`.

import { NextRequest, NextResponse } from "next/server";
import {
  createStripeCheckoutSession,
  isStripeConfigured,
} from "@/integrations/payment/stripeProvider";
import { getRepositories, isPersistent } from "@/lib/db";
import { captureError } from "@/lib/observability";

export const dynamic = "force-dynamic";

/**
 * Extract the order id from a payment link ref (`wo_<orderId>`).
 * Returns null for malformed refs.
 */
function parseRef(rawRef: string): { orderId: string; ref: string } | null {
  const ref = decodeURIComponent(rawRef);
  if (!ref.startsWith("wo_")) return null;
  const orderId = ref.slice(3);
  if (!orderId) return null;
  return { orderId, ref };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 503 },
    );
  }

  const { ref: rawRef } = await params;
  const parsed = parseRef(rawRef);

  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid payment link." },
      { status: 404 },
    );
  }

  const { orderId, ref } = parsed;

  try {
    // Cross-tenant lookup — mirrors the pattern in the main pay/[ref] GET route.
    const repos = await getRepositories();

    let order: Awaited<ReturnType<typeof repos.whatsappOrders.get>>;
    let tenantId: string;

    if (isPersistent()) {
      const { prisma } = await import("@/lib/db/prisma/client");
      const row = await prisma.whatsappOrder.findFirst({
        where: { id: orderId },
        select: { tenantId: true },
      });
      if (!row) {
        return NextResponse.json(
          { error: "Order not found." },
          { status: 404 },
        );
      }
      tenantId = row.tenantId;
      order = await repos.whatsappOrders.get(tenantId, orderId);
    } else {
      // Memory mode: use dev tenant.
      const { DEV_TENANT_ID } = await import("@/lib/db/seed");
      tenantId = DEV_TENANT_ID;
      order = await repos.whatsappOrders.get(tenantId, orderId);
    }

    if (!order || order.paymentLinkRef !== ref) {
      return NextResponse.json(
        { error: "Order not found." },
        { status: 404 },
      );
    }

    if (order.status === "paid" || order.status === "fulfilled") {
      return NextResponse.json(
        { error: "Order already paid." },
        { status: 409 },
      );
    }

    // WhatsappOrder.totalCents is ZAR cents (BigInt). No currency column exists
    // yet — default to ZAR. When a currency migration lands, swap this constant.
    const amountCents = Number(order.totalCents);
    const currency = "ZAR";

    const { checkoutUrl } = await createStripeCheckoutSession({
      amountCents,
      currency,
      tenantId,
      planKey: "invoice",
      successUrl: `${process.env.NEXTAUTH_URL}/pay/${encodeURIComponent(ref)}?stripe=success`,
      cancelUrl: `${process.env.NEXTAUTH_URL}/pay/${encodeURIComponent(ref)}?stripe=cancel`,
    });

    return NextResponse.json({ checkoutUrl });
  } catch (error) {
    await captureError("stripe.session.create_failed", error);
    return NextResponse.json(
      { error: "Failed to create Stripe session." },
      { status: 500 },
    );
  }
}
