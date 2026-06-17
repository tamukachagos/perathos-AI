"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import type { Plan, PlanId } from "@/lib/billing/plans";
import { formatZar } from "@/lib/billing/plans";
import { startUpgradeAction } from "@/app/billing/actions";

interface PricingTableProps {
  plans: Plan[];
  currentPlan: PlanId;
  authenticated: boolean;
}

// The 3-tier pricing table with an upgrade CTA per plan. Mirrors the server
// enforcement: it calls startUpgradeAction, which in mock mode returns an in-app
// confirm URL (no real charge) and with Paystack returns a hosted checkout URL.
export function PricingTable({
  plans,
  currentPlan,
  authenticated,
}: PricingTableProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState("");

  async function choose(plan: PlanId) {
    if (!authenticated) {
      router.push("/sign-in");
      return;
    }
    setError("");
    setBusy(plan);
    try {
      const { checkoutUrl } = await startUpgradeAction(plan);
      // Mock checkout / Paystack hosted page — same call site.
      router.push(checkoutUrl);
    } catch {
      setError("Could not start the upgrade — please try again.");
      setBusy(null);
    }
  }

  return (
    <>
      {error ? (
        <p className="billing-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pricing-grid">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const isFree = plan.priceCents === 0;
          return (
            <article
              key={plan.id}
              className={
                plan.id === "growth" ? "pricing-card featured" : "pricing-card"
              }
              aria-current={isCurrent ? "true" : undefined}
            >
              {plan.id === "growth" ? (
                <span className="pricing-badge">Most popular</span>
              ) : null}
              <h2>{plan.name}</h2>
              <p className="pricing-price">
                <strong>{formatZar(plan.priceCents)}</strong>
                {!isFree ? <span>/month</span> : null}
              </p>
              <p className="pricing-tagline">{plan.tagline}</p>
              <ul className="pricing-features">
                {plan.highlights.map((h) => (
                  <li key={h}>
                    <Check size={15} aria-hidden="true" />
                    {h}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <button className="ghost-button" type="button" disabled>
                  Current plan
                </button>
              ) : (
                <button
                  className={isFree ? "ghost-button" : "primary-button"}
                  type="button"
                  onClick={() => choose(plan.id)}
                  disabled={busy !== null}
                >
                  {busy === plan.id
                    ? "Starting…"
                    : isFree
                      ? "Switch to Free"
                      : `Choose ${plan.name}`}
                </button>
              )}
            </article>
          );
        })}
      </div>
      <p className="pricing-foot">
        Prices in ZAR, billed monthly. Cancel anytime from{" "}
        <Link className="anchor-link" href="/billing">
          billing settings
        </Link>
        . No card data is ever stored by Launch Desk.
      </p>
    </>
  );
}
