"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CreditsState } from "@/app/credits/actions";
import { topUpAction } from "@/app/credits/actions";

const TOPUP_PRESETS = [30, 75, 150, 300];

// Owner-facing credits view: balance in RAND, a usage progress bar, top-up, and
// a plain-language usage history. Never shows tokens or model names (§6).
export function CreditsPanel({ initialState }: { initialState: CreditsState }) {
  const router = useRouter();
  const [state, setState] = useState<CreditsState>(initialState);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState<number>(75);

  async function topUp(value: number) {
    setBusy(true);
    setNotice("");
    try {
      const result = await topUpAction(value);
      if (result.kind === "checkout") {
        setNotice("Opening secure checkout...");
        router.push(result.checkoutUrl);
        return;
      }
      const next = result.state;
      setState(next);
      setNotice(`Added R${value} to your credits. New balance ${next.balanceZar}.`);
      router.refresh();
    } catch {
      setNotice("Could not add credits — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="credits-panel" aria-label="Your credits">
      <div className="credits-balance">
        <span className="billing-label">Credit balance</span>
        <strong className="credits-amount">{state.balanceZar}</strong>
        <p className="billing-meta">
          You pay for what you use — AI assistance, hosting, and domains all draw
          from one balance. Top up anytime; you are never charged more than your
          balance.
        </p>
      </div>

      <div className="credits-usage" aria-label="This month's usage">
        <div className="credits-usage-head">
          <span>This month</span>
          <strong>
            {state.periodSpendZar} of {state.allowanceZar}
          </strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={state.usagePercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Monthly usage"
        >
          <span style={{ width: `${state.usagePercent}%` }} />
        </div>
      </div>

      <div className="credits-topup">
        <span className="billing-label">Add credits</span>
        <div className="credits-presets">
          {TOPUP_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              className={`ghost-button${amount === v ? " is-active" : ""}`}
              onClick={() => setAmount(v)}
              disabled={busy}
            >
              R{v}
            </button>
          ))}
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => topUp(amount)}
          disabled={busy}
        >
          {busy ? "Adding…" : `Add R${amount}`}
        </button>
      </div>

      {notice ? (
        <p className="billing-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="credits-history" aria-label="Recent usage">
        <h2>Recent usage</h2>
        {state.recent.length === 0 ? (
          <p className="billing-meta">
            No usage yet. As your site, AI, and hosting do work, it shows here.
          </p>
        ) : (
          <ul className="credits-history-list">
            {state.recent.map((line) => (
              <li key={line.id}>
                <span className="credits-history-label">{line.label}</span>
                <span className="credits-history-when">
                  {new Date(line.createdAt).toLocaleDateString("en-ZA", {
                    dateStyle: "medium",
                  })}
                </span>
                <span className="credits-history-amount">-{line.amountZar}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
