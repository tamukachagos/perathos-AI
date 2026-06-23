// Public invoice fetch endpoint.
//
//   GET /api/invoice/[id]  — fetch a single CustomerInvoice by id (public, no auth).
//
// The invoice id serves as the shareable secret. No tenant session is needed;
// the caller (the public /invoice/[id] page) resolves the invoice by its cuid.
// No PII beyond what the invoice itself contains is returned.

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const invoice = await prisma.customerInvoice.findUnique({ where: { id } });

    if (!invoice) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    // Fetch the tenant's primary business for the business name / logo.
    // We look up the tenant so the page can display the seller's business name.
    let businessName: string | null = null;
    try {
      const tenantRow = await prisma.tenant.findUnique({
        where: { id: invoice.tenantId },
        select: { name: true },
      });
      businessName = tenantRow?.name ?? null;
    } catch {
      // Non-critical: page still renders without the business name.
    }

    return NextResponse.json({
      ok: true,
      invoice: {
        ...invoice,
        subtotalCents: invoice.subtotalCents.toString(),
        taxCents: invoice.taxCents.toString(),
        totalCents: invoice.totalCents.toString(),
      },
      businessName,
    });
  } catch (err) {
    logger.error("invoice.public.fetch.error", { err, id });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
