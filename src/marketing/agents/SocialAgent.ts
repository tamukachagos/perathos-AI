"use server";

// SocialAgent — schedules and posts social media content (Hootsuite-grade).
// Strategy: 4 optimal posts/week. Never auto-publishes without tenant consent.
// Uses ContentAgent for generation and the social adapter for scheduling.

import { prisma } from "@/lib/prisma";
import { getProvider } from "@/integrations/social";
import * as ContentAgent from "@/marketing/agents/ContentAgent";
import type { AgentResult, MarketingContext } from "@/marketing/types";

// Hootsuite best-practice weekly schedule: [weekday 0=Sun, hourUTC]
const WEEKLY_SLOTS: Array<{ day: number; hourUtc: number; theme: string }> = [
  { day: 1, hourUtc: 7, theme: "Motivational/business tip" },   // Monday 9am SAST
  { day: 3, hourUtc: 10, theme: "Service highlight or showcase" }, // Wed 12pm SAST
  { day: 5, hourUtc: 15, theme: "Weekend special or community" },  // Fri 5pm SAST
  { day: 6, hourUtc: 8, theme: "Behind-the-scenes or personal story" }, // Sat 10am SAST
];

/** Next occurrence of a given weekday + hour from now (UTC). */
function nextOccurrence(targetDay: number, targetHourUtc: number): Date {
  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(targetHourUtc, 0, 0, 0);
  const dayDiff = (targetDay - now.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + (dayDiff === 0 && d <= now ? 7 : dayDiff));
  return d;
}

/** Start + end of the current ISO week (Monday–Sunday). */
function currentWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

/**
 * Run SocialAgent for a single tenant.
 * Fills this week's social calendar with AI-generated posts for any missing slots.
 * Posts are scheduled (not auto-published) unless the tenant enables auto-post.
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;
  const autoPublish = false; // Default: schedule only, owner must approve

  try {
    const social = getProvider();
    const { start, end } = currentWeekBounds();

    // Fetch posts already scheduled this week for this tenant
    const existingPosts = await prisma.socialPost.findMany({
      where: {
        tenantId: ctx.tenantId,
        scheduledAt: { gte: start, lte: end },
      },
      select: { scheduledAt: true },
    });

    const scheduledDays = new Set(
      existingPosts
        .filter((p) => p.scheduledAt)
        .map((p) => p.scheduledAt!.getUTCDay()),
    );

    // Schedule content for any missing weekly slots (max 4 posts/week)
    let postsThisRun = 0;
    for (const slot of WEEKLY_SLOTS) {
      if (scheduledDays.has(slot.day)) continue;
      if (postsThisRun >= 4) break;

      const pieces = await ContentAgent.run(ctx, {
        contentTypes: ["social-post"],
        topic: slot.theme,
      });

      for (const piece of pieces) {
        if (!piece.content) continue;
        const scheduledAt = nextOccurrence(slot.day, slot.hourUtc);
        const status = autoPublish ? "scheduled" : "scheduled";

        await prisma.socialPost.create({
          data: {
            tenantId: ctx.tenantId,
            content: piece.content,
            platforms: ["facebook", "instagram"],
            scheduledAt,
            status,
          },
        });

        if (autoPublish) {
          await social.schedulePost(
            ctx.tenantId,
            piece.content,
            ["facebook", "instagram"],
            scheduledAt,
          );
        }

        actions.push(`Scheduled "${slot.theme}" post for ${scheduledAt.toISOString().slice(0, 10)}`);
        postsThisRun++;
      }
    }

    // Monthly "Thank you for reviews" post if business has reviews
    const reviewCount = await prisma.reviewRecord.count({
      where: { tenantId: ctx.tenantId },
    });
    if (reviewCount > 0) {
      const existingThankYou = await prisma.socialPost.findFirst({
        where: {
          tenantId: ctx.tenantId,
          content: { contains: "thank" },
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      });
      if (!existingThankYou) {
        const pieces = await ContentAgent.run(ctx, {
          contentTypes: ["social-post"],
          topic: "Thank our amazing customers for their reviews and support",
          tone: "warm, grateful, celebratory",
        });
        if (pieces[0]?.content) {
          const scheduledAt = nextOccurrence(3, 10); // Wed 12pm SAST
          await prisma.socialPost.create({
            data: {
              tenantId: ctx.tenantId,
              content: pieces[0].content,
              platforms: ["facebook", "instagram"],
              scheduledAt,
              status: "scheduled",
            },
          });
          actions.push("Scheduled monthly review thank-you post");
        }
      }
    }

    // WhatsApp commerce reminder (weekly) if tenant has products
    if (ctx.whatsapp) {
      const productCount = await prisma.product.count({
        where: { tenantId: ctx.tenantId, available: true },
      });
      if (productCount > 0) {
        const recentWhatsAppPost = await prisma.socialPost.findFirst({
          where: {
            tenantId: ctx.tenantId,
            content: { contains: "WhatsApp" },
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        });
        if (!recentWhatsAppPost) {
          const pieces = await ContentAgent.run(ctx, {
            contentTypes: ["social-post"],
            topic: `Order via WhatsApp — direct, fast, easy! Message us at ${ctx.whatsapp}`,
            tone: "excited, convenient, community",
          });
          if (pieces[0]?.content) {
            const scheduledAt = nextOccurrence(2, 9); // Tue 11am SAST
            await prisma.socialPost.create({
              data: {
                tenantId: ctx.tenantId,
                content: pieces[0].content,
                platforms: ["facebook", "instagram"],
                scheduledAt,
                status: "scheduled",
              },
            });
            actions.push("Scheduled weekly WhatsApp order reminder post");
          }
        }
      }
    }

    if (actions.length === 0) {
      actions.push("Social calendar already full for this week");
    }

    return { agentType: "social", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "social",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Post platform-level marketing content for Launch Desk / Perathos itself.
 * Uses PLATFORM_SOCIAL_TENANT_ID env var. If absent, this is a no-op.
 */
export async function runForPlatformMarketing(): Promise<AgentResult> {
  const platformTenantId = process.env.PLATFORM_SOCIAL_TENANT_ID;
  if (!platformTenantId) {
    return {
      agentType: "social-platform",
      success: true,
      actions: ["PLATFORM_SOCIAL_TENANT_ID not set — skipping platform marketing"],
      tokensUsed: 0,
    };
  }

  const platformCtx: MarketingContext = {
    tenantId: platformTenantId,
    businessName: "Launch Desk by Perathos",
    industry: "website builder / digital platform",
    location: "South Africa",
    services: [
      "AI website builder",
      "WhatsApp commerce",
      "online bookings",
      "email marketing",
      "domain registration",
    ],
    whatsapp: "",
    domain: "perathos.com",
    planTier: "pro",
  };

  const topics = [
    "Get your SA business online in 2 minutes — free",
    "Success story: how a local SA business grew with Launch Desk",
    "New feature announcement: AI-powered marketing agents for your business",
    "Why every SA small business needs a professional website in 2025",
  ];

  const topic = topics[new Date().getDay() % topics.length];

  return run({ ...platformCtx, ...{ } });
}
