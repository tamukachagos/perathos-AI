// Social dispatch Cron — runs every 15 minutes via vercel.json.
//
// Finds all SocialPost rows where status='scheduled' AND scheduledAt <= now(),
// then calls the social adapter to publish each one, updating status to
// 'posted' or 'failed'.
//
// AUTH: same fail-closed CRON_SECRET bearer as the other crons. In mock/dev
// mode CRON_SECRET is unset and the route is OPEN; once CRON_SECRET is set the
// bearer check is enforced (production rejects a missing secret).

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret, hasDatabase } from "@/lib/env";
import { getProvider } from "@/integrations/social";
import type { SocialPlatform } from "@/integrations/social";
import { prisma } from "@/lib/db/prisma/client";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function runSocialDispatch(request: Request) {
  // 1. Auth
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("social.dispatch.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  // 2. Only meaningful in DB mode; in mock mode there are no persistent rows.
  if (!hasDatabase()) {
    logger.info("social.dispatch.skipped_mock_mode", {});
    return NextResponse.json({ ok: true, dispatched: 0, note: "mock_mode" });
  }

  try {
    const now = new Date();

    // 3. Fetch all due scheduled posts.
    const duePosts = await prisma.socialPost.findMany({
      where: {
        status: "scheduled",
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50, // process at most 50 per cron tick to stay within serverless timeout
    });

    if (duePosts.length === 0) {
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    const provider = getProvider();
    let dispatched = 0;
    let failed = 0;

    for (const post of duePosts) {
      try {
        // Call the adapter to publish immediately (no scheduledAt = post now).
        await provider.schedulePost(
          post.tenantId,
          post.content,
          post.platforms as SocialPlatform[],
          undefined, // immediate
        );

        // Mark as posted.
        await prisma.socialPost.update({
          where: { id: post.id },
          data: {
            status: "posted",
            postedAt: new Date(),
            error: null,
          },
        });
        dispatched++;
        logger.info("social.dispatch.posted", { postId: post.id, tenantId: post.tenantId });
      } catch (postErr) {
        const errorMsg =
          postErr instanceof Error ? postErr.message : "unknown_error";
        logger.warn("social.dispatch.post_failed", {
          postId: post.id,
          tenantId: post.tenantId,
          error: errorMsg,
        });

        // Mark as failed so it's not retried endlessly.
        await prisma.socialPost.update({
          where: { id: post.id },
          data: {
            status: "failed",
            error: errorMsg,
          },
        });
        failed++;
      }
    }

    logger.info("social.dispatch.completed", { dispatched, failed });
    return NextResponse.json({ ok: true, dispatched, failed });
  } catch (error) {
    await captureError("social.dispatch.cron_failed", error);
    return NextResponse.json(
      { ok: false, error: "dispatch_cron_failed" },
      { status: 500 },
    );
  }
}

// Vercel Cron issues GET; POST is supported for manual/secured invocation.
export async function GET(request: Request) {
  return runSocialDispatch(request);
}
export async function POST(request: Request) {
  return runSocialDispatch(request);
}
