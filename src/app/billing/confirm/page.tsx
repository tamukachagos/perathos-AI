import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/authz";
import { confirmUpgradeAction } from "@/app/billing/actions";
import { isPlanId } from "@/lib/billing/plans";

interface ConfirmProps {
  searchParams: Promise<{ reference?: string; plan?: string }>;
}

// Mock-checkout return URL. The mock billing provider redirects here with the
// reference + plan; we activate the subscription (simulating a successful, free
// "payment") and bounce to billing settings. With Paystack this is the
// post-checkout callback that the webhook also corroborates.
export default async function BillingConfirmPage({
  searchParams,
}: ConfirmProps) {
  const ctx = await getCurrentTenant();
  if (!ctx) redirect("/sign-in");

  const { reference, plan } = await searchParams;

  if (reference && isPlanId(plan)) {
    let confirmed = false;
    try {
      await confirmUpgradeAction(plan, reference);
      confirmed = true;
    } catch {
      // fall through to the error state below
    }
    // redirect() throws a control-flow signal, so it MUST run outside the
    // try/catch or the catch would swallow it.
    if (confirmed) redirect("/billing");
  }

  // Only reached when params are missing/invalid (a real redirect throws above).
  return (
    <main className="billing-shell">
      <header className="billing-head">
        <h1>Checkout incomplete</h1>
        <p>We could not confirm your upgrade. No charge was made.</p>
      </header>
      <Link className="primary-button" href="/pricing">
        Back to pricing
      </Link>
    </main>
  );
}
