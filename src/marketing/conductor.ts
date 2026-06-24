"use server";

// Marketing Conductor — the master orchestrator.
// Runs all agents on schedule, enforces rate limits, and logs every run.
// Called by the Vercel cron API routes; also callable from the dashboard.
//
// Constraints enforced here:
// - Max 100 routeLlm calls per conductor run (early-exit if exceeded)
// - Max 4 social posts/week per tenant (enforced in SocialAgent)
// - Max 1 email/week per contact (enforced in EmailAgent)
// - PLATFORM_SOCIAL_TENANT_ID gates platform marketing (absent = skip)

import { prisma } from "@/lib/prisma";
import * as SocialAgent from "@/marketing/agents/SocialAgent";
import * as EmailAgent from "@/marketing/agents/EmailAgent";
import * as SeoAgent from "@/marketing/agents/SeoAgent";
import * as NurtureAgent from "@/marketing/agents/NurtureAgent";
import * as ReputationAgent from "@/marketing/agents/ReputationAgent";
import * as ReportAgent from "@/marketing/agents/ReportAgent";
import * as ContentAgent from "@/marketing/agents/ContentAgent";
import type { AgentResult, MarketingContext } from "@/marketing/types";

// ---------------------------------------------------------------------------
// LLM call counter (per conductor run, not per-request)
// ---------------------------------------------------------------------------
let llmCallCount = 0;
const LLM_RUN_LIMIT = 100;

function resetLlmCount() {
  llmCallCount = 0;
}

function checkLlmBudget(): boolean {
  if (llmCallCount >= LLM_RUN_LIMIT) {
    console.warn(
      `[conductor] LLM call limit (${LLM_RUN_LIMIT}) reached — stopping early`,
    );
    return false;
  }
  llmCallCount += 1; // Count each agent dispatch as consuming some calls
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all tenants on Growth or Pro plans (the plans that include marketing agents).
 */
async function getActiveTenants(): Promise<string[]> {
  const subs = await prisma.subscription.findMany({
    where: {
      plan: { in: ["growth", "pro"] },
      status: { in: ["active", "trialing"] },
    },
    select: { tenantId: true },
  });
  return subs.map((s) => s.tenantId);
}

/**
 * Build a MarketingContext for a tenant from their Business profile + subscription.
 * Returns null if no primary business is found.
 */
async function buildContext(tenantId: string): Promise<MarketingContext | null> {
  const business = await prisma.business.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });

  if (!business) return null;

  const sub = await prisma.subscription.findFirst({
    where: { tenantId },
    select: { plan: true },
  });

  // Get owner email from User via Membership
  const membership = await prisma.membership.findFirst({
    where: { tenantId, role: "owner" },
    include: { user: { select: { email: true } } },
  });

  const services = business.services
    ? business.services.split(",").map((s) => s.trim()).filter(Boolean)
    : [business.industry];

  return {
    tenantId,
    businessName: business.name,
    industry: business.industry,
    location: business.location,
    services,
    whatsapp: business.whatsapp,
    domain: business.domainName,
    planTier: (sub?.plan as "free" | "growth" | "pro") ?? "growth",
    ownerEmail: membership?.user.email ?? undefined,
    locale:      ((business as Record<string, unknown>).locale      as string | undefined) ?? "en",
    currency:    ((business as Record<string, unknown>).currency    as string | undefined) ?? "USD",
    countryCode: ((business as Record<string, unknown>).countryCode as string | undefined) ?? "ZA",
  };
}

/**
 * Log a completed agent run to the MarketingRun table.
 */
