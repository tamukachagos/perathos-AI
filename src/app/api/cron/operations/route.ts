// Operations-reconcile Cron (B11).
//
// Settles async operations (domain.register / hosting.deploy / email.provision)
// that are still `pending` past their settle time, PLATFORM-WIDE (the Cron is
// not a tenant session — it sweeps all tenants). Without this, an unpolled async
// op stays `pending` forever on serverless, where the holding process is gone
// after the 202 response (B11). Vercel Cron calls this on a schedule (see
// vercel.json), alongside the POPIA purge cron.
//
// In live mode, a signed vendor webhook normally settles an operation with the
// REAL outcome (possibly `failed`) promptly; this cron is the backstop for ops
// with no webhook or a missed delivery.
//
// AUTH: same fail-closed CRON_SECRET bearer as the purge cron. In mock mode
// CRON_SECRET is unset and the route is OPEN so it is exercisable locally; once
// CRON_SECRET is set, the bearer check is enforced.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret } from "@/lib/env";
import { reconcileAll } from "@/integrations/core/operationStore";

export const dynamic = "force-dynamic";

/** Constant-time bearer-token compare (no early-exit timing leak). */
function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Authorize the reconcile Cron — FAIL CLOSED in production-non-mock (B3/S2). */
function authorized(request: Request): boolean {
  const secret = requireProductionSecret("CRON_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

async function runReconcile(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("operations.reconcile.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  try {
    const now = Date.now();
    const settled = await reconcileAll(now);
    logger.info("operations.reconcile", { settled });
    return NextResponse.json({ ok: true, settled });
  } catch (error) {
    await captureError("operations.reconcile.failed", error);
    return NextResponse.json(
      { ok: false, error: "reconcile_failed" },
      { status: 500 },
    );
  }
}

// Vercel Cron issues a GET; POST is supported for manual/secured invocation.
export async function GET(request: Request) {
  return runReconcile(request);
}
export async function POST(request: Request) {
  return runReconcile(request);
}
