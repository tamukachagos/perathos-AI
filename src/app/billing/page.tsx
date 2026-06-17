import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/authz";
import { getBillingStateAction } from "@/app/billing/actions";
import { BillingSettings } from "@/components/billing/BillingSettings";

export const metadata: Metadata = {
  title: "Billing — Launch Desk",
};

// Account billing settings: current plan, period, and manage/cancel controls.
// Requires an authenticated tenant; anonymous visitors are sent to sign-in.
export default async function BillingPage() {
  const ctx = await getCurrentTenant();
  if (!ctx) redirect("/sign-in");

  const state = await getBillingStateAction();

  return (
    <main className="billing-shell">
      <header className="billing-head">
        <Link className="anchor-link" href="/">
          ← Back to dashboard
        </Link>
        <h1>Billing</h1>
        <p>Manage your Launch Desk plan. Billed monthly in ZAR, cancel anytime.</p>
      </header>
      <BillingSettings initialState={state} />
      <p className="billing-foot">
        Want to compare plans?{" "}
        <Link className="anchor-link" href="/pricing">
          See pricing
        </Link>
        .
      </p>
    </main>
  );
}
