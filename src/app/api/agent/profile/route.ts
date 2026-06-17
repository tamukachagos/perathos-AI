// Mock AgentProvider endpoint for the onboarding wizard (M3).
//
//   POST /api/agent/profile  — { description } -> a structured Business profile
//   the user reviews before it populates the dashboard. Backed by the mock
//   generator (deterministic, no API key); M4 swaps it for a real Claude call
//   behind the same request/response shape.
//
// Available to anonymous users too (the wizard runs pre-sign-in), so it does NOT
// require a tenant — it has no side effects and stores nothing.

import { NextResponse } from "next/server";
import { generateBusinessProfile } from "@/integrations/agent/generateProfile";

export const dynamic = "force-dynamic";

interface Body {
  description?: unknown;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 10) {
    return NextResponse.json(
      { ok: false, error: "description_too_short" },
      { status: 400 },
    );
  }

  const { profile, lowConfidence } = await generateBusinessProfile(description);
  return NextResponse.json({ ok: true, profile, lowConfidence });
}
