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

import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // No secret configured (mock/dev): allow, so the Cron is exercisable locally.
  if (!secret) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function runPurge(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
