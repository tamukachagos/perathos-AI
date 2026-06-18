// W5 — Hosting catalog + region/plan enum allowlist (ENTERPRISE_REVIEW §5.2 +
// Part 3.A). CONFIG, NOT CODE.
//
// This is the single source of truth for the NON-TECHNICAL picker. The owner only
// ever answers two plain-language questions:
//   * "Where are your customers?" → a REGION (us / eu / asia)
//   * "How big?"                  → a named PLAN (Starter / Business / Scale)
// They NEVER see vCPUs, YAML, replicas, or a manifest. The platform maps each
// (region, plan) to a fully-specified, VETTED HostingPlan here — tier, region
// pool, cpuMilli, memMb, replicas, storageGb, and the retail price — so the
// catalog and the markup are config, not code (env-overridable price/markup).
//
// SECURITY (Part 3.A — MANDATORY):
//   * SERVER-SIDE ENUM ALLOWLIST. region/plan/size are closed enums resolved
//     here. A free-form region/plan/size is REJECTED — never interpreted, never
//     passed to a backend. `resolvePlan` is the ONE chokepoint that turns the
//     owner's two answers into a vetted plan; anything off the allowlist returns
//     null and the caller must reject.
//   * NO RAW MANIFEST / YAML / Dockerfile / ENV FROM OWNERS. `assertNoRawSpec`
//     rejects any payload that smells like an owner-authored build artifact
//     (raw manifest, dockerfile, yaml, env, command, image) — owner-authored
//     build input = RCE on the build infra. Manifests are RENDERED from this
//     catalog only (see manifest.ts).
//   * COST-ABUSE GUARDRAILS. Each plan carries a hard `maxReplicas` ceiling so a
//     scale can never exceed the plan's quota (the kill-switch + per-tenant
//     ceiling live in the provisioning service).
//
// Pure: no DB, no secrets, no network, no node:* imports → importable by the
// ActionRouter, the server services, Vitest, AND (safely) any client pre-check.

import { hostingMarkup, MICRO_PER_CENT } from "@/lib/billing/meteringConfig";

// --- The closed enums (the server-side allowlist) ----------------------------

/** The plain-language regions the picker offers. Closed enum — never free-form. */
export const HOSTING_REGIONS = ["us", "eu", "asia"] as const;
export type HostingRegion = (typeof HOSTING_REGIONS)[number];

/** The named, plain-language plans the picker offers. Closed enum. */
export const HOSTING_PLAN_NAMES = ["starter", "business", "scale"] as const;
export type HostingPlanName = (typeof HOSTING_PLAN_NAMES)[number];

/** The deploy tiers a plan routes to (§5.2). 'static' is the free W6 default. */
export const HOSTING_TIERS = ["static", "container", "kubernetes"] as const;
export type HostingTier = (typeof HOSTING_TIERS)[number];

/** True if `value` is on the region allowlist (server-side guard). */
export function isHostingRegion(value: unknown): value is HostingRegion {
  return (
    typeof value === "string" &&
    (HOSTING_REGIONS as readonly string[]).includes(value)
  );
}

/** True if `value` is on the plan-name allowlist (server-side guard). */
export function isHostingPlanName(value: unknown): value is HostingPlanName {
  return (
    typeof value === "string" &&
    (HOSTING_PLAN_NAMES as readonly string[]).includes(value)
  );
}

// --- The vetted plan catalog -------------------------------------------------

/**
 * A fully-specified hosting plan. The owner never sees these numbers — they pick
 * a region + a named plan and the platform resolves to this. cpuMilli/memMb/etc.
 * are the rendered-manifest inputs (ResourceQuota/LimitRange); `maxReplicas` is
 * the hard scale ceiling (cost-abuse guardrail); `priceCents` is the monthly
 * RETAIL price in ZAR cents and `costCents` the operator wholesale cost.
 */
