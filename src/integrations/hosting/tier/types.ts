// W5 — HostingTier backend contract (ENTERPRISE_REVIEW §5.2).
//
// Mirrors the W4 RegistrarBackend pattern: the single HostingProvider adapter
// stays the public face; behind it a HostingTierRouter selects ONE backend per
// TIER, chosen from the owner's plain-language plan (the catalog maps a plan to
// its tier):
//   * static     → Vercel (W6 StaticTier — the free, plan-included default)
//   * container  → Fly.io / Railway / Hetzner + a thin orchestrator (the workhorse)
//   * kubernetes → namespace-per-tenant on operator-owned clusters (us/eu/asia)
//
// A backend is SERVER-ONLY: a live one holds cloud creds + does outbound HTTP
// (guarded by the SSRF outbound allowlist). In W5 every tier resolves to a MOCK
// backend — deterministic, no network, no keys — and the real ones are dormant
// behind documented env vars. The mock orchestrator "applies" the rendered
// manifest and returns a backend ref; async settlement (provisioning → running)
// is driven by the provisioning queue + reconcile, exactly like every W1 op.

import type { HostingTier } from "../catalog";
import type { RenderedManifest } from "../manifest";

/** The result of a tier-backend provisioning/scale/teardown call. */
export interface TierOpResult {
  ok: boolean;
  detail: string;
  /** Backend-side reference (Fly app id / K8s namespace uid) when started. */
  backendRef?: string;
}

export interface TierProvisionInput {
  tenantId: string;
  slug: string;
  manifest: RenderedManifest;
}

export interface TierScaleInput {
  tenantId: string;
  slug: string;
  backendRef: string | null;
  /** The new (already-clamped) replica count. */
  replicas: number;
}

export interface TierTeardownInput {
  tenantId: string;
  slug: string;
  backendRef: string | null;
}

/**
 * A hosting-tier backend. All methods are async (live backends do I/O). Mock
 * backends resolve deterministically with no network so the whole flow runs with
 * no keys.
 */
export interface HostingTierBackend {
  readonly tier: HostingTier;
  /** Human label for audit/UI (e.g. "ContainerTier (mock)"). */
  readonly label: string;
  /** Apply the rendered manifest to provision the workload. */
  provision(input: TierProvisionInput): Promise<TierOpResult>;
  /** Scale a running workload to a new replica count (within the plan ceiling). */
  scale(input: TierScaleInput): Promise<TierOpResult>;
  /** Tear down a workload (stops the meter). */
  teardown(input: TierTeardownInput): Promise<TierOpResult>;
}
