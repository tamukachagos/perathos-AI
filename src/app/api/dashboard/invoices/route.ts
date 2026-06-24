// Customer invoicing API (tenant-scoped).
//
//   GET  /api/dashboard/invoices        — list invoices for the signed-in tenant
//   POST /api/dashboard/invoices        — create a new invoice
//   PATCH /api/dashboard/invoices       — update invoice status (id in body)
//
// Tenant scoping via requireTenant(); the body never carries a tenantId.
// Invoice numbers are auto-generated as INV-XXXX, sequenced per tenant.
// Money is stored as BigInt cents (ZAR). The items field is a JSON array.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** ZAR cents as bigint from a Rand float (e.g. 150.00 → 15000n). */
function randToCents(v: unknown): bigint {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 100));
}

interface LineItemInput {
  description?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
}

interface CreateBody {
  customerName?: unknown;
  customerEmail?: unknown;
  customerPhone?: unknown;
  items?: unknown;
  vatEnabled?: unknown;
  notes?: unknown;
  dueDate?: unknown;
}

interface PatchBody {
  id?: unknown;
  status?: unknown;
  paymentRef?: unknown;
}

// --------------------------------------------------------------------------
// GET — list invoices
// --------------------------------------------------------------------------

export async function GET() {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const invoices = await prisma.customerInvoice.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });

    // Serialize BigInt fields to strings for JSON transport.
    const safe = invoices.map((inv) => ({
      ...inv,
      subtotalCents: inv.subtotalCents.toString(),
      taxCents: inv.taxCents.toString(),
      totalCents: inv.totalCents.toString(),
    }));

    return NextResponse.json({ ok: true, invoices: safe });
  } catch (err) {
    logger.error("invoices.list.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// --------------------------------------------------------------------------
// POST — create invoice
// --------------------------------------------------------------------------

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const customerName = asString(body.customerName).trim();
  if (!customerName) {
    return NextResponse.json({ ok: false, error: "customer_name_required" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? (body.items as LineItemInput[]) : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ ok: false, error: "items_required" }, { status: 400 });
  }

  const items = rawItems.map((item) => ({
    description: asString(item.description).trim() || "Item",
    qty: Math.max(1, Number(item.qty) || 1),
    unitPrice: Math.max(0, parseFloat(String(item.unitPrice)) || 0),
  }));

  // Compute totals.
  const subtotalRand = items.reduce((acc, it) => acc + it.qty * it.unitPrice, 0);
  const subtotalCents = BigInt(Math.round(subtotalRand * 100));
  const vatEnabled = body.vatEnabled === true;
  const taxCents = vatEnabled ? BigInt(Math.round(Number(subtotalCents) * 0.15)) : 0n;
  const totalCents = subtotalCents + taxCents;

  try {
    const { prisma } = await import("@/lib/db/prisma/client");

    // Sequence the invoice number per tenant: count existing + 1.
    const count = await prisma.customerInvoice.count({
      where: { tenantId: ctx.tenantId },
    });
    const number = `INV-${String(count + 1).padStart(4, "0")}`;

    const invoice = await prisma.customerInvoice.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        customerName,
        customerEmail: asString(body.customerEmail).trim() || null,
        customerPhone: asString(body.customerPhone).trim() || null,
        items,
        subtotalCents,
        taxCents,
        totalCents,
        status: "draft",
        dueDate: asString(body.dueDate).trim() || null,
        notes: asString(body.notes).trim() || null,
      },
    });

    logger.info("invoice.created", { tenantId: ctx.tenantId, invoiceId: invoice.id, number });

    return NextResponse.json(
      {
        ok: true,
        invoice: {
          ...invoice,
          subtotalCents: invoice.subtotalCents.toString(),
          taxCents: invoice.taxCents.toString(),
          totalCents: invoice.totalCents.toString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    logger.error("invoices.create.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// --------------------------------------------------------------------------
// PATCH — update status / paymentRef
// --------------------------------------------------------------------------

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const id = asString(body.id).trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }

  const VALID_STATUSES = ["draft", "sent", "paid", "void"];
  const status = asString(body.status).trim();
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");

    // Ensure the invoice belongs to this tenant.
    const existing = await prisma.customerInvoice.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const invoice = await prisma.customerInvoice.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(body.paymentRef !== undefined
          ? { paymentRef: asString(body.paymentRef).trim() || null }
          : {}),
      },
    });

    logger.info("invoice.updated", { tenantId: ctx.tenantId, invoiceId: id, status });

    return NextResponse.json({
      ok: true,
      invoice: {
        ...invoice,
        subtotalCents: invoice.subtotalCents.toString(),
        taxCents: invoice.taxCents.toString(),
        totalCents: invoice.totalCents.toString(),
      },
    });
  } catch (err) {
    logger.error("invoices.patch.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
