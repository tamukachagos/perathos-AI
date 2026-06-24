"use server";

// ContentAgent — generates all marketing content via the LLM router.
// Never calls Anthropic/OpenRouter SDK directly; always uses routeLlm().
// Rate-limited by the global LLM call counter in the conductor.

import { routeLlm } from "@/integrations/llm";
import { getRepositories } from "@/lib/db";
import type { MarketingContext, ContentPiece } from "@/marketing/types";
import { localeInstruction } from "@/marketing/localeInstruction";

export interface ContentOptions {
  contentTypes: string[];
  topic?: string;
  tone?: string;
}

/**
 * Generate a unique idempotency key for an LLM call.
 * Format: agent:tenant:type:epoch-minute so retries within a minute reuse cache.
 */
function idem(tenantId: string, type: string): string {
  const minute = Math.floor(Date.now() / 60_000);
  return `content-agent:${tenantId}:${type}:${minute}`;
}

/**
 * Run the ContentAgent for a given tenant context.
 * Returns an array of ContentPiece objects ready for scheduling or sending.
 */
export async function run(
  ctx: MarketingContext,
  options: ContentOptions,
): Promise<ContentPiece[]> {
  const repos = await getRepositories();
  const pieces: ContentPiece[] = [];

  const { contentTypes, topic, tone } = options;
  const { tenantId, businessName, industry, location, services } = ctx;
  const locale = ctx.locale ?? "en";
  const countryCode = ctx.countryCode ?? "ZA";
  const servicesStr = services.slice(0, 4).join(", ") || industry;

  for (const contentType of contentTypes) {
    // -----------------------------------------------------------------------
    // SOCIAL POST
    // -----------------------------------------------------------------------
    if (contentType === "social-post") {
      const prompt = `You are a top South African social media manager. Create an engaging Facebook/Instagram post for ${businessName}, a ${industry} business in ${location}.
Write as if you ARE the business owner. Include: attention-grabbing first line, value for the community, a call to action, 5 relevant SA hashtags.
Topic: ${topic ?? `showcase our services and expertise in ${servicesStr}`}. Tone: ${tone ?? "warm, professional, community-focused"}.
Under 250 words. No generic filler.${localeInstruction(locale, countryCode)}`;

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId,
          task: "copy.generate",
          input: { messages: [{ role: "user", content: prompt }] },
          idempotencyKey: idem(tenantId, "social-post"),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        pieces.push({
          type: "social-post",
          content: outcome.result.text,
          platform: "facebook,instagram",
          imagePrompt: `${businessName} ${industry} in ${location}, professional, warm SA community vibe`,
        });
      }
    }

    // -----------------------------------------------------------------------
    // BLOG POST (CODE tier — Claude Sonnet)
    // -----------------------------------------------------------------------
    if (contentType === "blog-post") {
      const prompt = `Write a helpful 600-word blog post for ${businessName} (${industry} in ${location}).
Topic: ${topic ?? `tips for customers related to ${industry}`}.
Structure: catchy title, intro that hooks SA readers, 3-4 practical tips, conclusion with soft call to action.
Write in a genuine, helpful voice. South African context and examples.${localeInstruction(locale, countryCode)}`;

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId,
          task: "site.codegen", // CODE tier = Claude Sonnet
          input: { messages: [{ role: "user", content: prompt }] },
          idempotencyKey: idem(tenantId, "blog-post"),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        pieces.push({
          type: "blog-post",
          content: outcome.result.text,
          imagePrompt: `Blog header image for ${businessName} article about ${topic ?? industry}`,
        });
      }
    }

    // -----------------------------------------------------------------------
    // EMAIL NEWSLETTER
    // -----------------------------------------------------------------------
    if (contentType === "email") {
      const prompt = `Write a monthly email newsletter for ${businessName} customers.
Subject line (compelling, under 60 chars): generate one.
Body: personal greeting, business update, one helpful tip about ${industry}, promotional offer for ${servicesStr}, warm sign-off.
HTML format with simple styling. Include {{unsubscribe_link}} placeholder. Under 400 words.
Start your response with SUBJECT: [subject line] on the first line, then the HTML body.${localeInstruction(locale, countryCode)}`;

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId,
          task: "copy.generate",
          input: { messages: [{ role: "user", content: prompt }] },
          idempotencyKey: idem(tenantId, "email"),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        const raw = outcome.result.text;
        const subjectMatch = raw.match(/^SUBJECT:\s*(.+)$/m);
        const subject = subjectMatch ? subjectMatch[1].trim() : `Update from ${businessName}`;
        const bodyStart = raw.indexOf("\n", raw.indexOf("SUBJECT:")) + 1;
        const body = bodyStart > 0 ? raw.slice(bodyStart).trim() : raw;

        pieces.push({
          type: "email",
          content: body,
          subject,
        });
      }
    }

    // -----------------------------------------------------------------------
    // SMS CAMPAIGN
    // -----------------------------------------------------------------------
    if (contentType === "sms") {
      const prompt = `Write a promotional SMS for ${businessName} (${industry} in ${location}). 160 characters max. Include a compelling offer, urgency, and "Reply STOP to opt out". SA market context.${localeInstruction(locale, countryCode)}`;

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId,
          task: "copy.generate",
          input: { messages: [{ role: "user", content: prompt }] },
          idempotencyKey: idem(tenantId, "sms"),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        const smsText = outcome.result.text.trim().slice(0, 160);
        pieces.push({
          type: "sms",
          content: smsText,
        });
      }
    }

    // -----------------------------------------------------------------------
    // AD COPY (Facebook Ads)
    // -----------------------------------------------------------------------
    if (contentType === "ad-copy") {
      const prompt = `Write 3 Facebook ad variations for ${businessName} (${industry} in ${location}).
Each variation must have:
- headline: under 40 characters
- primaryText: under 125 characters
- description: under 30 characters
Target: SA small business owners and local community. Goal: get them to visit the website or WhatsApp.
Return ONLY a JSON array, e.g.: [{"headline":"...","primaryText":"...","description":"..."},...]${localeInstruction(locale, countryCode)}`;

      const outcome = await routeLlm(
        { wallet: repos.wallet, audit: repos.audit, repos },
        {
          tenantId,
          task: "copy.generate",
          input: {
            messages: [{ role: "user", content: prompt }],
            expectJson: (p) => Array.isArray(p) && p.length > 0,
          },
          idempotencyKey: idem(tenantId, "ad-copy"),
        },
      );

      if (outcome.status === "ok" && outcome.result.text) {
        pieces.push({
          type: "ad-copy",
          content: outcome.result.text,
          platform: "facebook",
        });
      }
    }
  }

  return pieces;
}
