// W5 — HostingTierRouter (ENTERPRISE_REVIEW §5.2). SERVER-ONLY.
//
// Keeps the single HostingProvider interface; selects ONE HostingTierBackend per
// TIER. The tier is NEVER free-form — it comes from the vetted catalog plan
// (resolvePlacement → plan.tier), so an attacker cannot pick a backend directly.
//
//   static     → Vercel (W6 StaticTier — the free, plan-included default)
//   container  → Fly.io / Railway / Hetzner + thin orchestrator
//   kubernetes → operator-owned clusters, namespace-per-tenant
//
// W5 ships MOCK backends (no keys, no network). The real backends are dormant:
// when the cloud-credential envs are set a later milestone swaps the mock for a
// live adapter behind the SAME HostingTierBackend interface, with the SSRF
// outbound-allowlist (hostingOutboundAllowlist + isOutboundHostAllowed) enforced
// before any outbound provisioning/control-plane call. Cloud creds are operator
// secrets, read ONLY here in the server action plane, never logged.

import { isOutboundHostAllowed } from "@/integrations/domain/hostname";
import type { HostingTier } from "../catalog";
import { isVercelConfigured } from "../service";
import {
  mockContainerBackend,
  mockKubernetesBackend,
  mockStaticBackend,
} from "./mockBackends";
import { vercelStaticBackend } from "./vercelStaticBackend";
import { railwayContainerBackend } from "./railwayBackend";
import type { HostingTierBackend } from "./types";

export type { HostingTierBackend, TierOpResult } from "./types";

/** Whether any real container/K8s backend is configured (else the mock). */
export function isManagedHostingConfigured(): boolean {
  return Boolean(
    process.env.FLY_API_TOKEN ||
      process.env.RAILWAY_API_TOKEN ||
      process.env.HETZNER_API_TOKEN ||
      process.env.K8S_OPERATOR_KUBECONFIG,
  );
}

/**
 * Select the tier backend for a (vetted) tier. Live adapters are activated by
 * their respective env vars; fall back to the deterministic mock when unset.
 *   static     → Vercel (live when VERCEL_TOKEN set, else mock)
 *   container  → Railway (live when RAILWAY_API_TOKEN set, else mock)
 *   kubernetes → operator cluster (always mock until K8S_OPERATOR_KUBECONFIG)
 */
export function selectTierBackend(tier: HostingTier): HostingTierBackend {
  switch (tier) {
    case "static":
      return isVercelConfigured() ? vercelStaticBackend : mockStaticBackend;
    case "container":
      return process.env.RAILWAY_API_TOKEN ? railwayContainerBackend : mockContainerBackend;
    case "kubernetes":
      return mockKubernetesBackend;
  }
}

/**
 * The SSRF outbound allowlist for hosting control-plane calls (Part 3.A). The
 * (dormant) live tier adapters MUST pass each destination host through
 * `isOutboundHostAllowed(host, hostingOutboundAllowlist())` before any outbound
 * call — this blocks RFC1918 / link-local / 169.254.169.254 (cloud metadata) +
 * IPv6 equivalents, and only permits hosts on (or subdomains of) the configured
 * allowlist. The default allowlist is EMPTY (mock mode does no outbound), so a
 * live adapter MUST add its cloud API host(s) explicitly via env.
 */
export function hostingOutboundAllowlist(): string[] {
  const raw = process.env.HOSTING_OUTBOUND_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Guard a destination host for an outbound hosting control-plane call. Returns
 * true ONLY when the host passes the SSRF allowlist. Re-exported so a live
 * adapter (and the SSRF unit test) has one chokepoint. In mock mode no outbound
 * call is made, but this guard is what a live adapter calls first.
 */
export function isHostingOutboundAllowed(host: string | null | undefined): boolean {
  return isOutboundHostAllowed(host, hostingOutboundAllowlist());
}
