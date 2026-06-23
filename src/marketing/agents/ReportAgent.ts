"use server";

// ReportAgent — CMO-grade weekly performance briefing.
// Sends HTML email reports to business owners + platform operator.

import { prisma } from "@/lib/prisma";
import { routeLlm } from "@/integrations/llm";
import { getRepositories } from "@/lib/db";
import { getProvider as getEmailProvider } from "@/integrations/emailMarketing";
import type { AgentResult, MarketingContext } from "@/marketing/types";

function idem(tenantId: string, type: string): string {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return `report-agent:${tenantId}:${type}:${week}`;
}

/** Format a number as a percentage string. */
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Run the ReportAgent for a tenant — generates and emails a weekly performance report.
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;

  try {
    const repos = await getRepositories();
    const email = getEmailProvider();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // ------------------------------------------------------------------
    // Gather this week's metrics
    // ------------------------------------------------------------------

    // Leads
    const newLeadsThisWeek = await prisma.crmContact.count({
      where: { tenantId: ctx.tenantId, createdAt: { gte: weekAgo } },
    });
    const newLeadsLastWeek = await prisma.crmContact.count({
      where: {
        tenantId: ctx.tenantId,
        createdAt: { gte: twoWeeksAgo, lt: weekAgo },
      },
    });

    // Bookings
    const bookingsThisWeek = await prisma.booking.findMany({
      where: {
        tenantId: ctx.tenantId,
        createdAt: { gte: weekAgo },
      },
      select: { status: true },
    });
    const bookingsMade = bookingsThisWeek.length;
    const bookingsConfirmed = bookingsThisWeek.filter(
      (b) => b.status === "confirmed",
    ).length;

    // Email campaigns
    const emailCampaigns = await prisma.emailCampaign.findMany({
      where: { tenantId: ctx.tenantId, sentAt: { gte: weekAgo } },
      select: { recipientCount: true, openCount: true, clickCount: true },
    });
    const emailsSent = emailCampaigns.reduce(
      (s, c) => s + c.recipientCount,
      0,
    );
    const emailOpens = emailCampaigns.reduce((s, c) => s + c.openCount, 0);
    const emailClicks = emailCampaigns.reduce((s, c) => s + c.clickCount, 0);
    const openRate = emailsSent > 0 ? emailOpens / emailsSent : 0;
    const clickRate = emailsSent > 0 ? emailClicks / emailsSent : 0;

    // Social posts
    const socialPostsThisWeek = await prisma.socialPost.count({
      where: {
        tenantId: ctx.tenantId,
        createdAt: { gte: weekAgo },
        status: { in: ["scheduled", "posted"] },
      },
    });

    // Reviews
    const reviewsThisWeek = await prisma.reviewRecord.findMany({
      where: { tenantId: ctx.tenantId, createdAt: { gte: weekAgo } },
      select: { rating: true, respondedAt: true },
    });
    const avgRating =
      reviewsThisWeek.length > 0
        ? reviewsThisWeek.reduce((s, r) => s + r.rating, 0) /
          reviewsThisWeek.length
        : 0;
    const responseRate =
      reviewsThisWeek.length > 0
        ? reviewsThisWeek.filter((r) => r.respondedAt).length /
          reviewsThisWeek.length
        : 0;

    // Marketing agent runs
    const agentRuns = await prisma.marketingRun.count({
      where: { tenantId: ctx.tenantId, startedAt: { gte: weekAgo } },
    });

    // ------------------------------------------------------------------
    // AI recommendation
    // ------------------------------------------------------------------
    const metricsContext = `Business: ${ctx.businessName} (${ctx.industry}, ${ctx.location})
Week metrics:
- New leads: ${newLeadsThisWeek} (vs ${newLeadsLastWeek} last week)
- Bookings made: ${bookingsMade}, confirmed: ${bookingsConfirmed}
- Emails sent: ${emailsSent}, open rate: ${pct(openRate)}, click rate: ${pct(clickRate)}
- Social posts: ${socialPostsThisWeek}
- New reviews: ${reviewsThisWeek.length}, avg rating: ${avgRating.toFixed(1)}★, response rate: ${pct(responseRate)}`;

    const recommendationPrompt = `${metricsContext}

You are a CMO advisor for a South African small business. Based on these weekly metrics, give ONE specific, actionable recommendation to improve marketing performance next week. Be specific, practical, and concise (2-3 sentences max).`;

    const recOutcome = await routeLlm(
      { wallet: repos.wallet, audit: repos.audit, repos },
      {
        tenantId: ctx.tenantId,
        task: "reason.plan",
        input: {
          messages: [{ role: "user", content: recommendationPrompt }],
          maxTokens: 200,
        },
        idempotencyKey: idem(ctx.tenantId, "recommendation"),
      },
    );

    const recommendation =
      recOutcome.status === "ok" && recOutcome.result.text
        ? recOutcome.result.text.trim()
        : "Focus on responding to all reviews this week to boost your local SEO ranking.";

    tokensUsed +=
      recOutcome.status === "ok"
        ? recOutcome.result.usage.inputTokens + recOutcome.result.usage.outputTokens
        : 0;

    // ------------------------------------------------------------------
    // Build HTML report email
    // ------------------------------------------------------------------
    const weekStr = weekAgo.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
    });
    const nowStr = now.toLocaleDateString("en-ZA", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const leadTrend =
      newLeadsThisWeek > newLeadsLastWeek
        ? `+${newLeadsThisWeek - newLeadsLastWeek} vs last week`
        : newLeadsThisWeek < newLeadsLastWeek
          ? `-${newLeadsLastWeek - newLeadsThisWeek} vs last week`
          : "same as last week";

    const reportHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #243044; background: #f3f6f8; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #061a2d, #123a6f); color: white; padding: 28px 32px; }
  .header h1 { margin: 0 0 4px; font-size: 22px; }
  .header p { margin: 0; opacity: 0.8; font-size: 14px; }
  .body { padding: 28px 32px; }
  .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
  .kpi { background: #f3f6f8; border-radius: 8px; padding: 16px; }
  .kpi .value { font-size: 28px; font-weight: 700; color: #0f7a4f; }
  .kpi .label { font-size: 12px; color: #667085; margin-top: 4px; }
  .kpi .trend { font-size: 12px; color: #667085; margin-top: 2px; }
  .section { margin: 24px 0; }
  .section h3 { font-size: 15px; color: #182131; border-bottom: 1px solid #dfe5eb; padding-bottom: 8px; }
  .metric-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #f3f6f8; }
  .recommendation { background: #edf5ff; border-left: 4px solid #123a6f; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0; }
  .recommendation h3 { margin: 0 0 8px; font-size: 14px; color: #123a6f; }
  .recommendation p { margin: 0; font-size: 14px; color: #243044; }
  .footer { padding: 20px 32px; background: #f3f6f8; font-size: 12px; color: #667085; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>Weekly Marketing Report</h1>
    <p>${ctx.businessName} &mdash; Week of ${weekStr}&ndash;${nowStr}</p>
    <p style="margin-top:8px;opacity:0.6;font-size:12px;">Powered by Launch Desk AI Marketing Agents</p>
  </div>
  <div class="body">
    <div class="kpi-grid">
      <div class="kpi">
        <div class="value">${newLeadsThisWeek}</div>
        <div class="label">New Leads</div>
        <div class="trend">${leadTrend}</div>
      </div>
      <div class="kpi">
        <div class="value">${bookingsMade}</div>
        <div class="label">Bookings Made</div>
        <div class="trend">${bookingsConfirmed} confirmed</div>
      </div>
      <div class="kpi">
        <div class="value">${socialPostsThisWeek}</div>
        <div class="label">Social Posts</div>
        <div class="trend">This week</div>
      </div>
      <div class="kpi">
        <div class="value">${reviewsThisWeek.length}</div>
        <div class="label">New Reviews</div>
        <div class="trend">${avgRating > 0 ? `${avgRating.toFixed(1)}★ avg` : "No new reviews"}</div>
      </div>
    </div>

    <div class="section">
      <h3>Email Performance</h3>
      <div class="metric-row"><span>Emails Sent</span><span><strong>${emailsSent}</strong></span></div>
      <div class="metric-row"><span>Open Rate</span><span><strong>${pct(openRate)}</strong></span></div>
      <div class="metric-row"><span>Click Rate</span><span><strong>${pct(clickRate)}</strong></span></div>
    </div>

    <div class="section">
      <h3>Review Summary</h3>
      <div class="metric-row"><span>New Reviews</span><span><strong>${reviewsThisWeek.length}</strong></span></div>
      <div class="metric-row"><span>Avg Rating</span><span><strong>${avgRating > 0 ? `${avgRating.toFixed(1)}★` : "N/A"}</strong></span></div>
      <div class="metric-row"><span>Response Rate</span><span><strong>${pct(responseRate)}</strong></span></div>
    </div>

    <div class="section">
      <h3>AI Agent Activity</h3>
      <div class="metric-row"><span>Agent Runs This Week</span><span><strong>${agentRuns}</strong></span></div>
    </div>

    <div class="recommendation">
      <h3>CMO Recommendation for Next Week</h3>
      <p>${recommendation}</p>
    </div>
  </div>
  <div class="footer">
    <p>This report was generated automatically by your Launch Desk AI Marketing Team.</p>
    <p>{{unsubscribe_link}}</p>
  </div>
</div>
</body>
</html>`;

    // Send to owner
    if (ctx.ownerEmail) {
      const campaign = await email.createCampaign(ctx.tenantId, {
        name: `weekly-report-${now.toISOString().slice(0, 10)}`,
        subject: `Weekly Marketing Report — ${ctx.businessName} (${weekStr}–${nowStr})`,
        bodyHtml: reportHtml,
      });
      await email.sendCampaign(campaign.id, [ctx.ownerEmail]);
      actions.push(`Sent weekly report to ${ctx.ownerEmail}`);
    }

    // Store in MarketingRun
    await prisma.marketingRun.create({
      data: {
        tenantId: ctx.tenantId,
        agentType: "report",
        status: "done",
        result: {
          weekOf: weekAgo.toISOString().slice(0, 10),
          newLeads: newLeadsThisWeek,
          bookingsMade,
          bookingsConfirmed,
          emailsSent,
          openRate,
          clickRate,
          socialPosts: socialPostsThisWeek,
          newReviews: reviewsThisWeek.length,
          avgRating,
          responseRate,
          recommendation,
        },
        tokensUsed,
        endedAt: new Date(),
      },
    });

    actions.push("Stored weekly report metrics");

    return { agentType: "report", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "report",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate and send a platform-level report to the operator (tamukachagonda@gmail.com).
 */
export async function runPlatformReport(): Promise<AgentResult> {
  const actions: string[] = [];
  const operatorEmail = "tamukachagonda@gmail.com";

  try {
    const repos = await getRepositories();
    const email = getEmailProvider();

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Platform-level stats (no tenantId scoping — operator-level query)
    const totalTenants = await prisma.tenant.count();
    const newTenants = await prisma.tenant.count({
      where: { createdAt: { gte: weekAgo } },
    });
    const activeSubs = await prisma.subscription.count({
      where: { status: "active", plan: { not: "free" } },
    });
    const freeUsers = await prisma.subscription.count({
      where: { plan: "free" },
    });
    const growthUsers = await prisma.subscription.count({
      where: { plan: "growth", status: "active" },
    });
    const proUsers = await prisma.subscription.count({
      where: { plan: "pro", status: "active" },
    });

    const platformTenantId = process.env.PLATFORM_SOCIAL_TENANT_ID ?? "platform";

    const reportHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#243044;padding:20px;">
<h1>Launch Desk Platform Report — Week of ${weekAgo.toISOString().slice(0, 10)}</h1>
<h2>Tenant Overview</h2>
<ul>
  <li>Total tenants: <strong>${totalTenants}</strong></li>
  <li>New signups this week: <strong>${newTenants}</strong></li>
  <li>Active paid subscriptions: <strong>${activeSubs}</strong></li>
</ul>
<h2>Plan Distribution</h2>
<ul>
  <li>Free: ${freeUsers}</li>
  <li>Growth: ${growthUsers}</li>
  <li>Pro: ${proUsers}</li>
</ul>
<h2>Conversion Funnel</h2>
<p>Free → Paid conversion rate: <strong>${totalTenants > 0 ? ((activeSubs / totalTenants) * 100).toFixed(1) : 0}%</strong></p>
<p>Generated by Launch Desk AI at ${now.toISOString()}</p>
</body>
</html>`;

    const campaign = await email.createCampaign(platformTenantId, {
      name: `platform-report-${now.toISOString().slice(0, 10)}`,
      subject: `Platform Report — Launch Desk (${newTenants} new signups this week)`,
      bodyHtml: reportHtml,
    });
    await email.sendCampaign(campaign.id, [operatorEmail]);
    actions.push(`Sent platform report to ${operatorEmail}`);

    return {
      agentType: "report-platform",
      success: true,
      actions,
      tokensUsed: 0,
    };
  } catch (error) {
    return {
      agentType: "report-platform",
      success: false,
      actions,
      tokensUsed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
