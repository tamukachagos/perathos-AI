// Marketing Daily Cron — fills social calendars, refreshes SEO, runs platform marketing.
// Vercel Cron schedule: "0 7 * * *" (07:00 UTC daily = 09:00 SAST)
// Protected by CRON_SECRET bearer token.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDaily } from "@/marketing/conductor";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const secret = requireProductionSecret("CRON_SECRET");
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

async function handleCron(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 401 });
    }
    throw error;
  }

  try {
    const start = Date.now();
    await runDaily();
    const elapsed = Date.now() - start;
    logger.info("cron.marketing_daily.done", { elapsedMs: elapsed });
    return NextResponse.json({ ok: true, elapsedMs: elapsed });
  } catch (error) {
    await captureError("cron.marketing_daily.failed", error);
    return NextResponse.json({ ok: false, error: "run_failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleCron(request);
}
export async function POST(request: Request) {
  return handleCron(request);
}
