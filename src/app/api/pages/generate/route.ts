// AI page content generation endpoint.
//
//   POST /api/pages/generate
//   Body: { pageType, businessName, industry, topic? }
//
// pageType: "about" | "blog-post" | "menu" | "pricing" | "contact"
//
// Uses routeLlm at CODE tier (Claude Sonnet) for quality content generation.
// Returns { ok: true, blocks: Block[] } matching the site block schema.
// Auth required.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { routeLlm } from "@/integrations/llm";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_PAGE_TYPES = ["about", "blog-post", "menu", "pricing", "contact"] as const;
type PageType = (typeof VALID_PAGE_TYPES)[number];

interface Body {
  pageType?: unknown;
  businessName?: unknown;
  industry?: unknown;
  topic?: unknown;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const PAGE_TYPE_PROMPTS: Record<PageType, (businessName: string, industry: string, topic?: string) => string> = {
  about: (businessName, industry) =>
    `Write an "About Us" page for ${businessName}, a ${industry} business based in South Africa.
Include: a warm introduction, the founding story, the team's values, and a call to action to get in touch.
Return 6-8 blocks covering: a main heading, 2-3 paragraphs, a services block with 3 items, and a CTA.`,

  "blog-post": (businessName, industry, topic) =>
    `Write a blog post for ${businessName}, a ${industry} business.${topic ? ` Topic: "${topic}".` : " Pick a relevant topic for the industry."}
South African audience. Practical, helpful tone. 400-600 words.
Return blocks: title heading (h1), subheading (h2), 3-4 paragraphs, a CTA at the end.`,

  menu: (businessName, industry) =>
    `Create a services/menu page for ${businessName}, a ${industry} business.
Include a heading, a short intro paragraph, and a services block with 4-6 realistic items with prices in ZAR.
Return blocks: heading, paragraph, services block.`,

  pricing: (businessName, industry) =>
    `Create a pricing page for ${businessName}, a ${industry} business in South Africa.
Include 3 pricing tiers with names, prices in ZAR, and 3 features each.
Return blocks: heading (h1), paragraph intro, then a services block using items for pricing tiers, then a CTA.`,

  contact: (businessName, industry) =>
    `Create a contact page for ${businessName}, a ${industry} business.
Include a heading, a brief paragraph about how to reach the team, operating hours, and a CTA.
Return blocks: heading (h1), paragraph, CTA.`,
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a professional South African web copywriter. Generate page content as a JSON array of blocks.

Each block must be one of these shapes:
- { "type": "heading", "text": "string", "level": 1 | 2 | 3 }
- { "type": "paragraph", "text": "string" }
- { "type": "image", "url": "", "alt": "string", "caption": "optional string" }
- { "type": "cta", "heading": "string", "subtext": "string", "buttonText": "string", "buttonHref": "#contact" }
- { "type": "services", "items": [{ "name": "string", "description": "string", "price": "optional string" }] }
- { "type": "gallery", "images": [{ "url": "", "alt": "string" }] }
- { "type": "divider" }

Rules:
- Return ONLY a JSON array (no markdown fences, no prose, no wrapper object).
- Use empty string for image urls — the owner will replace them.
- Write for a South African audience. Natural, professional, no hyperbole.
- Keep paragraphs concise (2-4 sentences).
- A "cta" buttonHref should be "#contact" unless instructed otherwise.`;

// ---------------------------------------------------------------------------
// Fallback blocks per page type
// ---------------------------------------------------------------------------

function fallbackBlocks(pageType: PageType, businessName: string): unknown[] {
  const defaults: Record<PageType, unknown[]> = {
    about: [
      { type: "heading", text: `About ${businessName}`, level: 1 },
      { type: "paragraph", text: `${businessName} has been serving South Africans with dedication and care. We believe in honest work and lasting relationships.` },
      { type: "cta", heading: "Let's work together", subtext: "Reach out to our team today.", buttonText: "Contact us", buttonHref: "#contact" },
    ],
    "blog-post": [
      { type: "heading", text: "Our Latest Insights", level: 1 },
      { type: "paragraph", text: "Stay tuned for our latest articles and updates from the team." },
    ],
    menu: [
      { type: "heading", text: "Our Services", level: 1 },
      { type: "services", items: [
        { name: "Service 1", description: "Description of the service.", price: "From R500" },
        { name: "Service 2", description: "Description of the service.", price: "From R800" },
      ]},
    ],
    pricing: [
      { type: "heading", text: "Pricing", level: 1 },
      { type: "paragraph", text: "Simple, transparent pricing. No hidden fees." },
      { type: "cta", heading: "Get a custom quote", subtext: "Contact us for a tailored package.", buttonText: "Get a quote", buttonHref: "#contact" },
    ],
    contact: [
      { type: "heading", text: "Get in Touch", level: 1 },
      { type: "paragraph", text: `Reach out to ${businessName} and we'll get back to you within one business day.` },
      { type: "cta", heading: "Contact us today", subtext: "We're happy to help.", buttonText: "Send a message", buttonHref: "mailto:hello@example.com" },
    ],
  };
  return defaults[pageType];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const pageType =
    typeof body.pageType === "string" && VALID_PAGE_TYPES.includes(body.pageType as PageType)
      ? (body.pageType as PageType)
      : "about";

  const businessName =
    typeof body.businessName === "string" && body.businessName.trim()
      ? body.businessName.trim()
      : "My Business";

  const industry =
    typeof body.industry === "string" && body.industry.trim()
      ? body.industry.trim()
      : "business";

  const topic =
    typeof body.topic === "string" && body.topic.trim()
      ? body.topic.trim()
      : undefined;

  // 3. Build prompt
  const userPrompt = PAGE_TYPE_PROMPTS[pageType](businessName, industry, topic);

  // 4. Call LLM (CODE tier = Claude Sonnet for better content quality)
  const repos = await getRepositories();
  const idempotencyKey = `pages.generate.${ctx.tenantId}.${randomBytes(8).toString("hex")}`;

  const outcome = await routeLlm(
    { wallet: repos.wallet, audit: repos.audit, repos },
    {
      tenantId: ctx.tenantId,
      task: "site.codegen", // CODE tier selects Claude Sonnet
      input: {
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1500,
        expectJson: (parsed: unknown) => Array.isArray(parsed),
      },
      idempotencyKey,
    },
  );

  if (outcome.status === "insufficient_credits") {
    return NextResponse.json(
      { ok: false, error: "insufficient_credits" },
      { status: 402 },
    );
  }

  // 5. Parse result
  let blocks: unknown[] = fallbackBlocks(pageType, businessName);

  try {
    const text = outcome.result.text.trim();
    // Strip markdown code fences if present
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    const raw = fence ? fence[1] : text;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      blocks = parsed;
    }
  } catch {
    // JSON parse failed — use fallbacks
  }

  return NextResponse.json({ ok: true, blocks });
}