export interface HostingPlan {
  /** The plain-language plan name (the owner's "how big?" answer). */
  name: HostingPlanName;
  /** Human label for the picker, e.g. "Business". */
  label: string;
  /** One-line plain description (no jargon). */
  blurb: string;
  /** The deploy tier this plan routes to. */
  tier: HostingTier;
  /** The regions this plan can be placed in (all three for every paid plan). */
  regionPool: readonly HostingRegion[];
  /** CPU allocation in millicores (1000m = 1 vCPU). Rendered into the manifest. */
  cpuMilli: number;
  /** Memory allocation in MB. Rendered into the manifest. */
  memMb: number;
  /** Default replica count. */
  replicas: number;
  /** HARD scale ceiling — a hosting.scale can never exceed this (guardrail). */
  maxReplicas: number;
  /** Persistent storage in GB. Metered monthly. */
  storageGb: number;
  /** Monthly RETAIL price, ZAR cents (integer). */
  priceCents: number;
  /** Monthly operator wholesale cost, ZAR cents (integer). */
  costCents: number;
}

/** Env-cents helper (mirrors registrar/pricing.ts), defaulting to a Rand value. */
function envCents(name: string, fallbackRand: number): number {
  const raw = process.env[name]?.trim();
  const fallback = Math.round(fallbackRand * 100);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * The catalog. Built per-call so env price overrides apply without a deploy.
 * Static is the FREE, plan-included default (W6) — kept here so the picker can
 * present "Free static" as the baseline and the paid tiers as the upgrade.
 */
export function hostingCatalog(): Record<HostingPlanName, HostingPlan> {
  return {
    starter: {
      name: "starter",
      label: "Starter",
      blurb: "A small always-on app for a growing business.",
      tier: "container",
      regionPool: HOSTING_REGIONS,
      cpuMilli: 250,
      memMb: 256,
      replicas: 1,
      maxReplicas: 2,
      storageGb: 1,
      priceCents: envCents("LD_HOSTING_STARTER_PRICE_CENTS", 299),
      costCents: envCents("LD_HOSTING_STARTER_COST_CENTS", 180),
    },
    business: {
      name: "business",
      label: "Business",
      blurb: "More power and room to grow as you get busier.",
      tier: "container",
      regionPool: HOSTING_REGIONS,
      cpuMilli: 500,
      memMb: 512,
      replicas: 2,
      maxReplicas: 4,
      storageGb: 5,
      priceCents: envCents("LD_HOSTING_BUSINESS_PRICE_CENTS", 699),
      costCents: envCents("LD_HOSTING_BUSINESS_COST_CENTS", 430),
    },
    scale: {
      name: "scale",
      label: "Scale",
      blurb: "Regional, highly-available hosting for busy sites.",
      tier: "kubernetes",
      regionPool: HOSTING_REGIONS,
      cpuMilli: 1000,
      memMb: 1024,
      replicas: 3,
      maxReplicas: 8,
      storageGb: 20,
      priceCents: envCents("LD_HOSTING_SCALE_PRICE_CENTS", 1499),
      costCents: envCents("LD_HOSTING_SCALE_COST_CENTS", 950),
    },
  };
}

/**
 * Per-hour CPU + per-GB-month storage WHOLESALE unit costs (ZAR micro-cents),
 * derived from the plan's monthly cost so metering is config-driven. These are
 * the amounts the metering tick meters against the wallet (at the hosting
 * markup, applied by recordUsage's multiplierForKind for a "hosting.*" kind).
 */
export interface HostingUnitCosts {
  /** Wholesale cost of one CPU-hour at this plan's allocation (micro-cents). */
  cpuHourCostMicro: bigint;
  /** Wholesale cost of one GB-month of storage at this plan (micro-cents). */
  storageGbMonthCostMicro: bigint;
}

const HOURS_PER_MONTH = 730n; // ~average

export function unitCostsForPlan(plan: HostingPlan): HostingUnitCosts {
  // Split the monthly wholesale cost ~80% compute / ~20% storage, then per-unit.
  const costMicro = BigInt(plan.costCents) * MICRO_PER_CENT;
  const computeMicro = (costMicro * 80n) / 100n;
  const storageMicro = costMicro - computeMicro;
  const cpuHourCostMicro = computeMicro / HOURS_PER_MONTH;
  const storageGbMonthCostMicro =
    plan.storageGb > 0 ? storageMicro / BigInt(plan.storageGb) : storageMicro;
  return { cpuHourCostMicro, storageGbMonthCostMicro };
}

/**
 * The owner's monthly retail price for a plan, in ZAR micro-cents (for the
 * pre-flight credit estimate at the ActionRouter). This is what one month of the
 * plan would draw from the wallet at the hosting markup applied to cost — capped
 * at the catalog retail price so the estimate is a sane upper bound.
 */
export function planEstimateMicro(plan: HostingPlan): bigint {
  const retailMicro = BigInt(plan.priceCents) * MICRO_PER_CENT;
  // The metered cost over a month (cost × markup) should not exceed retail; use
  // the larger of the two as a conservative pre-flight estimate.
  const markedUpCostMicro =
    (BigInt(plan.costCents) * MICRO_PER_CENT * BigInt(Math.round(hostingMarkup() * 1000))) /
    1000n;
  return markedUpCostMicro > retailMicro ? markedUpCostMicro : retailMicro;
}

// --- The resolution chokepoint (server-side enum allowlist) ------------------

/** A resolved, vetted placement: the owner's two answers turned into a plan. */
export interface ResolvedPlacement {
  region: HostingRegion;
  plan: HostingPlan;
}

export type PlacementRejection =
  | "bad_region"
  | "bad_plan"
  | "region_not_in_pool"
  | "raw_spec_rejected";

/**
 * The ONE chokepoint that turns the owner's plain-language answers into a vetted
 * placement. Both inputs are validated against the closed enums; a free-form
 * region or plan is REJECTED (never interpreted). The region must also be in the
 * plan's pool. Returns the resolved placement or a stable rejection reason.
 */
export function resolvePlacement(
  region: unknown,
  planName: unknown,
):
  | { ok: true; placement: ResolvedPlacement }
  | { ok: false; reason: PlacementRejection } {
  if (!isHostingRegion(region)) return { ok: false, reason: "bad_region" };
  if (!isHostingPlanName(planName)) return { ok: false, reason: "bad_plan" };
  const plan = hostingCatalog()[planName];
  if (!plan.regionPool.includes(region)) {
    return { ok: false, reason: "region_not_in_pool" };
  }
  return { ok: true, placement: { region, plan } };
}

// --- No-raw-spec guard (Part 3.A: never accept owner build artifacts) --------

/**
 * Keys that, if present in a provisioning payload, indicate an attempt to smuggle
 * an owner-authored build artifact (raw manifest / Dockerfile / YAML / env /
 * command / image) into the control plane. Accepting ANY of these would let an
 * owner run arbitrary code on the build infra (RCE). The platform renders every
 * manifest from the vetted catalog, so NONE of these are ever a legitimate input.
 */
const FORBIDDEN_SPEC_KEYS = [
  "manifest",
  "yaml",
  "yml",
  "dockerfile",
  "containerfile",
  "image",
  "command",
  "cmd",
  "entrypoint",
  "args",
  "env",
  "envVars",
  "buildCommand",
  "script",
  "helm",
  "kustomize",
  "podSpec",
  "spec",
  "k8s",
  "kubeconfig",
] as const;

/**
 * Reject any payload carrying a raw build spec. Returns ok:false with the
 * offending key when one is present, so the caller can deny BEFORE any work.
 * Case-insensitive on keys. This is a server-side guard — the owner UI never
 * sends these, but a crafted request must still be refused.
 */
export function assertNoRawSpec(
  payload: Record<string, unknown> | undefined | null,
): { ok: true } | { ok: false; key: string } {
  if (!payload) return { ok: true };
  const lowerForbidden = new Set(FORBIDDEN_SPEC_KEYS.map((k) => k.toLowerCase()));
  for (const key of Object.keys(payload)) {
    if (lowerForbidden.has(key.toLowerCase())) {
      return { ok: false, key };
    }
  }
  return { ok: true };
}

/** Format a plan's retail price as ZAR (owner-facing — Rand only, no jargon). */
export function planPriceZar(plan: HostingPlan): string {
  return `R${(plan.priceCents / 100).toFixed(2)}`;
}

/** A plain-language label for a region (the picker shows these). */
export const REGION_LABEL: Record<HostingRegion, string> = {
  us: "North & South America",
  eu: "Europe, Middle East & Africa",
  asia: "Asia & Pacific",
};
