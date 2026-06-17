import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/authz";
import { getCreditsStateAction } from "@/app/credits/actions";
import { CreditsPanel } from "@/components/billing/CreditsPanel";

export const metadata: Metadata = {
  title: "Credits — Launch Desk",
};

// Prepaid credits: balance in Rand, a usage progress bar, top-up, and history.
// Requires an authenticated tenant; anonymous visitors are sent to sign-in.
export default async function CreditsPage() {
  const ctx = await getCurrentTenant();
  if (!ctx) redirect("/sign-in");

  const state = await getCreditsStateAction();

  return (
    <main className="billing-shell">
      <header className="billing-head">
        <Link className="anchor-link" href="/">
          ← Back to dashboard
        </Link>
        <h1>Credits</h1>
        <p>
          Your prepaid balance. AI assistance, hosting, and domains all draw from
          it — you are never charged more than you have topped up.
        </p>
      </header>
      <CreditsPanel initialState={state} />
      <p className="billing-foot">
        Looking for your plan?{" "}
        <Link className="anchor-link" href="/billing">
          Billing &amp; plan
        </Link>
        .
      </p>
    </main>
  );
}
