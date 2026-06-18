"use client";

// W7 — Owner-facing agent-team panel (ENTERPRISE_REVIEW Part 7).
//
// CLIENT component. It imports ONLY the server actions BY REFERENCE (no server
// modules, no DB, no node:crypto), so the client/server split stays clean and a
// `Remove-Item .next` build shows no UnhandledSchemeError. The whole panel is
// gated behind the `agentTeam` entitlement: an unentitled tenant sees an upgrade
// prompt instead of the controls.
//
// The mental model sold: "You have a web team on call. Tell them what you want in
// plain English. They fix breakages and only interrupt you for a yes/no."

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AgentState } from "@/app/agent/actions";
import {
  askTeamAction,
  setPausedAction,
} from "@/app/agent/actions";

export function AgentTeamPanel({ initialState }: { initialState: AgentState }) {
  const router = useRouter();
  const [state, setState] = useState<AgentState>(initialState);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // Unentitled tenants get an upgrade prompt, never the controls.
  if (!state.entitled) {
    return (
      <section className="panel agent-team-panel" aria-label="Your AI team">
        <div className="section-heading">
          <div>
            <h2>Your AI team</h2>
            <p>
              An always-on team that fixes breakages, ships updates, and keeps
              your site secure — and only interrupts you for a yes/no.
            </p>
          </div>
        </div>
        <div className="agent-upgrade">
          <p>
            The AI team is part of the <strong>Pro</strong> plan. Upgrade to put a
            web team on call.
          </p>
          <Link className="button-primary" href="/billing">
            See Pro
          </Link>
        </div>
      </section>
    );
  }

  async function ask() {
    setBusy(true);
    setNotice("");
    try {
      const next = await askTeamAction(request);
      setState(next);
      setRequest("");
      setNotice("Your team is on it. Anything for you will appear below.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not reach your team.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    setBusy(true);
    setNotice("");
    try {
      const next = await setPausedAction(!state.paused);
      setState(next);
      setNotice(next.paused ? "Your team is paused." : "Your team is back on.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not update your team.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel agent-team-panel" aria-label="Your AI team">
      <div className="section-heading">
        <div>
          <h2>Your AI team</h2>
          <p>Tell them what you want in plain English. Approve only what matters.</p>
        </div>
        <button
          type="button"
          className={state.paused ? "button-danger" : "button-quiet"}
          onClick={togglePause}
          disabled={busy}
          aria-pressed={state.paused}
        >
          {state.paused ? "Paused — resume" : "Pause team"}
        </button>
      </div>

      {/* Ask your team */}
      <div className="agent-ask">
        <label htmlFor="agent-ask-input" className="billing-label">
          Ask your team
        </label>
        <textarea
          id="agent-ask-input"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Add a section about our weekend specials"
          rows={2}
          disabled={busy || state.paused}
        />
        <button
          type="button"
          className="button-primary"
          onClick={ask}
          disabled={busy || state.paused || request.trim().length === 0}
        >
          Send to your team
        </button>
        {notice ? <p className="billing-meta">{notice}</p> : null}
      </div>

      {/* Approval cards */}
      {state.approvals.length > 0 ? (
        <div className="agent-approvals" aria-label="Waiting for your approval">
          <h3>Waiting for your approval</h3>
          <ul className="agent-approval-list">
            {state.approvals.map((card) => (
              <li key={card.jobId} className={`agent-approval risk-${card.riskTier}`}>
                <span className={`risk-pill risk-${card.riskTier}`}>
                  {card.riskLabel}
                </span>
                <p>{card.summary}</p>
                {card.previewUrl ? (
                  <a
                    className="anchor-link"
                    href={card.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview the change
                  </a>
                ) : null}
                {/* Approval itself is owner-only: the tap routes to the
                    owner-facing approval endpoint, which is the ONLY token
                    minter. The agent never appears here as an approver. */}
                <Link className="button-primary" href="/?approve=1">
                  Review &amp; approve
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Activity feed */}
      <div className="agent-activity" aria-label="Recent team activity">
        <h3>Recent activity</h3>
        {state.activity.length === 0 ? (
          <p className="billing-meta">
            Nothing yet. When your team fixes or builds something, it shows here.
          </p>
        ) : (
          <ul className="agent-activity-list">
            {state.activity.map((item) => (
              <li key={item.id}>
                <span>{item.message}</span>
                <time dateTime={item.at}>{relativeTime(item.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** A tiny relative-time helper ("2h ago"). Client-safe, no deps. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
