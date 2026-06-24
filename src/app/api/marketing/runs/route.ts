// GET /api/marketing/runs — list recent MarketingRun records for the tenant.
// Supports ?limit=20&agentType= query params.
// Auth required.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  // Auth
  let tenantCtx: Awaited<ReturnType<typeof requireTenant>>;
  try {
    tenantCtx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const agentTypeParam = url.searchParams.get("agentType") ?? undefined;
  const limit = Math.min(Math.max(1, parseInt(limitParam ?? "20", 10) || 20), 100);

  try {
    const runs = await prisma.marketingRun.findMany({
      where: {
        tenantId: tenantCtx.tenantId,
        ...(agentTypeParam ? { agentType: agentTypeParam } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentType: true,
        status: true,
        tokensUsed: true,
        startedAt: true,
        endedAt: true,
        result: true,
      },
    });

    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "fetch_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
