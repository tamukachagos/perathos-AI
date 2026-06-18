"use client";

// W5 — Managed-hosting step (client, NON-TECHNICAL, CLIENT-SAFE per the W3 lesson).
//
// This component imports ONLY:
//   * React + icons,
//   * the server ACTIONS by reference (hostingCatalogAction / runHostingGatedAction
//     / hostingStatusAction / setHostingKillSwitchAction) — calling a server
//     action from a client component is the supported boundary; the action's
//     server-only imports (the registry/action plane, node:crypto tier backends,
//     the hosting services) stay on the server and never enter the client bundle.
// It NEVER imports core/registry, the tier router, the catalog, the manifest, or
// the provisioning service — so no server-only module (and no UnhandledSchemeError)
// can leak into the client build.
//
// UX (the owner NEVER sees vCPUs/YAML/manifests): static hosting is the FREE
// default; managed hosting is the paid upgrade. The owner answers two plain
// questions — "Where are your customers?" (region) and "How big?" (named plan,
// with the ZAR price) — then "Set up hosting" (approval) → a status pill
// (Setting up / Running / Paused). A "Stop hosting" toggle is the kill switch.

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  PauseCircle,
  PlayCircle,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { Business } from "@/lib/types";
import type { HostingDeploymentStatus } from "@/lib/db/types";
import {
  hostingCatalogAction,
  hostingStatusAction,
  runHostingGatedAction,
  setHostingKillSwitchAction,
  type HostingCatalogResponse,
} from "@/app/hosting/actions";

interface Props {
  business: Business;
  authenticated: boolean;
  /** The slug of the most recently published site, or null when none yet. */
  slug: string | null;
  /** True when the tenant's plan includes managed hosting (W5 entitlement). */
  canHost: boolean;
  onNotice: (message: string) => void;
}

const STATUS_LABEL: Record<HostingDeploymentStatus, string> = {
  requested: "Requested",
  provisioning: "Setting up your hosting…",
  running: "Running",
  scaling: "Resizing…",
  suspended: "Paused",
  torn_down: "Stopped",
  failed: "Setup failed",
};

export function HostingStep({
  business,
  authenticated,
  slug,
  canHost,
  onNotice,
}: Props) {
  const [catalog, setCatalog] = useState<HostingCatalogResponse | null>(null);
  const [region, setRegion] = useState<string>("");
  const [planName, setPlanName] = useState<string>("");
  const [stepUp, setStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<HostingDeploymentStatus | null>(null);
  const [killSwitch, setKill] = useState(false);

  // Load the catalog (regions + named plans + ZAR prices) once authenticated.
  useEffect(() => {
    if (!authenticated || !canHost) return;
    let cancelled = false;
    void hostingCatalogAction()
      .then((res) => {
        if (cancelled) return;
        setCatalog(res);
        setRegion((r) => r || res.regions[0]?.value || "");
        setPlanName((p) => p || res.plans[0]?.name || "");
      })
      .catch(() => {
        /* non-fatal: the picker just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, canHost]);

  const refresh = useCallback(async () => {
    if (!authenticated || !slug) return;
    try {
      const res = await hostingStatusAction(slug);
      setStatus(res.status);
      setKill(res.killSwitch);
    } catch {
      /* non-fatal: leave the prior status */
    }
  }, [authenticated, slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a deploy is settling so the owner sees it flip to Running.
  useEffect(() => {
    if (status !== "provisioning" && status !== "scaling") return undefined;
    const timer = setTimeout(() => void refresh(), 2000);
    return () => clearTimeout(timer);
  }, [status, refresh]);

  async function provision() {
    setError("");
    if (!slug) {
      onNotice("Publish your site first, then add managed hosting.");
      return;
    }
    if (!canHost) {
      onNotice("Managed hosting is a paid upgrade — upgrade your plan to unlock it.");
      return;
    }
    if (!region || !planName) {
      setError("Choose where your customers are and how big you need.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise setting up hosting.");
      return;
    }
    setBusy(true);
    try {
      const result = await runHostingGatedAction({
        verb: "hosting.provision",
        business,
        slug,
        region,
        planName,
        stepUp: true,
      });
      if (result.status === "denied") {
        setError(result.detail);
      } else {
        onNotice(result.detail);
        setStatus("provisioning");
      }
    } catch {
      setError("Could not set up hosting — please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleKill() {
    if (!slug) return;
    setBusy(true);
    try {
      const result = await setHostingKillSwitchAction(slug, !killSwitch);
      if (result.status === "ok") {
        setKill(result.on);
        onNotice(result.detail);
        void refresh();
      }
    } catch {
      setError("Could not update hosting — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const selectedPrice = catalog?.plans.find((p) => p.name === planName)?.priceZar;

  return (
    <section className="panel hosting-step">
      <div className="section-heading">
        <div>
          <h2>
            <Server size={18} /> Hosting
          </h2>
          <p>
            Your site is hosted free on our fast static tier. Need an always-on app
            with more power? Add managed hosting in the region closest to your
            customers.
          </p>
        </div>
      </div>

      {!canHost ? (
        <p className="muted">
          Managed hosting is part of the Pro plan. Your site stays live free on the
          static tier in the meantime.
        </p>
      ) : !slug ? (
        <p className="muted">Publish your site first, then add managed hosting here.</p>
      ) : status && status !== "torn_down" ? (
        <>
          <div className="deploy-status">
            <span className={`deploy-pill deploy-${status === "running" ? "live" : status === "failed" ? "failed" : "queued"}`}>
              {status === "running" ? (
                <CheckCircle2 size={14} />
              ) : status === "failed" ? (
                <XCircle size={14} />
              ) : (
                <Loader2 size={14} className="spin" />
              )}
              {STATUS_LABEL[status]}
            </span>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={toggleKill}
            disabled={busy}
          >
            {killSwitch ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
            {killSwitch ? "Resume hosting" : "Stop hosting (pause billing)"}
          </button>
          {error ? <p className="wizard-error">{error}</p> : null}
        </>
      ) : (
        <>
          <div className="hosting-picker">
            <label className="field">
              <span>Where are your customers?</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                {catalog?.regions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>How big?</span>
              <select value={planName} onChange={(e) => setPlanName(e.target.value)}>
                {catalog?.plans.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label} — {p.priceZar}/mo
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedPrice ? (
            <p className="muted">
              {catalog?.plans.find((p) => p.name === planName)?.blurb} You will
              pay {selectedPrice}/month, billed from your credits.
            </p>
          ) : null}

          <label className="field field-inline domain-stepup">
            <input
              type="checkbox"
              checked={stepUp}
              onChange={(e) => setStepUp(e.target.checked)}
            />
            <span>I authorise setting up managed hosting and the monthly charge.</span>
          </label>

          <button
            className="primary-button"
            type="button"
            onClick={provision}
            disabled={busy}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
            {busy ? "Setting up…" : "Set up hosting"}
          </button>

          {error ? <p className="wizard-error">{error}</p> : null}
        </>
      )}
    </section>
  );
}
