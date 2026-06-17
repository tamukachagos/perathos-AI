import type { Metadata } from "next";
import { getCurrentTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { effectivePlan } from "@/lib/billing/service";
import { allPlans, type PlanId } from "@/lib/billing/plans";
import { PricingTable } from "@/components/billing/PricingTable";

export const metadata: Metadata = {
  title: "Pricing — Launch Desk",
  description:
    "Simple, South-Africa-first pricing. Go live free, then add your own .co.za domain, your brand, and payments as you grow.",
};

// Server component: resolves the tenant's current plan (Free when anonymous) so
// the table can mark it. No DB call at build with no DATABASE_URL — the
// in-memory repo serves the seed.
export default async function PricingPage() {
  const ctx = await getCurrentTenant();
  let currentPlan: PlanId = "free";
  if (ctx) {
    const repos = await getRepositories();
    const sub = await repos.subscriptions.get(ctx.tenantId);
    currentPlan = effectivePlan(sub);
  }

  return (
    <main className="pricing-shell">
      <header className="pricing-head">
        <h1>Pricing</h1>
        <p>
          Get a South African business online today, free. Upgrade for your own
          .co.za domain, your brand, and payments — billed monthly in Rand, no
          lock-in.
        </p>
      </header>
      <PricingTable
        plans={allPlans()}
        currentPlan={currentPlan}
        authenticated={Boolean(ctx)}
      />
    </main>
  );
}
