"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Play, Sparkles } from "lucide-react";
import type { Business, PublishedSites } from "@/lib/types";
import { evaluateAdapters, readinessScore } from "@/integrations/core/registry";
import { buildPublishedSite } from "@/lib/siteEngine";
import { slugify } from "@/lib/format";
import {
  readPublishedSites,
  readStoredDraft,
  siteUrl,
  writePublishedSites,
  writeStoredDraft,
} from "@/lib/clientStore";
import { initialBusiness } from "@/lib/platformData";
import { Sidebar } from "./Sidebar";
import { BusinessProfile } from "./BusinessProfile";
import { SitePreview } from "./SitePreview";
import { LaunchChecklist } from "./LaunchChecklist";
import { AgentOps, AnalyticsPanel, ArchitecturePanel } from "./LowerPanels";

export function Dashboard() {
  const router = useRouter();

  // Start from a stable server-safe default, then hydrate from localStorage on
  // mount. This avoids a server/client hydration mismatch.
  const [business, setBusiness] = useState<Business>(initialBusiness);
  const [publishedSites, setPublishedSites] = useState<PublishedSites>({});
  const [hydrated, setHydrated] = useState(false);
  const [activeStep, setActiveStep] = useState("profile");
  const [agentRuns, setAgentRuns] = useState(3);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setBusiness(readStoredDraft());
    setPublishedSites(readPublishedSites());
    setHydrated(true);
  }, []);

  const adapters = useMemo(() => evaluateAdapters(business), [business]);
  const publishProgress = useMemo(() => readinessScore(business), [business]);

  // "Published" is derived from saved sites, so it survives refresh instead of
  // being a transient flag that resets to a lower readiness on reload.
  const ownSlug = slugify(business.name);
  const published = Boolean(publishedSites[ownSlug]);

  const latestSite = useMemo(() => {
    const sites = Object.values(publishedSites);
    return (
      sites
        .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
        .at(-1) || null
    );
  }, [publishedSites]);

  useEffect(() => {
    if (hydrated) writeStoredDraft(business);
  }, [business, hydrated]);

  useEffect(() => {
    if (hydrated) writePublishedSites(publishedSites);
  }, [publishedSites, hydrated]);

  // Clear transient confirmations so they re-announce each time.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function updateBusiness(field: keyof Business, value: string) {
    setBusiness((current) => ({ ...current, [field]: value }));
  }

  function runAgentUpdate() {
    setAgentRuns((current) => current + 1);
    setBusiness((current) => ({
      ...current,
      offer: current.offer.includes("same-week")
        ? current.offer
        : `${current.offer} Now with same-week booking and WhatsApp confirmations.`,
    }));
    setNotice("AI update drafted — review it in the preview before publishing.");
  }

  function publishDraft() {
    const site = buildPublishedSite(business, publishedSites);
    setPublishedSites((current) => ({ ...current, [site.slug]: site }));
    setNotice(`Published to /s/${site.slug}`);
    router.push(`/s/${site.slug}`);
  }

  async function copySiteUrl(slug: string) {
    const url = siteUrl(slug);
    try {
      await navigator.clipboard?.writeText(url);
      setNotice("Site link copied to clipboard.");
    } catch {
      setNotice(`Copy failed — here is your link: ${url}`);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Launch Desk</h1>
            <p>
              One guided flow to put a South African business online and keep it
              updated.
            </p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={runAgentUpdate}>
              <Sparkles size={16} />
              AI update
            </button>
            {latestSite ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => copySiteUrl(latestSite.slug)}
              >
                <Copy size={16} />
                Copy site link
              </button>
            ) : null}
            <button className="primary-button" type="button" onClick={publishDraft}>
              <Play size={16} fill="currentColor" />
              {published ? "Publish update" : "Publish draft"}
            </button>
          </div>
        </header>

        <p className="sr-status" role="status" aria-live="polite">
          {notice}
        </p>

        <section
          className="readiness-band"
          aria-label="Launch readiness"
          role="progressbar"
          aria-valuenow={publishProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div>
            <span>Readiness</span>
            <strong>{publishProgress}%</strong>
          </div>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${publishProgress}%` }} />
          </div>
          <p>
            {published
              ? "Your site is live. Automated systems are ready; approval-gated steps are waiting on your sign-off."
              : "Fill in the profile and connect WhatsApp to raise readiness; domain, email, and payments need your approval before automation proceeds."}
          </p>
        </section>

        <section className="launch-grid">
          <BusinessProfile business={business} updateBusiness={updateBusiness} />
          <SitePreview business={business} latestSite={latestSite} />
          <LaunchChecklist
            activeStep={activeStep}
            adapters={adapters}
            published={published}
            setActiveStep={setActiveStep}
          />
        </section>

        <section className="lower-grid">
          <AnalyticsPanel />
          <AgentOps agentRuns={agentRuns} />
          <ArchitecturePanel />
        </section>
      </main>
    </div>
  );
}
