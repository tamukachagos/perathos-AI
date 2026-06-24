// GET /api/dashboard/analytics?days=30
//
// Returns analytics KPIs + daily visit breakdown for the authenticated tenant.
// Auth required: sessions without a valid tenant receive 401.
//
// Query params:
//   days  — integer, 7 | 30 | 90 (default 30)
//
// Response shape:
//   { ok: true, data: AnalyticsMetrics }

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getProvider } from "@/integrations/analytics";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = new Set([7, 30, 90]);

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const rawDays = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = ALLOWED_DAYS.has(rawDays) ? rawDays : 30;

  const data = await getProvider().getMetrics(ctx.tenantId, days);

  return NextResponse.json({ ok: true, data });
}
