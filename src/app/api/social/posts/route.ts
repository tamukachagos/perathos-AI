// Social posts CRUD endpoint.
//
//   GET  /api/social/posts?status=scheduled|posted|draft
//     → lists SocialPost rows for the current tenant, optionally filtered by status.
//
//   POST /api/social/posts
//     Body: { content, platforms, imageUrl?, scheduledAt? }
//     → creates a post. If scheduledAt is absent/now, posts immediately via the
//       social adapter. If cancelId is provided, cancels that post first (used by
//       "Post Now" action on a scheduled post).
//
//   DELETE /api/social/posts?id=<postId>
//     → cancels a scheduled post (marks it canceled; also calls adapter to cancel
//       the Ayrshare-side post if real keys are configured).
//
// Auth required for all methods.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getProvider } from "@/integrations/social";
import type { SocialPlatform } from "@/integrations/social";
import { prisma } from "@/lib/db/prisma/client";
import { hasDatabase } from "@/lib/env";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve posts for the tenant (real DB or adapter mock list). */
async function listPostsForTenant(
  tenantId: string,
  status?: string,
): Promise<unknown[]> {
  if (hasDatabase()) {
    return prisma.socialPost.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  // In-memory / mock mode: use the adapter's in-memory store
  const provider = getProvider();
  const all = await provider.listPosts(tenantId);
  return status ? all.filter((p) => p.status === status) : all;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;

  try {
    const posts = await listPostsForTenant(ctx.tenantId, status);
    return NextResponse.json({ ok: true, posts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "fetch_failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

interface PostBody {
  content?: unknown;
  platforms?: unknown;
  imageUrl?: unknown;
  scheduledAt?: unknown;
  /** Optional: id of a scheduled post to cancel before creating the new one. */
  cancelId?: unknown;
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Validate content
  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ ok: false, error: "content_required" }, { status: 400 });
  }
  const content = body.content.trim();

  // Validate platforms
  const VALID_PLATFORMS = new Set<string>([
    "facebook", "instagram", "twitter", "linkedin", "tiktok",
  ]);
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) {
    return NextResponse.json({ ok: false, error: "platforms_required" }, { status: 400 });
  }
  const platforms = (
    (body.platforms as unknown[]).filter(
      (p): p is string => typeof p === "string" && VALID_PLATFORMS.has(p),
    ) as SocialPlatform[]
  );
  if (platforms.length === 0) {
    return NextResponse.json({ ok: false, error: "invalid_platforms" }, { status: 400 });
  }

  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim()
      ? body.imageUrl.trim()
      : undefined;

  let scheduledAt: Date | undefined;
  if (typeof body.scheduledAt === "string" && body.scheduledAt) {
    const parsed = new Date(body.scheduledAt);
    if (!isNaN(parsed.getTime()) && parsed > new Date()) {
      scheduledAt = parsed;
    }
  }

  try {
    const provider = getProvider();

    // Cancel the prior post if requested (Post Now action on a scheduled item).
    if (typeof body.cancelId === "string" && body.cancelId) {
      try {
        await provider.cancelPost(body.cancelId);
      } catch {
        // Non-fatal — the post may already be processed; continue.
      }
    }

    const record = await provider.schedulePost(
      ctx.tenantId,
      content,
      platforms,
      scheduledAt,
    );

    // If adapter is real (Ayrshare), imageUrl needs to be stored separately —
    // the real adapter creates the DB row; update it with imageUrl if provided.
    if (imageUrl && hasDatabase() && record.id && !record.id.startsWith("mock-")) {
      await prisma.socialPost.update({
        where: { id: record.id },
        data: { imageUrl },
      });
    }

    return NextResponse.json({ ok: true, post: record });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "post_failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }

  try {
    // Verify tenant ownership in DB mode before canceling.
    if (hasDatabase()) {
      const post = await prisma.socialPost.findUnique({ where: { id } });
      if (!post) {
        return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      if (post.tenantId !== ctx.tenantId) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    const provider = getProvider();
    const record = await provider.cancelPost(id);
    return NextResponse.json({ ok: true, post: record });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "cancel_failed" },
      { status: 500 },
    );
  }
}
