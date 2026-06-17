"use client";

// Approval UI affordance for a gated action (M3). The owner reviews the exact
// verb + payload, performs a step-up confirmation, then the dialog:
//   1. requests a payload-bound token (requestApprovalAction), and
//   2. redeems it through the ActionRouter (runGatedAction).
// If the verb is async, the router returns an OperationRef which the dialog
// polls until it settles. In mock mode this all runs locally (in-memory).

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { Business } from "@/lib/types";
import {
  requestApprovalAction,
  runGatedAction,
} from "@/app/approvals/actions";

interface Props {
  verb: string;
  label: string;
  business: Business;
  /** The exact payload the approval is bound to (shown for review). */
  payload: Record<string, unknown>;
  onClose: () => void;
  onResult: (message: string) => void;
}

export function ApprovalDialog({
  verb,
  label,
  business,
  payload,
  onClose,
  onResult,
}: Props) {
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approveAndRun() {
    setError("");
    if (!stepUp) {
      setError("Tick the confirmation to approve this action.");
      return;
    }
    setBusy(true);
    // One idempotency key binds the approval to exactly this attempt.
    const idempotencyKey = `${verb}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
      const grant = await requestApprovalAction({
        verb,
        payload,
        idempotencyKey,
        stepUp: true,
      });
      const outcome = await runGatedAction({
        verb,
        business,
        payload,
        idempotencyKey,
        approvalToken: grant.token,
      });

      if (outcome.status === "denied") {
        setError(outcome.detail);
        return;
      }
      if (outcome.status === "accepted") {
        onResult(`${label}: ${outcome.detail}`);
        void pollOperation(outcome.operation.id);
        onClose();
        return;
      }
      onResult(`${label}: ${outcome.detail}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed.");
    } finally {
      setBusy(false);
    }
  }

  async function pollOperation(id: string) {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const res = await fetch(`/api/operations/${id}`);
        const json = await res.json();
        if (json.ok && json.operation.status !== "pending") {
          onResult(`${label}: ${json.operation.detail}`);
          return;
        }
      } catch {
        return;
      }
    }
  }

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label={`Approve ${label}`}>
      <div className="wizard-panel panel approval-panel">
        <header className="section-heading">
          <div>
            <h2>
              <ShieldCheck size={18} /> Approve: {label}
            </h2>
            <p>This is a risky action. Review the details and confirm to authorise it.</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="wizard-body">
          <dl className="approval-detail">
            <dt>Action</dt>
            <dd>{verb}</dd>
            {Object.entries(payload).map(([k, v]) => (
              <div key={k} className="approval-row">
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>

          <label className="field field-inline">
            <input
              type="checkbox"
              checked={stepUp}
              onChange={(e) => setStepUp(e.target.checked)}
            />
            <span>I am the owner and I authorise this action.</span>
          </label>

          {error ? <p className="wizard-error">{error}</p> : null}

          <div className="wizard-actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={approveAndRun}
              disabled={busy}
            >
              <ShieldCheck size={16} />
              {busy ? "Authorising…" : "Approve & run"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
