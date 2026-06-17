// POPIA retention purge Cron (M5).
//
// Deletes every lead whose retention window has elapsed, PLATFORM-WIDE (the Cron
// is not a tenant session — it sweeps all tenants). Vercel Cron calls this on a
// daily schedule (see vercel.json).
//
// AUTH: protected by a CRON_SECRET bearer token. Vercel Cron sends the project's
// CRON_SECRET as `Authorization: Bearer <secret>` when it is configured. In mock
// mode CRON_SECRET is unset and the route is OPEN so the purge is exercisable
// locally with no secrets; once CRON_SECRET is set, the bearer check is enforced.
//
// Runs in mock mode (in-memory repo) and DB mode unchanged.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Constant-time bearer-token compare (no early-exit timing leak). */
function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authorize the purge Cron (B3/S2). FAIL CLOSED: when CRON_SECRET is unset, the
 * route is open ONLY in explicit dev/mock mode; in production-non-mock a missing
 * secret REJECTS (requireProductionSecret throws → caller returns 401). With a
 * secret set, the Bearer token must match in constant time.
 */
function authorized(request: Request): boolean {
  const secret = requireProductionSecret("CRON_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

async function runPurge(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("popia.purge.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  try {
    const repos = await getRepositories();
    const asOf = new Date();
    const deleted = await repos.leads.purgeExpired(asOf);
    logger.info("popia.purge", { deleted, asOf: asOf.toISOString() });
    return NextResponse.json({ ok: true, deleted, asOf: asOf.toISOString() });
  } catch (error) {
    await captureError("popia.purge.failed", error);
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}

// Vercel Cron issues a GET; POST is supported for manual/secured invocation.
export async function GET(request: Request) {
  return runPurge(request);
}
export async function POST(request: Request) {
  return runPurge(request);
}
