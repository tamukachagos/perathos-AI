"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreditCard, Copy, History, LogIn, Play, Sparkles, Wallet, Wand2 } from "lucide-react";
import type { Business, PublishedSites } from "@/lib/types";
import type { Entitlements } from "@/lib/billing/plans";
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
import type { SiteVersionRecord } from "@/lib/db/types";
import {
  listSiteVersionsAction,
  publishSiteAction,
  rollbackSiteAction,
  saveBusinessAction,
} from "@/app/actions";
import { Sidebar } from "./Sidebar";
import { BusinessProfile } from "./BusinessProfile";
import { SitePreview } from "./SitePreview";
import { LaunchChecklist } from "./LaunchChecklist";
import { AgentOps, AnalyticsPanel, ArchitecturePanel } from "./LowerPanels";
import { OnboardingWizard } from "./OnboardingWizard";
import { ApprovalDialog } from "./ApprovalDialog";

// Maps a gated checklist row to the ActionRouter verb + the payload the approval
// binds to. Only authenticated sessions can approve (the flow needs a tenant).
interface GatedActionSpec {
  verb: string;
  label: string;
  payload: (business: Business) => Record<string, unknown>;
  /** Paid-plan capability this action needs (M6); matches the server gate. */
  requires?: keyof Entitlements;
}
const GATED_ACTION_BY_KEY: Record<string, GatedActionSpec> = {
  domain: {
    verb: "domain.register",
    label: "Register domain",
    payload: (b) => ({ domain: b.domain }),
    requires: "customDomain",
  },
  payments: {
    verb: "payment.configure",
    label: "Configure payments",
    payload: (b) => ({ account: b.email || b.name }),
    requires: "payments",
  },
  email: {
    verb: "email.provision",
    label: "Provision mailboxes",
    payload: (b) => ({ domain: b.domain, email: b.email }),
  },
};

interface DashboardProps {
  authenticated?: boolean;
  email?: string | null;
  // When authenticated, the server passes the persisted profile + sites. When
  // anonymous, these are null and the dashboard uses the localStorage draft UX.
  initialBusiness?: Business | null;
  initialSites?: PublishedSites | null;
  /** Current plan display name + entitlements (M6); default Free. */
  planName?: string;
  entitlements?: Entitlements;
  /** W2 — wallet balance in Rand display (e.g. "R10.00"); null when anonymous. */
  creditsZar?: string | null;
  /** W2 — this month's usage as a % of the soft allowance (0–100). */
  creditsUsagePercent?: number;
}

const FREE_ENTITLEMENTS: Entitlements = {
  maxSites: 1,
  customDomain: false,
  removeBranding: false,
  payments: false,
  prioritySupport: false,
};

