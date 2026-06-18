"use client";

// Launch Studio — the default workspace for non-technical business owners. A
// Claude-style two-pane shell: a dark left rail (brand, menu, plan + credits
// chip) and a main panel with an Assistant | Preview tab switcher. Selecting a
// left-menu item swaps the main panel to that "Your business" section, REUSING
// the existing dashboard panels verbatim (Profile, Domain, WhatsApp, Credits,
// Activity, Hosting, Settings) — no backend logic is reinvented.
//
// CLIENT-SAFE: imports only React + icons, the client-safe checklist/types/store/
// siteEngine, the existing panel components, and server ACTIONS by reference. It
// never imports core/registry, providers, metering, or crypto.
//
// State + persistence are lifted from the old Dashboard so anonymous (localStorage
// draft) and authenticated (server) modes both keep working exactly as before.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity as ActivityIcon,
  CheckCircle2,
  CreditCard,
  Globe2,
  LayoutGrid,
  LogIn,
  MessageCircle,
  PanelLeft,
  Server,
  Settings as SettingsIcon,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { Business, PublishedSites } from "@/lib/types";
import type { Entitlements } from "@/lib/billing/plans";
import type { AgentState } from "@/app/agent/actions";
import type { CreditsState } from "@/app/credits/actions";
import { buildPublishedSite } from "@/lib/siteEngine";
import { slugify } from "@/lib/format";
import {
  readPublishedSites,
  readStoredDraft,
  writePublishedSites,
  writeStoredDraft,
} from "@/lib/clientStore";
import { initialBusiness } from "@/lib/platformData";
import { publishSiteAction, saveBusinessAction } from "@/app/actions";

import { AssistantConsole } from "./AssistantConsole";
import { PreviewPane } from "./PreviewPane";
import { BusinessProfile } from "@/components/dashboard/BusinessProfile";
import { DomainStep } from "@/components/dashboard/DomainStep";
import { WhatsappCommerce } from "@/components/dashboard/WhatsappCommerce";
import { HostingStep } from "@/components/dashboard/HostingStep";
import { GbpStep } from "@/components/dashboard/GbpStep";
import { AgentTeamPanel } from "@/components/dashboard/AgentTeamPanel";
import { CreditsPanel } from "@/components/billing/CreditsPanel";
import { ApprovalDialog } from "@/components/dashboard/ApprovalDialog";