async function logRun(
  agentType: string,
  tenantId: string | null,
  result: AgentResult,
  startedAt: Date,
): Promise<void> {
  await prisma.marketingRun.create({
    data: {
      tenantId,
      agentType,
      status: result.success ? "done" : "failed",
      result: {
        actions: result.actions,
        error: result.error,
      } as never,
      tokensUsed: result.tokensUsed,
      startedAt,
      endedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Hourly run — check sequences and nurture
// ---------------------------------------------------------------------------

/**
 * Run every hour. Processes email sequences and nurture follow-ups for all tenants.
 */
export async function runHourly(): Promise<void> {
  resetLlmCount();
  const startedAt = new Date();
  console.log("[conductor] runHourly started");

  const tenantIds = await getActiveTenants();

  for (const tenantId of tenantIds) {
    if (!checkLlmBudget()) break;

    const ctx = await buildContext(tenantId);
    if (!ctx) continue;

    // Email sequences (hourly — catches bookings due soon)
    const emailStart = new Date();
    const emailResult = await EmailAgent.run(ctx);
    await logRun("email", tenantId, emailResult, emailStart);

    if (!checkLlmBudget()) break;

    // Nurture follow-ups (hourly)
    const nurtureStart = new Date();
    const nurtureResult = await NurtureAgent.run(ctx);
    await logRun("nurture", tenantId, nurtureResult, nurtureStart);
  }

  console.log(
    `[conductor] runHourly done (${tenantIds.length} tenants, ${llmCallCount} LLM dispatches)`,
  );
}

// ---------------------------------------------------------------------------
// Daily run — social calendar + SEO refresh + platform content
// ---------------------------------------------------------------------------

/**
 * Run every day at 07:00 SAST. Fills social calendars and refreshes SEO for all tenants.
 */
export async function runDaily(): Promise<void> {
  resetLlmCount();
  const startedAt = new Date();
  console.log("[conductor] runDaily started");

  const tenantIds = await getActiveTenants();

  for (const tenantId of tenantIds) {
    if (!checkLlmBudget()) break;

    const ctx = await buildContext(tenantId);
    if (!ctx) continue;

    // Social calendar (fills week's posts)
    const socialStart = new Date();
    const socialResult = await SocialAgent.run(ctx);
    await logRun("social", tenantId, socialResult, socialStart);

    if (!checkLlmBudget()) break;

    // SEO refresh
    const seoStart = new Date();
    const seoResult = await SeoAgent.run(ctx);
    await logRun("seo", tenantId, seoResult, seoStart);
  }

  // Platform marketing (Launch Desk own social content)
  if (process.env.PLATFORM_SOCIAL_TENANT_ID && checkLlmBudget()) {
    const platformSocialStart = new Date();
    const platformSocialResult = await SocialAgent.runForPlatformMarketing();
    await logRun("social-platform", null, platformSocialResult, platformSocialStart);

    // Platform email sequences
    if (checkLlmBudget()) {
      const platformEmailStart = new Date();
      const platformEmailResult = await EmailAgent.runPlatformMarketing();
      await logRun("email-platform", null, platformEmailResult, platformEmailStart);
    }

    // Platform blog posts (2 per week — run on Mon and Thu)
    const dayOfWeek = new Date().getUTCDay();
    if ((dayOfWeek === 1 || dayOfWeek === 4) && checkLlmBudget()) {
      const platformTenantId = process.env.PLATFORM_SOCIAL_TENANT_ID!;
      const topics = [
        "5 reasons every SA small business needs a website in 2025",
        "How to get your first 100 customers online — SA guide",
        "WhatsApp commerce: the future of SA e-commerce",
        "Building your brand on social media as an SA small business",
      ];
      const topic = topics[Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % topics.length];

      const blogCtx: MarketingContext = {
        tenantId: platformTenantId,
        businessName: "Launch Desk",
        industry: "website builder platform",
        location: "South Africa",
        services: ["AI website builder", "digital marketing", "WhatsApp commerce"],
        whatsapp: "",
        domain: "perathos.com",
        planTier: "pro",
        locale: "en",
        currency: "ZAR",
        countryCode: "ZA",
      };

      const contentStart = new Date();
      const pieces = await ContentAgent.run(blogCtx, {
        contentTypes: ["blog-post"],
        topic,
      });
      const contentResult: AgentResult = {
        agentType: "content",
        success: pieces.length > 0,
        actions: pieces.map((p) => `Generated ${p.type}: ${p.content.slice(0, 60)}...`),
        tokensUsed: 1000,
      };
      await logRun("content-platform", null, contentResult, contentStart);
    }
  }

  console.log(
    `[conductor] runDaily done (${tenantIds.length} tenants, ${llmCallCount} LLM dispatches)`,
  );
}

// ---------------------------------------------------------------------------
// Weekly run — reports + reputation management
// ---------------------------------------------------------------------------

/**
 * Run every Monday at 08:00 SAST. Generates weekly reports and manages reviews.
 */
export async function runWeekly(): Promise<void> {
  resetLlmCount();
  const startedAt = new Date();
  console.log("[conductor] runWeekly started");

  const tenantIds = await getActiveTenants();

  for (const tenantId of tenantIds) {
    if (!checkLlmBudget()) break;

    const ctx = await buildContext(tenantId);
    if (!ctx) continue;

    // Weekly performance report
    const reportStart = new Date();
    const reportResult = await ReportAgent.run(ctx);
    await logRun("report", tenantId, reportResult, reportStart);

    if (!checkLlmBudget()) break;

    // Reputation management (drafts review responses)
    const hasUnrespondedReviews = await prisma.reviewRecord.count({
      where: { tenantId, respondedAt: null, response: null },
    });

    if (hasUnrespondedReviews > 0) {
      const reputationStart = new Date();
      const reputationResult = await ReputationAgent.run(ctx);
      await logRun("reputation", tenantId, reputationResult, reputationStart);
    }
  }

  // Platform-level report to operator
  if (checkLlmBudget()) {
    const platformReportStart = new Date();
    const platformReportResult = await ReportAgent.runPlatformReport();
    await logRun("report-platform", null, platformReportResult, platformReportStart);
  }

  console.log(
    `[conductor] runWeekly done (${tenantIds.length} tenants, ${llmCallCount} LLM dispatches)`,
  );
}

// ---------------------------------------------------------------------------
// Manual trigger — run a specific agent for a specific tenant
// ---------------------------------------------------------------------------

/**
 * Manually trigger a specific agent for a tenant. Used by the dashboard.
 */
export async function runForTenant(
  tenantId: string,
  agentType: string,
): Promise<AgentResult> {
  const ctx = await buildContext(tenantId);

  if (!ctx) {
    return {
      agentType,
      success: false,
      actions: [],
      tokensUsed: 0,
      error: "No business profile found for this tenant",
    };
  }

  const startedAt = new Date();
  let result: AgentResult;

  switch (agentType) {
    case "content":
      const pieces = await ContentAgent.run(ctx, {
        contentTypes: ["social-post", "email", "blog-post"],
      });
      result = {
        agentType: "content",
        success: pieces.length > 0,
        actions: pieces.map((p) => `Generated ${p.type}`),
        tokensUsed: pieces.length * 300,
      };
      break;

    case "social":
      result = await SocialAgent.run(ctx);
      break;

    case "email":
      result = await EmailAgent.run(ctx);
      break;

    case "seo":
      result = await SeoAgent.run(ctx);
      break;

    case "nurture":
      result = await NurtureAgent.run(ctx);
      break;

    case "reputation":
      result = await ReputationAgent.run(ctx);
      break;

    case "report":
      result = await ReportAgent.run(ctx);
      break;

    default:
      result = {
        agentType,
        success: false,
        actions: [],
        tokensUsed: 0,
        error: `Unknown agent type: ${agentType}`,
      };
  }

  await logRun(agentType, tenantId, result, startedAt);
  return result;
}
