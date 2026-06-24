// AI reply suggestion endpoint.
//
//   POST /api/reviews/suggest-reply
//   Body: { reviewText, rating, businessName?, industry? }
//
// Uses routeLlm CHEAP tier to draft a professional, warm response in under
// 100 words. Returns { ok: true, response: string }.
//
// Auth required.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { routeLlm } from "@/integrations/llm";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

interface Body {
  reviewText?: unknown;
  rating?: unknown;
  businessName?: unknown;
  industry?: unknown;
}

const FALLBACK_RESPONSE =
  "Thank you so much for taking the time to share your feedback! We really appreciate it and look forward to welcoming you back soon.";

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

  const reviewText =
    typeof body.reviewText === "string" ? body.reviewText.trim() : "";
  if (!reviewText) {
    return NextResponse.json(
      { ok: false, error: "review_text_required" },
      { status: 400 },
    );
  }

  const ratingRaw = Number(body.rating);
  const rating = Number.isFinite(ratingRaw) ? Math.round(ratingRaw) : 0;

  // Business context: fall back gracefully if not supplied by client.
  let businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  let industry =
    typeof body.industry === "string" ? body.industry.trim() : "";

  // If the client did not pass business context, try to look it up from the
  // tenant's most-recently published site record so the AI can personalise.
  if (!businessName || !industry) {
    try {
      const repos = await getRepositories();
      const sites = await repos.sites.listByTenant(ctx.tenantId);
      const latest = sites[0];
      if (latest?.site) {
        businessName = businessName || latest.site.name;
        industry = industry || latest.site.industry;
      }
    } catch {
      // Non-fatal: proceed with empty context.
    }
  }

  const bizContext = businessName
    ? `${businessName}${industry ? ` (${industry})` : ""}`
    : "this business";

  const ratingDesc = rating > 0 ? `${rating}-star ` : "";

  const prompt = `Draft a professional, warm response to this ${ratingDesc}review for ${bizContext}: '${reviewText}'. Response should be under 100 words, acknowledge the feedback, thank them, invite them back. SA market tone. Return JSON: {"response": string}`;

  // 3. Route to LLM
  const repos = await getRepositories();
  const idempotencyKey = `suggest-reply-${ctx.tenantId}-${randomBytes(8).toString("hex")}`;

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

  // 4. Parse the response text
  let response: string = FALLBACK_RESPONSE;
  try {
    const parsed = JSON.parse(outcome.result.text) as { response?: unknown };
    if (typeof parsed.response === "string" && parsed.response.trim()) {
      response = parsed.response.trim();
    }
  } catch {
    // JSON parse failed — use fallback
  }

  return NextResponse.json({ ok: true, response });
}
