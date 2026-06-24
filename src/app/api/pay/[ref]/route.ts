// Public API for the /pay/[ref] checkout page.
//
// GET  /api/pay/[ref]
//   Returns order data for the checkout UI. No auth required — the payment link
//   is public (the customer has the ref). The ref is `wo_<orderId>` as produced
//   by createOrderPaymentLink. We extract the orderId from the ref and do a
//   cross-tenant lookup (the customer does not know their tenantId).
//   Response: { ref, tenantId, businessName, items, totalCents, status, customerContact }
//   404 if not found; 200 with { error: "already_paid" } if already settled.
//
// POST /api/pay/[ref]
//   Optimistic inline callback: body { reference: string } (Paystack transaction
//   reference). Marks the order paid in the DB for the UX confirmation flow.
//   The authoritative settlement is the signed Paystack webhook at
//   /api/webhooks/paystack — that handler is idempotent and wins if they race.

import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { isPersistent } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import type { WhatsappOrderRecord } from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ ref: string }>;
}

/**
 * Extract the order id from a payment link ref (`wo_<orderId>`).
 * Returns null for malformed refs so the caller can 404 cleanly.
 */
function parseRef(rawRef: string): { orderId: string; ref: string } | null {
  const ref = decodeURIComponent(rawRef);
  if (!ref.startsWith("wo_")) return null;
  const orderId = ref.slice(3);
  if (!orderId) return null;
  return { orderId, ref };
}

/**
 * Cross-tenant order lookup by orderId.
 *
 * In Prisma/Postgres mode: uses the singleton Prisma client with a cross-tenant
 * findFirst (no RLS session active — this is a public webhook/checkout route,
 * equivalent to how the Vercel/GitHub webhooks resolve tenants cross-tenant).
 *
 * In memory mode: imports the seed to know the dev tenant id, then calls the
 * repository's get() method. The memory repo stores all orders in a flat array
 * and the orderId is unique across all tenants.
 */
async function findOrderCrossTenant(
  orderId: string,
  paymentLinkRef: string,
): Promise<{ order: WhatsappOrderRecord; tenantId: string } | null> {
  const repos = await getRepositories();

  if (isPersistent()) {
    // Prisma mode: cross-tenant lookup via raw Prisma (no RLS session required
    // for public webhook resolution — matches the pattern in vercel/github webhook
    // routes that use resolveByProviderDeploymentId across tenants).
    const { prisma } = await import("@/lib/db/prisma/client");
    const row = await prisma.whatsappOrder.findFirst({
      where: { id: orderId },
      select: { tenantId: true },
    });
    if (!row) return null;
    const order = await repos.whatsappOrders.get(row.tenantId, orderId);
    if (!order || order.paymentLinkRef !== paymentLinkRef) return null;
    return { order, tenantId: row.tenantId };
  } else {
    // Memory mode: the dev tenant always holds the seed data. We try it first,
    // then fall back to any tenantId we can extract from the orderId itself.
    // The memory repo's whatsappOrders.get(tenantId, id) does a flat scan; the
    // orderId is unique (sequential ids), so the tenant check is secondary.
    const { DEV_TENANT_ID } = await import("@/lib/db/seed");
    const order = await repos.whatsappOrders.get(DEV_TENANT_ID, orderId);
    if (order && order.paymentLinkRef === paymentLinkRef) {
      return { order, tenantId: DEV_TENANT_ID };
    }
    return null;
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { ref: rawRef } = await params;
  const parsed = parseRef(rawRef);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid payment link." }, { status: 404 });
  }

  const { orderId, ref } = parsed;

  try {
    const result = await findOrderCrossTenant(orderId, ref);

    if (!result) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const { order, tenantId } = result;

    // Already paid — return 200 with an already_paid flag so the client can show
    // the success screen without re-rendering an error.
    if (order.status === "paid" || order.status === "fulfilled") {
      const repos = await getRepositories();
      const biz = await repos.businesses.getPrimary(tenantId);
      return NextResponse.json({
        error: "already_paid",
        status: order.status,
        businessName: biz?.name ?? "Your Order",
      });
    }

    const repos = await getRepositories();
    const biz = await repos.businesses.getPrimary(tenantId);

    return NextResponse.json({
      ref,
      tenantId,
      businessName: biz?.name ?? "Your Order",
      items: order.items,
      // BigInt is not JSON-serializable — send as a string; the client parses it.
      totalCents: order.totalCents.toString(),
      status: order.status,
      customerContact: order.customerContact,
    });
  } catch (error) {
    await captureError("pay.route.get_failed", error);
    return NextResponse.json({ error: "Failed to load order." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  const { ref: rawRef } = await params;
  const parsed = parseRef(rawRef);

  if (!parsed) {
    return NextResponse.json({ error: "Invalid payment link." }, { status: 404 });
  }

  const { orderId, ref } = parsed;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      reference?: string;
    };
    const paystackRef = body?.reference ?? null;

    const result = await findOrderCrossTenant(orderId, ref);
    if (!result) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const { order, tenantId } = result;

    // Idempotent: if already paid, acknowledge without re-applying.
    if (order.status === "paid" || order.status === "fulfilled") {
      return NextResponse.json({ ok: true, alreadyPaid: true });
    }

    const repos = await getRepositories();

    // Optimistically mark the order paid for the UX confirmation flow.
    // The signed Paystack webhook at /api/webhooks/paystack is the authoritative
    // settlement; it will de-dupe via the webhookDedup store if it races.
    await repos.whatsappOrders.update(tenantId, order.id, { status: "paid" });

    await repos.audit.append(tenantId, {
      actorId: null,
      action: "whatsapp.order_paid_inline",
      targetType: "order",
      targetId: order.id,
      metadata: { ref, paystackRef, channel: "inline_checkout" },
    });

    logger.info("pay.route.order_marked_paid", { orderId: order.id, ref });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureError("pay.route.post_failed", error);
    return NextResponse.json(
      { error: "Failed to process payment." },
      { status: 500 },
    );
  }
}