// Gated checklist keys → ActionRouter verb + the approval payload. Mirrors the
// old Dashboard map so the assistant's approval cards reuse the same flow.
interface GatedActionSpec {
  verb: string;
  label: string;
  payload: (business: Business) => Record<string, unknown>;
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

const FREE_ENTITLEMENTS: Entitlements = {
  maxSites: 1,
  customDomain: false,
  removeBranding: false,
  payments: false,
  prioritySupport: false,
  agentTeam: false,
  managedHosting: false,
};

type Tab = "assistant" | "preview";
type Section =
  | "workspace"
  | "profile"
  | "domain"
  | "whatsapp"
  | "gbp"
  | "credits"
  | "activity"
  | "hosting"
  | "settings";

interface SectionDef {
  key: Section;
  label: string;
  icon: typeof LayoutGrid;
  group: "main" | "business";
}

const SECTIONS: SectionDef[] = [
  { key: "workspace", label: "Assistant", icon: Sparkles, group: "main" },
  { key: "profile", label: "Profile", icon: CheckCircle2, group: "business" },
  { key: "domain", label: "Domain", icon: Globe2, group: "business" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, group: "business" },
  { key: "gbp", label: "Google", icon: LayoutGrid, group: "business" },
  { key: "credits", label: "Credits", icon: Wallet, group: "business" },
  { key: "activity", label: "Activity", icon: ActivityIcon, group: "business" },
  { key: "hosting", label: "Hosting", icon: Server, group: "business" },
  { key: "settings", label: "Settings", icon: SettingsIcon, group: "business" },
];

const SECTION_TITLE: Record<Section, string> = {
  workspace: "Assistant",
  profile: "Your profile",
  domain: "Your web address",
  whatsapp: "Sell on WhatsApp",
  gbp: "Get found on Google",
  credits: "Credits",
  activity: "Activity",
  hosting: "Hosting",
  settings: "Settings",
};

interface StudioShellProps {
  authenticated?: boolean;
  email?: string | null;
  initialBusiness?: Business | null;
  initialSites?: PublishedSites | null;
  planName?: string;
  entitlements?: Entitlements;
  creditsZar?: string | null;
  creditsUsagePercent?: number;
  /** Pre-loaded agent + credits state for the authenticated sections. */
  agentState?: AgentState | null;
  creditsState?: CreditsState | null;
}

export function StudioShell({
  authenticated = false,
  email = null,
  initialBusiness: serverBusiness = null,
  initialSites: serverSites = null,
  planName = "Free",
  entitlements = FREE_ENTITLEMENTS,
  creditsZar = null,
  creditsUsagePercent = 0,
  agentState = null,
  creditsState = null,
}: StudioShellProps) {
  const router = useRouter();

  const [business, setBusiness] = useState<Business>(serverBusiness ?? initialBusiness);
  const [publishedSites, setPublishedSites] = useState<PublishedSites>(serverSites ?? {});
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("assistant");
  const [section, setSection] = useState<Section>("workspace");
  const [notice, setNotice] = useState("");
  const [approval, setApproval] = useState<GatedActionSpec | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const migratedRef = useRef(false);

  // Hydrate: server is source of truth when authenticated; else localStorage.
  useEffect(() => {
    if (authenticated) {
      if (serverBusiness) setBusiness(serverBusiness);
      if (serverSites) setPublishedSites(serverSites);
      setHydrated(true);
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
    setBusiness(readStoredDraft());
    setPublishedSites(readPublishedSites());
    setHydrated(true);
  }, [authenticated, serverBusiness, serverSites, router]);

  // Persist drafts (server action when authenticated, localStorage otherwise).
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
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const ownSlug = slugify(business.name);
  const published = Boolean(publishedSites[ownSlug]);
  const latestSite = useMemo(() => {
    const sites = Object.values(publishedSites);
    return (
      sites.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).at(-1) || null
    );
  }, [publishedSites]);
  const currentSlug = published ? ownSlug : latestSite?.slug ?? null;
  const anyPublished = Object.keys(publishedSites).length > 0;

  function updateBusiness(field: keyof Business, value: string) {
    setBusiness((current) => ({ ...current, [field]: value }));
  }

  function applyGeneratedProfile(profile: Business) {
    setBusiness((current) => ({ ...current, ...profile }));
    setNotice("Draft applied — review it in Profile, then publish when ready.");
  }

  function openApproval(stepKey: string) {
    const spec = GATED_ACTION_BY_KEY[stepKey];
    if (!spec) return;
    if (!authenticated) {
      setNotice("Sign in to approve this action.");
      return;
    }
    if (spec.requires && !entitlements[spec.requires]) {
      setNotice(`${spec.label} is a paid feature — upgrade your plan to unlock it.`);
      return;
    }
    setApproval(spec);
  }

  async function publishDraft() {
    if (authenticated) {
      try {
        const { version } = await publishSiteAction(business);
        setNotice(`Your site is live (v${version}).`);
        setTab("preview");
        setSection("workspace");
        router.refresh();
        return;
      } catch {
        setNotice("Publish failed — please try again.");
        return;
      }
    }
    const site = buildPublishedSite(business, publishedSites);
    setPublishedSites((current) => ({ ...current, [site.slug]: site }));
    setNotice("Your site is live.");
    setTab("preview");
    setSection("workspace");
  }

  function pickSection(next: Section) {
    setSection(next);
    setRailOpen(false);
    // The Assistant section is the workspace; everything else hides the tabs.
    if (next === "workspace") setTab((t) => (t === "preview" ? "preview" : "assistant"));
  }

  const publishLabel = anyPublished ? "Update site" : "Publish site";
  const showTabs = section === "workspace";

  return (
    <div className={`studio-shell ${railOpen ? "rail-open" : ""}`}>
      {/* ---- Left rail ---- */}
      <aside className="studio-rail" aria-label="Launch Studio navigation">
        <div className="studio-brand">
          <div className="brand-mark">LD</div>
          <div>
            <strong>Launch Studio</strong>
            <span>Your AI business team</span>
          </div>
        </div>

        <nav className="studio-menu">
          <button
            type="button"
            className={section === "workspace" ? "studio-menu-item active" : "studio-menu-item"}
            onClick={() => pickSection("workspace")}
            aria-current={section === "workspace" ? "page" : undefined}
          >
            <Sparkles size={17} />
            <span>Assistant</span>
          </button>
          <button
            type="button"
            className={
              section === "workspace" && tab === "preview"
                ? "studio-menu-item active"
                : "studio-menu-item"
            }
            onClick={() => {
              pickSection("workspace");
              setTab("preview");
            }}
          >
            <LayoutGrid size={17} />
            <span>Preview</span>
          </button>

          <p className="studio-menu-group">Your business</p>
          {SECTIONS.filter((s) => s.group === "business").map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                className={section === s.key ? "studio-menu-item active" : "studio-menu-item"}
                onClick={() => pickSection(s.key)}
                aria-current={section === s.key ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Plan + credits chip */}
        <div className="studio-rail-foot">
          <Link
            className="studio-plan-chip"
            href={authenticated ? "/billing" : "/pricing"}
            aria-label={`Current plan: ${planName}`}
          >
            <CreditCard size={14} />
            <span>{planName} plan</span>
          </Link>
          {authenticated && creditsZar ? (
            <Link className="studio-credit-chip" href="/credits" title="Your prepaid credits">
              <Wallet size={14} />
              <span className="studio-credit-amount">{creditsZar}</span>
              <span className="studio-credit-bar" aria-hidden="true">
                <span style={{ width: `${creditsUsagePercent}%` }} />
              </span>
            </Link>
          ) : (
            <Link className="studio-credit-chip" href={authenticated ? "/credits" : "/sign-in"}>
              {authenticated ? (
                <>
                  <Wallet size={14} />
                  <span>Add credits</span>
                </>
              ) : (
                <>
                  <LogIn size={14} />
                  <span>Sign in</span>
                </>
              )}
            </Link>
          )}
          <p
            className="studio-build-stamp"
            title={`Build ${process.env.LD_BUILD_SHA ?? "dev"}${
              process.env.LD_BUILD_TIME ? ` · ${process.env.LD_BUILD_TIME}` : ""
            }`}
            style={{
              margin: "10px 0 0",
              fontSize: "10px",
              lineHeight: 1,
              textAlign: "center",
              color: "rgba(255,255,255,0.35)",
            }}
          >
            build {(process.env.LD_BUILD_SHA ?? "dev").slice(0, 7)}
          </p>
        </div>
      </aside>

      {/* ---- Main panel ---- */}
      <main className="studio-main">
        <header className="studio-header">
          <button
            type="button"
            className="studio-rail-toggle"
            onClick={() => setRailOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <PanelLeft size={18} />
          </button>

          {showTabs ? (
            <div className="studio-tabs" role="tablist" aria-label="Workspace view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "assistant"}
                className={tab === "assistant" ? "active" : ""}
                onClick={() => setTab("assistant")}
              >
                <Sparkles size={15} />
                Assistant
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "preview"}
                className={tab === "preview" ? "active" : ""}
                onClick={() => setTab("preview")}
              >
                <LayoutGrid size={15} />
                Preview
              </button>
            </div>
          ) : (
            <h1 className="studio-section-title">{SECTION_TITLE[section]}</h1>
          )}

          <div className="studio-header-right">
            {authenticated ? (
              <span className="studio-user" title="Signed in">
                {email ?? "Signed in"}
              </span>
            ) : (
              <Link className="ghost-button" href="/sign-in">
                <LogIn size={15} />
                Sign in
              </Link>
            )}
          </div>
        </header>

        <p className="sr-status" role="status" aria-live="polite">
          {notice}
        </p>

        <div className="studio-body">
          {section === "workspace" ? (
            tab === "assistant" ? (
              <AssistantConsole
                business={business}
                authenticated={authenticated}
                agentTeam={Boolean(entitlements.agentTeam)}
                onApplyProfile={applyGeneratedProfile}
                onApprove={openApproval}
                onOpenPreview={() => setTab("preview")}
                publishedSlug={currentSlug}
              />
            ) : (
              <PreviewPane
                slug={currentSlug}
                published={anyPublished}
                publishLabel={publishLabel}
                onPublish={publishDraft}
              />
            )
          ) : (
            <div className="studio-section">
              <SectionContent
                section={section}
                business={business}
                updateBusiness={updateBusiness}
                authenticated={authenticated}
                entitlements={entitlements}
                slug={currentSlug}
                planName={planName}
                agentState={agentState}
                creditsState={creditsState}
                onNotice={setNotice}
              />
            </div>
          )}
        </div>
      </main>

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

// Renders the active "Your business" section by reusing the existing panels.
function SectionContent({
  section,
  business,
  updateBusiness,
  authenticated,
  entitlements,
  slug,
  planName,
  agentState,
  creditsState,
  onNotice,
}: {
  section: Section;
  business: Business;
  updateBusiness: (field: keyof Business, value: string) => void;
  authenticated: boolean;
  entitlements: Entitlements;
  slug: string | null;
  planName: string;
  agentState: AgentState | null;
  creditsState: CreditsState | null;
  onNotice: (message: string) => void;
}) {
  switch (section) {
    case "profile":
      return <BusinessProfile business={business} updateBusiness={updateBusiness} />;
    case "domain":
      return (
        <DomainStep
          business={business}
          authenticated={authenticated}
          canRegister={Boolean(entitlements.customDomain)}
          onNotice={onNotice}
        />
      );
    case "whatsapp":
      return (
        <WhatsappCommerce
          business={business}
          authenticated={authenticated}
          canSell={Boolean(entitlements.payments)}
          onNotice={onNotice}
        />
      );
    case "gbp":
      return (
        <GbpStep
          business={business}
          authenticated={authenticated}
          canList={Boolean(entitlements.payments)}
          onNotice={onNotice}
        />
      );
    case "hosting":
      return (
        <HostingStep
          business={business}
          authenticated={authenticated}
          slug={slug}
          canHost={Boolean(entitlements.managedHosting)}
          onNotice={onNotice}
        />
      );
    case "credits":
      return creditsState ? (
        <CreditsPanel initialState={creditsState} />
      ) : (
        <SignInPrompt
          title="Credits"
          body="Sign in to see your prepaid balance and top up. You're never charged more than you've added."
        />
      );
    case "activity":
      return agentState ? (
        <AgentTeamPanel initialState={agentState} />
      ) : (
        <SignInPrompt
          title="Activity"
          body="Sign in to see what your team has done and what's waiting for your approval."
        />
      );
    case "settings":
      return <SettingsPanel planName={planName} authenticated={authenticated} />;
    default:
      return null;
  }
}

function SignInPrompt({ title, body }: { title: string; body: string }) {
  return (
    <section className="panel" style={{ padding: 22 }}>
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
      <Link className="primary-button" href="/sign-in">
        Sign in
      </Link>
    </section>
  );
}

function SettingsPanel({
  planName,
  authenticated,
}: {
  planName: string;
  authenticated: boolean;
}) {
  return (
    <section className="panel" style={{ padding: 22 }}>
      <div className="section-heading">
        <div>
          <h2>Settings</h2>
          <p>Your plan, billing, and account. Everything is hosted for you.</p>
        </div>
      </div>
      <div className="billing-plan-row">
        <div>
          <span className="billing-label">Current plan</span>
          <strong className="billing-plan-name">{planName}</strong>
        </div>
        <Link className="ghost-button" href="/pricing">
          Change plan
        </Link>
      </div>
      <div className="billing-actions">
        <Link className="ghost-button" href={authenticated ? "/billing" : "/sign-in"}>
          Billing &amp; plan
        </Link>
        <Link className="ghost-button" href="/credits">
          Credits
        </Link>
        <Link className="ghost-button" href="/privacy">
          Privacy
        </Link>
      </div>
    </section>
  );
}
