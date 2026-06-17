import type { Business, PublishedSites } from "@/lib/types";
import { getCurrentTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { effectivePlan, entitlementsForSubscription } from "@/lib/billing/service";
import { planFor, type Entitlements, type PlanId } from "@/lib/billing/plans";
import { Dashboard } from "@/components/dashboard/Dashboard";

// Server component: resolves the session/tenant and, when authenticated, loads
// the persisted business + published sites from the repository. Anonymous users
// get the local-draft UX (no initial data) exactly as in M0.
export default async function Page() {
  const ctx = await getCurrentTenant();

  let initialBusiness: Business | null = null;
  let initialSites: PublishedSites | null = null;
  let email: string | null = null;
  // Default tier for anonymous/new tenants is Free.
  let plan: PlanId = "free";
  let entitlements: Entitlements = planFor("free").entitlements;

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
  }

  return (
    <Dashboard
      authenticated={Boolean(ctx)}
      email={email}
      initialBusiness={initialBusiness}
      initialSites={initialSites}
      planName={planFor(plan).name}
      entitlements={entitlements}
    />
  );
}
