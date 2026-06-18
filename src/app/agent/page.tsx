import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/authz";
import { getAgentStateAction } from "@/app/agent/actions";
import { AgentTeamPanel } from "@/components/dashboard/AgentTeamPanel";

export const metadata: Metadata = {
  title: "Your AI team — Launch Desk",
};

// W7 — The owner-facing agent-team page. Server component: resolves the tenant
// and loads the agent state (entitlement-gated inside the action), then hands a
// serialized state to the client panel. Anonymous visitors go to sign-in.
export default async function AgentPage() {
  const ctx = await getCurrentTenant();
  if (!ctx) redirect("/sign-in");

  const state = await getAgentStateAction();

  return (
    <main className="billing-shell">
      <header className="billing-head">
        <Link className="anchor-link" href="/">
          ← Back to dashboard
        </Link>
        <h1>Your AI team</h1>
        <p>
          A web team on call. Tell them what you want in plain English; they fix
          breakages overnight and only interrupt you for a yes/no. You pay for
          what they do.
        </p>
      </header>
      <AgentTeamPanel initialState={state} />
    </main>
  );
}
