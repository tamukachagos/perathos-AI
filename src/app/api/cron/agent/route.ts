// W7 — Agent-queue Cron (ENTERPRISE_REVIEW Part 7).
//
// Processes queued AgentJob rows past the request that enqueued them. In mock
// mode the queue is also processed INLINE (the owner action / webhook trigger
// processes immediately), so this cron is the serverless backstop for jobs whose
// enqueuing process is gone — structurally identical to the operations-reconcile
// cron (B11). Each step still runs the spend-cap pre-flight + pause check inside
// processQueue, so the cron cannot bypass any containment invariant.
//
// AUTH: same fail-closed CRON_SECRET bearer as the other crons. In mock/dev the
// secret is unset and the route is OPEN so it is exercisable locally; once
// CRON_SECRET is set, the bearer check is enforced (production-non-mock rejects a
// missing secret).

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import {
  MissingProductionSecretError,
  requireProductionSecret,
} from "@/lib/env";
import { getCurrentTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { processQueue } from "@/integrations/agentTeam";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const secret = requireProductionSecret("CRON_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

async function runAgentQueue(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("agent.cron.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  try {
    // Mock mode: process the current (dev) tenant's queue. A real multi-tenant
    // cron would page tenants with queued jobs and process each in its own
    // scope; that is the live-mode build, but the per-step containment is here.
    const ctx = await getCurrentTenant();
    if (!ctx) return NextResponse.json({ ok: true, processed: 0 });

    const repos = await getRepositories();
    const primary = await repos.businesses.getPrimary(ctx.tenantId);
    if (!primary) return NextResponse.json({ ok: true, processed: 0 });
    const { id: _id, tenantId: _t, ...business } = primary;
    void _id;
    void _t;
    const sites = await repos.sites.listByTenant(ctx.tenantId);
    const slug = sites[0]?.slug ?? "my-site";

    const results = await processQueue(
      { repos },
      ctx.tenantId,
      business as Business,
      slug,
    );
    logger.info("agent.cron.processed", { count: results.length });
    return NextResponse.json({ ok: true, processed: results.length });
  } catch (error) {
    await captureError("agent.cron.failed", error);
    return NextResponse.json(
      { ok: false, error: "agent_cron_failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return runAgentQueue(request);
}
export async function POST(request: Request) {
  return runAgentQueue(request);
}
