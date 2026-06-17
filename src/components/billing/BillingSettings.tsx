"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { BillingState } from "@/app/billing/actions";
import { cancelSubscriptionAction } from "@/app/billing/actions";

const STATUS_LABEL: Record<BillingState["status"], string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  none: "Free plan",
};

// Current plan + manage/cancel. Mirrors server state from getBillingStateAction;
// cancel calls the server action (mock provider now / Paystack later).
export function BillingSettings({
  initialState,
}: {
  initialState: BillingState;
}) {
  const router = useRouter();
  const [state, setState] = useState<BillingState>(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const isPaid = state.plan !== "free";
  const periodEnd = state.currentPeriodEnd
    ? new Date(state.currentPeriodEnd).toLocaleDateString("en-ZA", {
        dateStyle: "medium",
      })
    : null;

  async function cancel() {
    setBusy(true);
    setNotice("");
    try {
      const next = await cancelSubscriptionAction(false);
      setState(next);
      setNotice(
        "Your plan is set to cancel at the end of the current period. You keep your features until then.",
      );
      router.refresh();
    } catch {
      setNotice("Could not cancel — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="billing-panel" aria-label="Current plan">
      <div className="billing-plan-row">
        <div>
          <span className="billing-label">Current plan</span>
          <strong className="billing-plan-name">{state.planName}</strong>
        </div>
        <span className={`billing-status billing-status-${state.status}`}>
          {STATUS_LABEL[state.status]}
        </span>
      </div>

      {periodEnd ? (
        <p className="billing-meta">
          {state.cancelAtPeriodEnd
            ? `Cancels on ${periodEnd}.`
            : `Renews on ${periodEnd}.`}
        </p>
      ) : (
        <p className="billing-meta">
          You are on the free plan — a branded Launch Desk subdomain with a
          “Powered by Launch Desk” badge.
        </p>
      )}

      {notice ? (
        <p className="billing-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="billing-actions">
        <Link className="primary-button" href="/pricing">
          {isPaid ? "Change plan" : "Upgrade"}
        </Link>
        {isPaid && !state.cancelAtPeriodEnd ? (
          <button
            className="ghost-button"
            type="button"
            onClick={cancel}
            disabled={busy}
          >
            {busy ? "Canceling…" : "Cancel subscription"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
