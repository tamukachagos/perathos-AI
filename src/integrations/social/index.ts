import "server-only";

// Social media adapter — multi-platform posting via Ayrshare.
// Gated on AYRSHARE_API_KEY; falls back to mock (console logging) when absent.
// Posts are tracked in the SocialPost Prisma model.

import { prisma } from "@/lib/prisma";

const AYRSHARE_POST_URL = "https://app.ayrshare.com/api/post";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "twitter"
  | "linkedin"
  | "tiktok"
  | "youtube";

export interface PostData {
  content: string;
  imageUrl?: string;
  platforms: SocialPlatform[];
  scheduledAt?: Date;
}

export interface PostRecord {
  id: string;
  tenantId: string;
  content: string;
  imageUrl?: string | null;
  platforms: string[];
  scheduledAt?: Date | null;
  postedAt?: Date | null;
  status: string;
  externalIds?: Record<string, string> | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialProvider {
  schedulePost(
    tenantId: string,
    content: string,
    platforms: SocialPlatform[],
    scheduledAt?: Date,
  ): Promise<PostRecord>;
  listPosts(tenantId: string): Promise<PostRecord[]>;
  cancelPost(postId: string): Promise<PostRecord>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): SocialProvider {
  const store = new Map<string, PostRecord>();

  return {
    async schedulePost(tenantId, content, platforms, scheduledAt) {
      const record: PostRecord = {
        id: `mock-post-${Date.now()}`,
        tenantId,
        content,
        imageUrl: null,
        platforms,
        scheduledAt: scheduledAt ?? null,
        postedAt: scheduledAt ? null : new Date(),
        status: scheduledAt ? "scheduled" : "posted",
        externalIds: Object.fromEntries(platforms.map((p) => [p, `mock-${p}-${Date.now()}`])),
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(record.id, record);
      console.log(
        `[mock:social] schedulePost to [${platforms.join(", ")}]:`,
        content.slice(0, 80),
      );
      return record;
    },

    async listPosts(tenantId) {
      return Array.from(store.values()).filter((p) => p.tenantId === tenantId);
    },

    async cancelPost(postId) {
      const existing = store.get(postId);
      if (!existing) throw new Error(`[mock:social] Post ${postId} not found`);
      const updated = { ...existing, status: "canceled", updatedAt: new Date() };
      store.set(postId, updated);
      console.log("[mock:social] cancelPost", postId);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — Ayrshare API
// ---------------------------------------------------------------------------

export function createRealAdapter(): SocialProvider {
  const apiKey = process.env.AYRSHARE_API_KEY!;

  return {
    async schedulePost(tenantId, content, platforms, scheduledAt) {
      const body: Record<string, unknown> = { post: content, platforms };
      if (scheduledAt) body.scheduleDate = scheduledAt.toISOString();

      const res = await fetch(AYRSHARE_POST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as {
        id?: string;
        postIds?: Record<string, string>;
        status?: string;
      };

      return prisma.socialPost.create({
        data: {
          tenantId,
          content,
          platforms,
          scheduledAt,
          postedAt: scheduledAt ? null : new Date(),
          status: scheduledAt ? "scheduled" : "posted",
          externalIds: (json.postIds ?? {}) as never,
        },
      }) as unknown as PostRecord;
    },

    async listPosts(tenantId) {
      return prisma.socialPost.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }) as unknown as PostRecord[];
    },

    async cancelPost(postId) {
      // Ayrshare uses DELETE /api/post with the post id in the body.
      const post = await prisma.socialPost.findUniqueOrThrow({ where: { id: postId } });
      const externalIds = post.externalIds as Record<string, string> | null;
      if (externalIds) {
        const ayrshareId = Object.values(externalIds)[0];
        if (ayrshareId) {
          await fetch(AYRSHARE_POST_URL, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: ayrshareId }),
          });
        }
      }
      return prisma.socialPost.update({
        where: { id: postId },
        data: { status: "canceled" },
      }) as unknown as PostRecord;
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!process.env.AYRSHARE_API_KEY;
}

export function getProvider(): SocialProvider {
  if (isConfigured()) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
