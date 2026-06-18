"use client";

// W6 — Deploy step (client, non-technical, CLIENT-SAFE per the W3 lesson).
//
// This component imports ONLY:
//   * React + icons,
//   * the server ACTIONS by reference (deployStatusAction /
//     connectCustomDomainAction) — calling a server action from a client
//     component is the supported boundary; the action's server-only imports (the
//     registry/action plane, node:crypto, the hosting/github services) stay on
//     the server and never enter the client bundle.
// It NEVER imports core/registry, the hosting service, or the github service —
// so no server-only module (and no UnhandledSchemeError) can leak into the
// client build.
//
// UX (the owner never sees Git or Vercel): a plain status pill — Building /
// Live / Failed — with a link to the live site + a "History" line showing the
// latest saved change (the commit, surfaced as history), and a "Connect a custom
// domain" action that maps a domain to the deployed site (gated by plan).

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CloudUpload,
  Globe2,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { Business } from "@/lib/types";
import type { DeploymentStatus } from "@/lib/db/types";
import {
  connectCustomDomainAction,
  deployStatusAction,
} from "@/app/deployments/actions";

interface Props {
  business: Business;
  authenticated: boolean;
  /** The slug of the most recently published site, or null when none yet. */
  slug: string | null;
  /** True when the tenant's plan includes a custom domain (M6 entitlement). */
  canConnectDomain: boolean;
  onNotice: (message: string) => void;
}

const STATUS_LABEL: Record<DeploymentStatus, string> = {
  queued: "Deploy queued",
  building: "Building your site",
  live: "Live",
  failed: "Deploy failed",
};

export function DeployStep({
  business,
  authenticated,
  slug,
  canConnectDomain,
  onNotice,
}: Props) {
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [lastCommitSha, setLastCommitSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [domain, setDomain] = useState(business.domain ?? "");
  const [stepUp, setStepUp] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!authenticated || !slug) return;
    setLoading(true);
    try {
      const res = await deployStatusAction(slug);
      setStatus(res.status);
      setUrl(res.url);
      setLastCommitSha(res.lastCommitSha);
    } catch {
      // Non-fatal: the deploy may still be settling; leave the prior status.
    } finally {
      setLoading(false);
    }
  }, [authenticated, slug]);

  // Poll once on mount/slug change, then again while the deploy is in flight so
  // the owner sees it flip to Live without a manual refresh (mock: the reconcile
  // sweep settles it; live: the Vercel webhook).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== "queued" && status !== "building") return undefined;
    const timer = setTimeout(() => void refresh(), 2000);
    return () => clearTimeout(timer);
  }, [status, refresh]);

  async function connect() {
    setError("");
    if (!slug) {
      onNotice("Publish your site first, then connect a domain.");
      return;
    }
    if (!canConnectDomain) {
      onNotice("Connecting a custom domain is a paid feature — upgrade to unlock it.");
      return;
    }
    if (!domain.trim()) {
      setError("Enter the domain you want to connect.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise connecting this domain.");
      return;
    }
    setConnecting(true);
    try {
      const result = await connectCustomDomainAction({
        business,
        slug,
        hostname: domain.trim().toLowerCase(),
        stepUp: true,
      });
      if (result.status === "denied") {
        setError(result.detail);
      } else {
        onNotice(result.detail);
      }
    } catch {
      setError("Could not connect the domain — please try again.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="panel deploy-step">
      <div className="section-heading">
        <div>
          <h2>
            <CloudUpload size={18} /> Your live site
          </h2>
          <p>
            Every time you publish, your site is saved and deployed automatically.
          </p>
        </div>
        {slug ? (
          <button
            className="ghost-button"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </button>
        ) : null}
      </div>

      {!slug ? (
        <p className="muted">Publish your site to deploy it and see its status here.</p>
      ) : (
        <>
          <div className="deploy-status">
            <span className={`deploy-pill deploy-${status ?? "none"}`}>
              {status === "live" ? (
                <CheckCircle2 size={14} />
              ) : status === "failed" ? (
                <XCircle size={14} />
              ) : (
                <Loader2 size={14} className="spin" />
              )}
              {status ? STATUS_LABEL[status] : "Not deployed yet"}
            </span>
            {status === "live" && url ? (
              <a href={url} target="_blank" rel="noreferrer" className="deploy-link">
                View your live site
              </a>
            ) : null}
          </div>

          {lastCommitSha ? (
            <p className="muted deploy-history">
              History: your latest change is saved (ref {lastCommitSha.slice(0, 7)}).
              Use version history below to undo to an earlier version.
            </p>
          ) : null}

          <div className="deploy-domain">
            <label className="field">
              <span>Connect a custom domain (optional)</span>
              <input
                type="text"
                value={domain}
                placeholder="yourbusiness.co.za"
                onChange={(e) => setDomain(e.target.value)}
              />
            </label>
            <label className="field field-inline domain-stepup">
              <input
                type="checkbox"
                checked={stepUp}
                onChange={(e) => setStepUp(e.target.checked)}
              />
              <span>I own this domain and authorise connecting it to my site.</span>
            </label>
            <button
              className="primary-button"
              type="button"
              onClick={connect}
              disabled={connecting}
            >
              {connecting ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Globe2 size={16} />
              )}
              {connecting ? "Connecting…" : "Connect domain"}
            </button>
          </div>

          {error ? <p className="wizard-error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
