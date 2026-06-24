"use server";

// SeoAgent — SEO optimization: sitemaps, meta tag generation, keyword research.
// Pings Google Search Console after sitemap generation (fire-and-forget).
// Semrush-grade local SEO focus for SA businesses.

import { prisma } from "@/lib/prisma";
import { routeLlm } from "@/integrations/llm";
import { getRepositories } from "@/lib/db";
import type { AgentResult, MarketingContext } from "@/marketing/types";
import { localeSeoInstruction, getSearchEngine } from "@/marketing/localeInstruction";

/** Generate idempotency key for SEO LLM calls. */
function idem(tenantId: string, type: string): string {
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return `seo-agent:${tenantId}:${type}:${day}`;
}

/**
 * Ping Google Search Console to re-crawl a sitemap.
 * Fire-and-forget: never throws, logs silently.
 */
async function pingGoogle(sitemapUrl: string): Promise<void> {
  try {
    const pingUrl = `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`;
    await fetch(pingUrl, { method: "GET" });
  } catch {
    // Intentionally swallowed — pinging GSC is best-effort
  }
}

/**
 * Run the SEO agent for a tenant:
 * 1. Generate/refresh sitemap for their published site
 * 2. AI-optimize meta descriptions for each page
 * 3. Generate local keyword opportunities
 * 4. Ping Google
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;

  try {
    const repos = await getRepositories();

    // Find the published site(s) for this tenant
    const sites = await prisma.generatedSite.findMany({
      where: { tenantId: ctx.tenantId, status: "published" },
      select: { slug: true, id: true },
    });

    for (const site of sites) {
      // ------------------------------------------------------------------
      // 1. SITEMAP — list all published pages + the root
      // ------------------------------------------------------------------
      const pages = await prisma.sitePage.findMany({
        where: { tenantId: ctx.tenantId, siteSlug: site.slug, published: true },
        select: { path: true, updatedAt: true },
      });

      const baseUrl = ctx.domain
        ? `https://${ctx.domain}`
        : `https://app.perathos.com/s/${site.slug}`;

      const sitemapEntries = [
        `  <url><loc>${baseUrl}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><priority>1.0</priority></url>`,
        ...pages.map(
          (p) =>
            `  <url><loc>${baseUrl}${p.path}</loc><lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod><priority>0.8</priority></url>`,
        ),
      ].join("\n");

      // Store sitemap as a JSON result in MarketingRun metadata (route serves it)
      await prisma.marketingRun.create({
        data: {
          tenantId: ctx.tenantId,
          agentType: "seo-sitemap",
          status: "done",
          result: {
            slug: site.slug,
            sitemap: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>`,
            generatedAt: new Date().toISOString(),
          },
          endedAt: new Date(),
        },
      });

      actions.push(`Generated sitemap for /${site.slug} (${pages.length + 1} URLs)`);

      // Ping Google (only for markets where Google is the primary search engine)
      const sitemapUrl = `${baseUrl}/sitemap.xml`;
      const searchEngine = getSearchEngine(ctx.countryCode ?? "ZA");
      if (searchEngine === "Google" || searchEngine.startsWith("Google")) {
        await pingGoogle(sitemapUrl);
        actions.push(`Pinged Google Search Console: ${sitemapUrl}`);
      } else {
        // Note: Baidu and Yandex have their own webmaster tools APIs
        actions.push(`Skipped Google ping for ${ctx.countryCode ?? "ZA"} market (primary engine: ${searchEngine})`);
      }

      // ------------------------------------------------------------------
      // 2. META TAG OPTIMIZATION — generate for each page missing metaDesc
      // ------------------------------------------------------------------
      const pagesNeedingMeta = await prisma.sitePage.findMany({
        where: {
          tenantId: ctx.tenantId,
          siteSlug: site.slug,
          published: true,
          metaDesc: null,
        },
        take: 10,
      });

      for (const page of pagesNeedingMeta) {
        const locale = ctx.locale ?? "en";
        const countryCode = ctx.countryCode ?? "ZA";
        const prompt = `Write a 155-character meta description for a ${ctx.industry} business called ${ctx.businessName} in ${ctx.location}, South Africa. Page: ${page.title}.
Include: main service, location keyword, call to action. Write for Google search results. Exactly 155 characters or fewer.${localeSeoInstruction(locale, countryCode)}`;

        const outcome = await routeLlm(
          { wallet: repos.wallet, audit: repos.audit, repos },
          {
            tenantId: ctx.tenantId,
            task: "copy.generate",
            input: { messages: [{ role: "user", content: prompt }], maxTokens: 100 },
            idempotencyKey: idem(ctx.tenantId, `meta-${page.id}`),
          },
        );

        if (outcome.status === "ok" && outcome.result.text) {
          const metaDesc = outcome.result.text.trim().slice(0, 155);
          await prisma.sitePage.update({
            where: { id: page.id },
            data: { metaDesc },
          });
          tokensUsed += outcome.result.usage.inputTokens + outcome.result.usage.outputTokens;
          actions.push(`Optimized meta description for page "${page.title}"`);
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. KEYWORD OPPORTUNITIES — 10 local keywords
    // ------------------------------------------------------------------
    const seoLocale = ctx.locale ?? "en";
    const seoCountryCode = ctx.countryCode ?? "ZA";
    const keywordPrompt = `List 10 high-value Google search keywords for a ${ctx.industry} business in ${ctx.location}, South Africa.
Include: local modifier + service combinations, "near me" variants, and Zulu or Afrikaans variations if applicable to ${ctx.location}.
Return ONLY a JSON array of strings, e.g.: ["keyword 1","keyword 2",...]${localeSeoInstruction(seoLocale, seoCountryCode)}`;

    const keywordOutcome = await routeLlm(
      { wallet: repos.wallet, audit: repos.audit, repos },
      {
        tenantId: ctx.tenantId,
        task: "copy.generate",
        input: {
          messages: [{ role: "user", content: keywordPrompt }],
          expectJson: (p) => Array.isArray(p),
          maxTokens: 300,
        },
        idempotencyKey: idem(ctx.tenantId, "keywords"),
      },
    );

    if (keywordOutcome.status === "ok" && keywordOutcome.result.text) {
      tokensUsed += keywordOutcome.result.usage.inputTokens + keywordOutcome.result.usage.outputTokens;
      actions.push(`Generated local keyword opportunities for ${ctx.location}`);

      // Store keywords in a MarketingRun record for dashboard display
      try {
        const keywords = JSON.parse(keywordOutcome.result.text.trim()) as string[];
        await prisma.marketingRun.create({
          data: {
            tenantId: ctx.tenantId,
            agentType: "seo-keywords",
            status: "done",
            result: { keywords, industry: ctx.industry, location: ctx.location },
            endedAt: new Date(),
          },
        });
      } catch {
        // JSON parse failed — store raw
        await prisma.marketingRun.create({
          data: {
            tenantId: ctx.tenantId,
            agentType: "seo-keywords",
            status: "done",
            result: { raw: keywordOutcome.result.text },
            endedAt: new Date(),
          },
        });
      }
    }

    if (actions.length === 0) {
      actions.push("No published sites found for SEO optimization");
    }

    return { agentType: "seo", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "seo",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
