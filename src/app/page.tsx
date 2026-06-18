import type { Business, PublishedSites } from "@/lib/types";
import { getCurrentTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { effectivePlan, entitlementsForSubscription } from "@/lib/billing/service";
import { planFor, type Entitlements, type PlanId } from "@/lib/billing/plans";
import { getBalance } from "@/lib/billing/metering";
import {
  currentPeriod,
  formatMicroZar,
  MICRO_PER_RAND,
} from "@/lib/billing/meteringConfig";
import { getAgentStateAction, type AgentState } from "@/app/agent/actions";
import { getCreditsStateAction, type CreditsState } from "@/app/credits/actions";
import { StudioShell } from "@/components/studio/StudioShell";

// Server component: resolves the session/tenant and, when authenticated, loads
// the persisted business + published sites + agent/credits state. Anonymous
// users get the local-draft UX (no initial data) exactly as before. The default
// workspace is now Launch Studio — the Claude-style conversational shell — which
// reuses every existing dashboard panel as a left-menu section.
export default async function Page() {
  const ctx = await getCurrentTenant();

  let initialBusiness: Business | null = null;
  let initialSites: PublishedSites | null = null;
  let email: string | null = null;
  let plan: PlanId = "free";
  let entitlements: Entitlements = planFor("free").entitlements;
  let creditsZar: string | null = null;
  let creditsUsagePercent = 0;
  let agentState: AgentState | null = null;
  let creditsState: CreditsState | null = null;

  if (ctx) {
    const repos = await getRepositories();
    const primary = await repos.businesses.getPrimary(ctx.tenantId);
    if (primary) {
      const { id: _id, tenantId: _tenantId, ...business } = primary;
      void _id;
      void _tenantId;
      initialBusiness = business;
    }
    const sites = await repos.sites.listByTenant(ctx.tenantId);
    initialSites = Object.fromEntries(sites.map((s) => [s.slug, s.site]));
    email = ctx.email;

    const sub = await repos.subscriptions.get(ctx.tenantId);
    plan = effectivePlan(sub);
    entitlements = entitlementsForSubscription(sub);

    // Wallet balance chip (Rand + a usage progress bar; never tokens).
    const balanceMicro = await getBalance(repos, ctx.tenantId);
    creditsZar = formatMicroZar(balanceMicro);
    const period = currentPeriod();
    const periodRows = await repos.usage.listByPeriod(ctx.tenantId, period);
    const periodSpend = periodRows.reduce((s, r) => s + r.amountMicro, 0n);
    const allowance = 30n * MICRO_PER_RAND; // R30 soft allowance (matches /credits)
    creditsUsagePercent =
      allowance > 0n
        ? Math.min(100, Math.round(Number((periodSpend * 100n) / allowance)))
        : 0;

    // Pre-load the agent + credits state so the Activity / Credits sections
    // render with data on first paint (both are entitlement-gated inside).
    agentState = await getAgentStateAction();
    creditsState = await getCreditsStateAction();
  }

  return (
    <StudioShell
      authenticated={Boolean(ctx)}
      email={email}
      initialBusiness={initialBusiness}
      initialSites={initialSites}
      planName={planFor(plan).name}
      entitlements={entitlements}
      creditsZar={creditsZar}
      creditsUsagePercent={creditsUsagePercent}
      agentState={agentState}
      creditsState={creditsState}
    />
  );
}
