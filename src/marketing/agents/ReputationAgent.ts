"use server";

// ReputationAgent — Reputation.com-grade review management.
// Drafts responses to reviews (never auto-publishes), flags negatives,
// and generates monthly sentiment reports.

import { prisma } from "@/lib/prisma";
import { routeLlm } from "@/integrations/llm";
import { getRepositories } from "@/lib/db";
import type { AgentResult, MarketingContext } from "@/marketing/types";

function idem(tenantId: string, type: string): string {
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return `reputation-agent:${tenantId}:${type}:${day}`;
}

/**
 * Run the ReputationAgent for a tenant.
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;

  try {
    const repos = await getRepositories();

    // ------------------------------------------------------------------
    // 1. Draft responses to unanswered reviews
    // ------------------------------------------------------------------
    const unansweredReviews = await prisma.reviewRecord.findMany({
      where: {
        tenantId: ctx.tenantId,
        respondedAt: null,
        response: null,
      },
      orderBy: { rating: "asc" }, // Handle negative reviews first
      take: 30,
    });

    for (const review of unansweredReviews) {
      let prompt = "";

      if (review.rating >= 4) {
        // Positive review — warm thank-you
        prompt = `Draft a genuine, warm 2-3 sentence response to this review for ${ctx.businessName}: "${review.text}".
Thank them specifically, invite them back, mention one detail from their review if possible.
SA business tone — warm, not corporate. No exclamation mark overuse. Max 100 words.`;
      } else {
        // Negative/neutral review — empathetic and professional
        prompt = `Draft a professional, empathetic response to this ${review.rating}-star review for ${ctx.businessName}: "${review.text}".
Acknowledge their experience, apologize if appropriate without admitting fault, offer to make it right.
Keep it genuine, not defensive. Invite offline resolution. SA business tone. Max 120 words.`;
      }

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId: ctx.tenantId,
          task: "copy.generate",
          input: {
            messages: [{ role: "user", content: prompt }],
            maxTokens: 200,
          },
          idempotencyKey: idem(ctx.tenantId, `review-response-${review.id}`),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        const draftResponse = outcome.result.text.trim();
        tokensUsed +=
          outcome.result.usage.inputTokens + outcome.result.usage.outputTokens;

        // Save draft response — mark with draft prefix so owner knows it needs approval
        await prisma.reviewRecord.update({
          where: { id: review.id },
          data: {
            response: `[DRAFT — please review before publishing]\n\n${draftResponse}`,
            // Do NOT set respondedAt — that's set only when owner actually publishes
          },
        });

        actions.push(
          `Drafted ${review.rating >= 4 ? "positive" : "empathetic"} response for ${review.rating}-star review from ${review.authorName}`,
        );
      }

      // ------------------------------------------------------------------
      // 2. Flag urgent negative reviews (≤ 2 stars)
      // ------------------------------------------------------------------
      if (review.rating <= 2) {
        // Create a CRM task note for the business owner
        await prisma.crmContact.create({
          data: {
            tenantId: ctx.tenantId,
            name: review.authorName,
            source: "review",
            stage: "new",
            notes: `URGENT: Negative review (${review.rating} stars) needs response.\n\nReview: "${review.text.slice(0, 200)}"\n\nSource: ${review.source}`,
            tags: ["negative-review", "urgent"],
          },
        }).catch(() => {
          // Contact may already exist — silently skip duplicate
        });

        actions.push(
          `URGENT FLAG: ${review.rating}-star review from ${review.authorName} needs immediate response`,
        );
      }
    }

    // ------------------------------------------------------------------
    // 3. Monthly sentiment report (run on the first of the month)
    // ------------------------------------------------------------------
    const isFirstOfMonth = new Date().getUTCDate() === 1;
    if (isFirstOfMonth) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const allReviews = await prisma.reviewRecord.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: "desc" },
      });

      const recentReviews = allReviews.filter(
        (r) => r.createdAt >= thirtyDaysAgo,
      );

      if (allReviews.length > 0) {
        const avgRating =
          allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
        const recentAvg =
          recentReviews.length > 0
            ? recentReviews.reduce((sum, r) => sum + r.rating, 0) /
              recentReviews.length
            : avgRating;
        const responseRate =
          allReviews.filter((r) => r.respondedAt).length / allReviews.length;

        const reviewTexts = allReviews
          .slice(0, 20)
          .map((r) => `${r.rating}★: ${r.text.slice(0, 100)}`)
          .join("\n");

        const sentimentPrompt = `Analyze these recent reviews for ${ctx.businessName} (${ctx.industry} in ${ctx.location}):

${reviewTexts}

Provide a brief sentiment analysis (100 words max):
1. Top 2 things customers love
2. Top 2 complaints or areas to improve
3. One specific recommendation for the business owner`;

        const sentimentOutcome = await routeLlm(
          { wallet: repos.wallet, audit: repos.audit, repos },
          {
            tenantId: ctx.tenantId,
            task: "classify.intent",
            input: {
              messages: [{ role: "user", content: sentimentPrompt }],
              maxTokens: 300,
            },
            idempotencyKey: idem(ctx.tenantId, "sentiment-report"),
          },
        );

        const sentimentText =
          sentimentOutcome.status === "ok"
            ? sentimentOutcome.result.text
            : "Unable to generate sentiment analysis";

        tokensUsed +=
          sentimentOutcome.status === "ok"
            ? sentimentOutcome.result.usage.inputTokens +
              sentimentOutcome.result.usage.outputTokens
            : 0;

        // Store sentiment report in MarketingRun
        await prisma.marketingRun.create({
          data: {
            tenantId: ctx.tenantId,
            agentType: "reputation-report",
            status: "done",
            result: {
              period: new Date().toISOString().slice(0, 7),
              totalReviews: allReviews.length,
              recentReviews: recentReviews.length,
              avgRating: Math.round(avgRating * 10) / 10,
              recentAvgRating: Math.round(recentAvg * 10) / 10,
              responseRate: Math.round(responseRate * 100),
              sentimentAnalysis: sentimentText,
            },
            endedAt: new Date(),
          },
        });

        actions.push(
          `Generated monthly sentiment report (avg ${avgRating.toFixed(1)}★, ${allReviews.length} reviews total)`,
        );
      }
    }

    if (actions.length === 0) {
      actions.push("All reviews have draft responses — no action needed");
    }

    return { agentType: "reputation", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "reputation",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
