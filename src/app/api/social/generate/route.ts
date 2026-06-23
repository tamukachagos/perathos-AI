// Social caption generation endpoint.
//
//   POST /api/social/generate
//   Body: { businessName, industry, topic?, tone?, platform? }
//
// Uses routeLlm at CHEAP tier to generate an engaging caption for a specific
// social platform. Returns { ok: true, caption, hashtags }.
// Auth required.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { routeLlm } from "@/integrations/llm";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

interface Body {
  businessName?: unknown;
  industry?: unknown;
  topic?: unknown;
  tone?: unknown;
  platform?: unknown;
}

const FALLBACK_CAPTION =
  "Exciting things are happening at our business! Stay tuned for more updates.";
const FALLBACK_HASHTAGS = ["#business", "#southafrica", "#growth"];

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
  const tone =
    typeof body.tone === "string" &&
    ["professional", "casual", "promotional"].includes(body.tone)
      ? body.tone
      : "professional";
  const platform =
    typeof body.platform === "string" && body.platform.trim()
      ? body.platform.trim()
      : "social media";

  // 3. Build prompt
  const topicLine = topic
    ? ` Topic/context to reference: "${topic}".`
    : "";

  const systemPrompt = `You are a South African social media expert. Generate an engaging ${platform} caption for ${businessName}, a ${industry} business. Tone: ${tone}. Include 3-5 relevant hashtags. Under 250 words. No emojis unless clearly appropriate.`;

  const userPrompt = `Generate a ${tone} ${platform} caption for ${businessName} (${industry} business).${topicLine} Return JSON: {"caption": "string", "hashtags": ["#tag1", "#tag2", "#tag3"]}`;

  // 4. Call LLM
  const repos = await getRepositories();
  const idempotencyKey = `social.generate.${ctx.tenantId}.${randomBytes(8).toString("hex")}`;

  const outcome = await routeLlm(
    { wallet: repos.wallet, audit: repos.audit, repos },
    {
      tenantId: ctx.tenantId,
      task: "copy.generate",
      input: {
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 512,
        expectJson: (parsed: unknown) => {
          if (typeof parsed !== "object" || parsed === null) return false;
          const obj = parsed as Record<string, unknown>;
          return typeof obj.caption === "string" && Array.isArray(obj.hashtags);
        },
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
  let caption = FALLBACK_CAPTION;
  let hashtags: string[] = FALLBACK_HASHTAGS;

  try {
    const text = outcome.result.text.trim();
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    const json = JSON.parse(fence ? fence[1] : text) as {
      caption?: unknown;
      hashtags?: unknown;
    };
    if (typeof json.caption === "string" && json.caption.trim()) {
      caption = json.caption.trim();
    }
    if (
      Array.isArray(json.hashtags) &&
      json.hashtags.every((h) => typeof h === "string")
    ) {
      hashtags = (json.hashtags as string[]).slice(0, 5);
    }
  } catch {
    // JSON parse failed — use fallbacks
  }

  return NextResponse.json({ ok: true, caption, hashtags });
}
