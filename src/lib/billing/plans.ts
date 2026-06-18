// M6 — Plan catalog + entitlements.
//
// Pure, runtime-dependency-free (no DB, no secrets, no UI). This is the single
// source of truth for what each subscription tier unlocks, so both the server
// enforcement (requireEntitlement) and the client UI gating resolve identical
// answers. SA-anchored tiers priced in ZAR.
//
// Default tenant = Free. A tenant with no subscription row, or a subscription
// that is not "active"/"trialing", resolves to the Free entitlements.

/** The subscription tiers, cheapest first. The order is the display order. */
export type PlanId = "free" | "growth" | "pro";

export const PLAN_IDS: readonly PlanId[] = ["free", "growth", "pro"] as const;

/** The capability flags a plan unlocks. Booleans gate features; numbers cap. */
export interface Entitlements {
  /** Max number of published sites the tenant may own. */
  maxSites: number;
  /** Connect a custom .co.za domain (vs. the branded Launch Desk subdomain). */
  customDomain: boolean;
  /** Remove the "Powered by Launch Desk" badge from published sites. */
  removeBranding: boolean;
  /** Configure payment links / collect payments. */
  payments: boolean;
  /** Priority support + advanced (multi-site management, etc.). */
  prioritySupport: boolean;
  /**
   * W7 — the autonomous customer agent team (Conductor + roles). Gates the three
   * agent-only ActionRouter verbs (github.mergePR / agent.deployFix /
   * agent.applyContent) AND the owner-facing agent panel. Pro/Managed only; the
   * work is metered against the wallet so it is naturally budget-bounded.
   */
  agentTeam: boolean;
  /**
   * W5 — managed (container/K8s) hosting. Gates the three hosting-control-plane
   * verbs (hosting.provision / hosting.scale / hosting.teardown) AND the owner's
   * hosting picker. Pro/Managed only; usage is metered against the wallet at the
   * hosting markup, so it is naturally budget-bounded and cost-safe.
   */
  managedHosting: boolean;
}

/** A tier in the pricing catalog. Amounts are in ZAR cents (0 = free). */
export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in ZAR cents. 0 for Free. */
  priceCents: number;
  currency: "ZAR";
  /** One-line value proposition for the pricing page. */
  tagline: string;
  /** Human-readable feature bullets for the pricing page. */
  highlights: string[];
  entitlements: Entitlements;
}

/**
 * The catalog. The `entitlements` here are the authoritative map: nothing else
 * in the app hardcodes a per-plan capability — they call entitlementsFor().
 */
export const PLAN_CATALOG: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    currency: "ZAR",
    tagline: "Get online today on a Launch Desk subdomain.",
    highlights: [
      "1 published site",
      "Branded launchdesk.co.za subdomain",
      '"Powered by Launch Desk" badge',
      "WhatsApp click-to-chat + POPIA lead form",
    ],
    entitlements: {
      maxSites: 1,
      customDomain: false,
      removeBranding: false,
      payments: false,
      prioritySupport: false,
      agentTeam: false,
      managedHosting: false,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceCents: 14900, // R149 / month
    currency: "ZAR",
    tagline: "Your own .co.za domain, your brand, and payments.",
    highlights: [
      "1 published site",
      "Custom .co.za domain",
      "Branding removed",
      "Payment links (Paystack / Yoco / PayFast)",
    ],
    entitlements: {
      maxSites: 1,
      customDomain: true,
      removeBranding: true,
      payments: true,
      prioritySupport: false,
      agentTeam: false,
      managedHosting: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 34900, // R349 / month
    currency: "ZAR",
    tagline: "Multiple sites, priority support, and advanced tools.",
    highlights: [
      "Up to 10 published sites",
      "Everything in Growth",
      "Priority support",
      "Your always-on AI team (fixes, updates, security)",
    ],
    entitlements: {
      maxSites: 10,
      customDomain: true,
      removeBranding: true,
      payments: true,
      prioritySupport: true,
      agentTeam: true,
      managedHosting: true,
    },
  },
};

/** The default tier for any tenant without an active paid subscription. */
export const DEFAULT_PLAN: PlanId = "free";

/** All plans as an ordered array (for rendering the pricing page). */
export function allPlans(): Plan[] {
  return PLAN_IDS.map((id) => PLAN_CATALOG[id]);
}

/** True if `value` is a known plan id. */
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** Look up a plan by id, falling back to the default (Free) for unknowns. */
export function planFor(plan: PlanId | string | null | undefined): Plan {
  return isPlanId(plan) ? PLAN_CATALOG[plan] : PLAN_CATALOG[DEFAULT_PLAN];
}

/**
 * The pure entitlements resolver. Given a plan id (or anything unknown/null),
 * returns the capability map. Unknown/null => Free entitlements. This is the
 * function both the server gate and the UI call so they never disagree.
 */
export function entitlementsFor(
  plan: PlanId | string | null | undefined,
): Entitlements {
  return planFor(plan).entitlements;
}

/** Format ZAR cents as a display string, e.g. 14900 -> "R149". */
export function formatZar(cents: number): string {
  if (cents === 0) return "R0";
  const rand = cents / 100;
  // Whole rands for round prices; keep two decimals otherwise.
  return Number.isInteger(rand) ? `R${rand}` : `R${rand.toFixed(2)}`;
}
