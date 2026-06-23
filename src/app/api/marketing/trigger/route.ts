// POST /api/marketing/trigger — manually trigger a marketing agent.
// Requires authenticated session with Growth or Pro plan.
// Body: { agentType: "content"|"social"|"email"|"seo"|"nurture"|"reputation"|"report" }

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { runForTenant } from "@/marketing/conductor";

const ALLOWED_AGENT_TYPES = [
  "content",
  "social",
  "email",
  "seo",
  "nurture",
  "reputation",
  "report",
] as const;

type AllowedAgentType = (typeof ALLOWED_AGENT_TYPES)[number];

export async function POST(request: Request) {
  // Auth
  let tenantCtx: Awaited<ReturnType<typeof requireTenant>>;
  try {
    tenantCtx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Plan gate — Growth and Pro only
  const repos = await getRepositories();
  const sub = await repos.subscriptions.get(tenantCtx.tenantId);
  const plan = sub?.plan ?? "free";

  if (plan === "free") {
    return NextResponse.json(
      {
        ok: false,
        error: "plan_required",
        detail:
          "Marketing agents are available on Growth and Pro plans. Upgrade to unlock.",
      },
      { status: 403 },
    );
  }

  // Parse body
  let agentType: string;
  try {
    const body = (await request.json()) as { agentType?: unknown };
    agentType = String(body.agentType ?? "").trim();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  if (!ALLOWED_AGENT_TYPES.includes(agentType as AllowedAgentType)) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_agent_type",
        detail: `agentType must be one of: ${ALLOWED_AGENT_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Run the agent
  try {
    const result = await runForTenant(tenantCtx.tenantId, agentType);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "agent_failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
