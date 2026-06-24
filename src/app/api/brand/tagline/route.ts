// Brand tagline generation endpoint.
//
//   POST /api/brand/tagline
//   Body: { businessName, industry, location }
//
// Uses the routeLlm CHEAP tier (Llama 70B via OpenRouter) to generate 3 short,
// punchy taglines for the SA market. Returns { ok: true, taglines: string[] }.
//
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
  location?: unknown;
}

const FALLBACK_TAGLINES = [
  "Quality you can trust.",
  "Built for your community.",
  "Your success, our mission.",
];

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
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "business";
  const location =
    typeof body.location === "string" ? body.location.trim() : "South Africa";

  if (!businessName) {
    return NextResponse.json(
      { ok: false, error: "missing_business_name" },
      { status: 400 },
    );
  }

  // 3. Get repos for routeLlm
  const repos = await getRepositories();

  const prompt = `Generate 3 short, punchy business taglines for ${businessName}, a ${industry} business in ${location}. Each should be under 8 words. SA market. Return JSON: {"taglines": [string, string, string]}`;

  const idempotencyKey = `tagline-${ctx.tenantId}-${randomBytes(8).toString("hex")}`;

  const outcome = await routeLlm(
    {
      wallet: repos.wallet,
      audit: repos.audit,
      repos,
    },
    {
      tenantId: ctx.tenantId,
      task: "copy.generate",
      input: {
        messages: [{ role: "user", content: prompt }],
        maxTokens: 256,
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

  // 4. Parse taglines from LLM result
  let taglines: string[] = FALLBACK_TAGLINES;
  try {
    const parsed = JSON.parse(outcome.result.text) as { taglines?: unknown };
    if (
      Array.isArray(parsed.taglines) &&
      parsed.taglines.length >= 3 &&
      parsed.taglines.every((t) => typeof t === "string")
    ) {
      taglines = (parsed.taglines as string[]).slice(0, 3);
    }
  } catch {
    // JSON parse failed — fall back to defaults
  }

  return NextResponse.json({ ok: true, taglines });
}
