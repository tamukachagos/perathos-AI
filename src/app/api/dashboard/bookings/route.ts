// Dashboard bookings API — authenticated, tenant-scoped.
//
// GET  /api/dashboard/bookings         — list this tenant's bookings
// PATCH /api/dashboard/bookings        — update a booking's status
//
// Auth: requireTenant() — 401 when there is no session.
// In mock/no-DB mode, returns an empty list and no-ops on PATCH.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Allowed status transitions from the dashboard
const ALLOWED_STATUSES = new Set(["pending", "confirmed", "completed", "cancelled"]);

// --- GET: list all bookings for the authenticated tenant ----------------------
export async function GET(_request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    // Mock / no-DB mode: return empty list
    return NextResponse.json({ bookings: [] });
  }

  const { prisma } = await import("@/lib/db/prisma/client");

  const bookings = await prisma.booking.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  return NextResponse.json({ bookings });
}

// --- PATCH: update a booking's status ----------------------------------------
export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown; status?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; status?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";

  if (!id || !status) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ ok: true });
  }

  const { prisma } = await import("@/lib/db/prisma/client");

  // Verify ownership: only update bookings belonging to this tenant
  const existing = await prisma.booking.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: { status },
  });

  logger.info("booking.status_updated", {
    bookingId: id,
    status,
    tenantId: ctx.tenantId,
  });

  return NextResponse.json({ ok: true, booking: updated });
}
