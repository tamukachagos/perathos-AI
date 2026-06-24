// AI email-body generator.
//
//   POST /api/email/generate-body
//   Body: { businessName, industry, topic, tone }
//
// Uses routeLlm (CHEAP tier / copy.generate task) to generate a full HTML email
// body and a plain-text version. Returns { html, plainText }.
// Auth required.

import { NextResponse, type NextRequest } from "next/server";
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
}

const FALLBACK_HTML = `<h2>Hello!</h2>
<p>Thank you for being a valued customer. We have some exciting updates to share with you.</p>
<p>We appreciate your continued support and look forward to serving you.</p>
<p>Best regards,<br>The Team</p>`;

const FALLBACK_PLAIN = `Hello!

Thank you for being a valued customer. We have some exciting updates to share with you.

We appreciate your continued support and look forward to serving you.

Best regards,
The Team`;

export async function POST(request: NextRequest) {
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
    typeof body.businessName === "string" ? body.businessName.trim() : "our business";
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "business";
  const topic =
    typeof body.topic === "string" ? body.topic.trim() : "general update";
  const tone =
    typeof body.tone === "string" ? body.tone.trim() : "professional";

  // 3. Repos for routeLlm
  const repos = await getRepositories();

  const prompt = `Write a ${tone} marketing email for ${businessName}, a ${industry} business, about: "${topic}".

Return JSON with two fields:
- "html": a complete HTML email body (use basic HTML: h2, p, ul, strong, a tags). Keep it under 400 words. Include a clear call-to-action.
- "plainText": the same content as plain text.

JSON format: {"html": "...", "plainText": "..."}`;

  const idempotencyKey = `generate-body-${ctx.tenantId}-${randomBytes(8).toString("hex")}`;

  let html = FALLBACK_HTML;
  let plainText = FALLBACK_PLAIN;

  try {
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
          maxTokens: 1024,
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

    const parsed = JSON.parse(outcome.result.text) as {
      html?: unknown;
      plainText?: unknown;
    };
    if (typeof parsed.html === "string" && parsed.html.trim()) {
      html = parsed.html;
    }
    if (typeof parsed.plainText === "string" && parsed.plainText.trim()) {
      plainText = parsed.plainText;
    }
  } catch {
    // LLM or parse failure — return fallbacks
  }

  return NextResponse.json({ ok: true, html, plainText });
}
