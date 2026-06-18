// W5 — Managed-hosting metering Cron.
//
// Ticks every RUNNING container/K8s deployment PLATFORM-WIDE (the Cron is not a
// tenant session — it sweeps all tenants), debiting cpu_hour + storage_gb_mo
// against each tenant's wallet at the hosting markup, EXACTLY-ONCE per hour-tick
// (idempotent on the deployment + tick key). It also applies the cost-safe
// guardrails: a running deployment whose wallet cannot fund the next tick is
// SUSPENDED (the meter stops), the per-tenant kill switch suspends immediately,
// and an outsized tick raises the billing-anomaly flag. Vercel Cron calls this
// hourly (see vercel.json), alongside the purge + operations crons.
//
// AUTH: same fail-closed CRON_SECRET bearer as the other crons. In mock mode
// CRON_SECRET is unset and the route is OPEN so it is exercisable locally; once
// CRON_SECRET is set, the bearer check is enforced.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret } from "@/lib/env";
import { sweepHostingMeter } from "@/integrations/hosting/sweep";

export const dynamic = "force-dynamic";

/** Constant-time bearer-token compare (no early-exit timing leak). */
function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Authorize the metering Cron — FAIL CLOSED in production-non-mock. */
function authorized(request: Request): boolean {
  const secret = requireProductionSecret("CRON_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

async function runMeter(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("hosting.meter.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  try {
    const result = await sweepHostingMeter();
    logger.info("hosting.meter.tick", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await captureError("hosting.meter.failed", error);
    return NextResponse.json({ ok: false, error: "meter_failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return runMeter(request);
}
export async function POST(request: Request) {
  return runMeter(request);
}