export function Dashboard({
  authenticated = false,
  email = null,
  initialBusiness: serverBusiness = null,
  initialSites: serverSites = null,
  planName = "Free",
  entitlements = FREE_ENTITLEMENTS,
  creditsZar = null,
  creditsUsagePercent = 0,
}: DashboardProps) {
  const router = useRouter();

  // Start from a stable server-safe default, then hydrate. When authenticated we
  // hydrate from the server-provided records; otherwise from localStorage.
  const [business, setBusiness] = useState<Business>(
    serverBusiness ?? initialBusiness,
  );
  const [publishedSites, setPublishedSites] = useState<PublishedSites>(
    serverSites ?? {},
  );
  const [hydrated, setHydrated] = useState(false);
  const [activeStep, setActiveStep] = useState("profile");
  const [agentRuns, setAgentRuns] = useState(3);
  const [notice, setNotice] = useState("");
  const [versions, setVersions] = useState<SiteVersionRecord[] | null>(null);
  const [versionsSlug, setVersionsSlug] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [approval, setApproval] = useState<GatedActionSpec | null>(null);
  const migratedRef = useRef(false);

  useEffect(() => {
    if (authenticated) {
      // Server is the source of truth for an authenticated session.
      if (serverBusiness) setBusiness(serverBusiness);
      if (serverSites) setPublishedSites(serverSites);
      setHydrated(true);

      // On first authenticated mount, migrate any local draft into the account
      // (the API only adopts it if the tenant has no business yet).
      if (!migratedRef.current && !serverBusiness) {
        migratedRef.current = true;
        const draft = readStoredDraft();
        fetch("/api/draft/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft }),
        })
          .then(() => router.refresh())
          .catch(() => undefined);
      }
      return;
    }

    // Anonymous: the M0 localStorage UX.
    setBusiness(readStoredDraft());
    setPublishedSites(readPublishedSites());
    setHydrated(true);
  }, [authenticated, serverBusiness, serverSites, router]);

  const adapters = useMemo(() => evaluateAdapters(business), [business]);
  const publishProgress = useMemo(() => readinessScore(business), [business]);

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

  // Persist drafts: localStorage for anonymous; server action for authenticated.
  useEffect(() => {
    if (!hydrated) return;
    if (authenticated) {
      void saveBusinessAction(business).catch(() => undefined);
    } else {
      writeStoredDraft(business);
    }
  }, [business, hydrated, authenticated]);

  useEffect(() => {
    if (hydrated && !authenticated) writePublishedSites(publishedSites);
  }, [publishedSites, hydrated, authenticated]);

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

  function applyGeneratedProfile(profile: Business) {
    setBusiness((current) => ({ ...current, ...profile }));
    setWizardOpen(false);
    setActiveStep("profile");
    setNotice("Draft profile applied — review it, then publish when ready.");
  }

  function openApproval(stepKey: string) {
    const spec = GATED_ACTION_BY_KEY[stepKey];
    if (!spec) return;
    if (!authenticated) {
      setNotice("Sign in to approve this action.");
      return;
    }
    // UI gate mirrors the server: a paid-plan action is blocked for a free
    // tenant here too, so the affordance leads to upgrade rather than a 403.
    if (spec.requires && !entitlements[spec.requires]) {
      setNotice(
        `${spec.label} is a paid feature — upgrade your plan to unlock it.`,
      );
      return;
    }
    setApproval(spec);
  }

  async function publishDraft() {
    if (authenticated) {
      try {
        const { slug, version } = await publishSiteAction(business);
        setNotice(`Published /s/${slug} (v${version})`);
        if (versionsSlug === slug) await loadVersions(slug);
        router.push(`/s/${slug}`);
        return;
      } catch {
        setNotice("Publish failed — please try again.");
        return;
      }
    }

    const site = buildPublishedSite(business, publishedSites);
    setPublishedSites((current) => ({ ...current, [site.slug]: site }));
    setNotice(`Published to /s/${site.slug}`);
    router.push(`/s/${site.slug}`);
  }

  async function loadVersions(slug: string) {
    if (!authenticated) {
      setNotice("Sign in to view a site's version history.");
      return;
    }
    try {
      const list = await listSiteVersionsAction(slug);
      setVersions(list);
      setVersionsSlug(slug);
    } catch {
      setNotice("Could not load version history.");
    }
  }

  async function rollback(slug: string, version: number) {
    try {
      const { version: newVersion } = await rollbackSiteAction(slug, version);
      setNotice(`Rolled back ${slug} to v${version} (now v${newVersion}).`);
      await loadVersions(slug);
      router.refresh();
    } catch {
      setNotice("Rollback failed — please try again.");
    }
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
            <Link
              className="plan-chip"
              href={authenticated ? "/billing" : "/pricing"}
              aria-label={`Current plan: ${planName}`}
            >
              <CreditCard size={14} />
              {planName} plan
            </Link>
            {authenticated && creditsZar ? (
              <Link
                className="credits-chip"
                href="/credits"
                aria-label={`Credit balance ${creditsZar}, ${creditsUsagePercent}% of this month's usage`}
                title="Your prepaid credit balance"
              >
                <Wallet size={14} />
                <span className="credits-chip-amount">{creditsZar}</span>
                <span className="credits-chip-bar" aria-hidden="true">
                  <span style={{ width: `${creditsUsagePercent}%` }} />
                </span>
              </Link>
            ) : null}
            <Link className="ghost-button" href="/pricing">
              Upgrade
            </Link>
            {authenticated ? (
              <span className="ghost-button" aria-label="Signed in">
                {email ?? "Signed in"}
              </span>
            ) : (
              <Link className="ghost-button" href="/sign-in">
                <LogIn size={16} />
                Sign in
              </Link>
            )}
            <button
              className="ghost-button"
              type="button"
              onClick={() => setWizardOpen(true)}
            >
              <Wand2 size={16} />
              Describe your business
            </button>
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
            {authenticated && latestSite ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => loadVersions(latestSite.slug)}
              >
                <History size={16} />
                Versions
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
            gatedKeys={Object.keys(GATED_ACTION_BY_KEY)}
            onApprove={openApproval}
          />
        </section>

        <section className="lower-grid">
          <AnalyticsPanel />
          <AgentOps agentRuns={agentRuns} />
          <ArchitecturePanel />
        </section>

        {versions && versionsSlug ? (
          <section
            className="version-panel"
            aria-label={`Version history for ${versionsSlug}`}
          >
            <header className="version-panel-head">
              <h2>Version history — /s/{versionsSlug}</h2>
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setVersions(null);
                  setVersionsSlug(null);
                }}
              >
                Close
              </button>
            </header>
            {versions.length === 0 ? (
              <p>No versions yet — publish the site to create one.</p>
            ) : (
              <ul className="version-list">
                {versions.map((v) => (
                  <li key={v.id}>
                    <span>
                      <strong>v{v.version}</strong>
                      {v.isCurrent ? " · current" : ""}
                    </span>
                    <span className="version-when">
                      {new Date(v.createdAt).toLocaleString("en-ZA")}
                    </span>
                    {!v.isCurrent ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => rollback(versionsSlug, v.version)}
                      >
                        Roll back to v{v.version}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>

      {wizardOpen ? (
        <OnboardingWizard
          onApply={applyGeneratedProfile}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}

      {approval ? (
        <ApprovalDialog
          verb={approval.verb}
          label={approval.label}
          business={business}
          payload={approval.payload(business)}
          onClose={() => setApproval(null)}
          onResult={(message) => setNotice(message)}
        />
      ) : null}
    </div>
  );
}
