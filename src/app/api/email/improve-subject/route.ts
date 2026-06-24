// AI subject-line improver.
//
//   POST /api/email/improve-subject
//   Body: { subject, businessName, industry }
//
// Uses routeLlm (CHEAP tier / copy.generate task) to return 3 improved subject
// lines under 60 characters, compelling but not clickbait.
// Returns { subjects: [string, string, string] }.
// Auth required.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { routeLlm } from "@/integrations/llm";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

interface Body {
  subject?: unknown;
  businessName?: unknown;
  industry?: unknown;
}

const FALLBACK_SUBJECTS = [
  "You won't want to miss this update",
  "Something special inside — just for you",
  "Quick note from our team",
];

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

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "our business";
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "business";

  if (!subject) {
    return NextResponse.json({ ok: false, error: "subject is required" }, { status: 400 });
  }

  // 3. Repos for routeLlm
  const repos = await getRepositories();

  const prompt = `Improve this email subject line for a ${industry} business called "${businessName}". Original: "${subject}". Return 3 improved versions as JSON: {"subjects": [s1, s2, s3]}. Make them compelling, under 60 chars, no clickbait, professional.`;

  const idempotencyKey = `improve-subject-${ctx.tenantId}-${randomBytes(8).toString("hex")}`;

  let subjects: string[] = FALLBACK_SUBJECTS;

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

    const parsed = JSON.parse(outcome.result.text) as { subjects?: unknown };
    if (
      Array.isArray(parsed.subjects) &&
      parsed.subjects.length >= 3 &&
      parsed.subjects.every((s) => typeof s === "string")
    ) {
      subjects = (parsed.subjects as string[]).slice(0, 3);
    }
  } catch {
    // LLM or parse failure — return fallbacks
  }

  return NextResponse.json({ ok: true, subjects });
}
