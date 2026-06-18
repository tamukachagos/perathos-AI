// W5 — Per-tenant isolation manifest renderer (ENTERPRISE_REVIEW Part 3.A).
// SERVER-SAFE but dependency-free (no node:*, no DB) so it is unit-testable.
//
// The platform RENDERS every deployment manifest from the vetted catalog — it
// NEVER accepts a raw manifest/YAML/Dockerfile/env from an owner (assertNoRawSpec
// guards that upstream). This module produces a structured, declarative manifest
// object that represents the MANDATORY isolation controls so the live adapter
// (Phase 3) just applies it:
//   * namespace-per-tenant (ld-<tenant>-<slug>)
//   * a scoped service account (no platform master creds)
//   * default-deny egress NetworkPolicy
//   * PodSecurity: restricted
//   * ResourceQuota + LimitRange derived from the plan (cost ceiling)
//
// In W5 the manifest is a deterministic object (mock). It is what the mock
// orchestrator "applies"; a live ContainerTier/KubernetesTier adapter renders it
// to real Fly/Railway/K8s API calls behind the SAME shape. No tenant secret is
// ever embedded; the egress allowlist is empty by default (default-deny).

import type { HostingPlan, HostingRegion, HostingTier } from "./catalog";

/** The rendered, vetted isolation manifest (mock representation). */
export interface RenderedManifest {
  /** namespace-per-tenant — the single most important isolation boundary. */
  namespace: string;
  /** A per-tenant scoped service account (NEVER the platform master account). */
  serviceAccount: string;
  tier: HostingTier;
  region: HostingRegion;
  /** ResourceQuota — the hard cap on what this namespace can ever consume. */
  resourceQuota: {
    cpuMilli: number;
    memMb: number;
    storageGb: number;
    /** Max pods = the plan's hard replica ceiling (cost-abuse guardrail). */
    maxPods: number;
  };
  /** LimitRange — per-pod default + ceiling so one pod can't grab the quota. */
  limitRange: {
    defaultCpuMilli: number;
    defaultMemMb: number;
    maxCpuMilli: number;
    maxMemMb: number;
  };
  /** PodSecurity standard. Always "restricted" (no privileged/host access). */
  podSecurity: "restricted";
  /**
   * Default-deny egress NetworkPolicy. `egressAllowlist` is the ONLY hosts the
   * workload may reach (empty by default = fully isolated). The platform master
   * cloud creds are NEVER in this list, and 169.254.169.254 / RFC1918 are never
   * reachable (the SSRF allowlist is enforced separately on outbound platform
   * calls; the workload's own egress is default-deny here).
   */
  networkPolicy: {
    defaultDenyEgress: true;
    egressAllowlist: string[];
  };
  replicas: number;
}

/**
 * Render the isolation manifest for a (tenant, slug) placement from the vetted
 * catalog plan. Pure + deterministic. `egressAllowlist` defaults to empty
 * (default-deny). The namespace + service account are derived from the tenant +
 * slug so they are unique and tenant-bound.
 */
export function renderManifest(params: {
  tenantId: string;
  slug: string;
  region: HostingRegion;
  plan: HostingPlan;
  replicas?: number;
  egressAllowlist?: string[];
}): RenderedManifest {
  const { tenantId, slug, region, plan } = params;
  // A DNS-safe, tenant-bound namespace. Lower-case, hyphenated, truncated.
  const safe = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 24);
  const namespace = `ld-${safe(tenantId)}-${safe(slug)}`.slice(0, 63);
  // Clamp the replica count to the plan's hard ceiling (never above maxReplicas).
  const replicas = Math.min(
    Math.max(1, params.replicas ?? plan.replicas),
    plan.maxReplicas,
  );
  return {
    namespace,
    serviceAccount: `${namespace}-sa`,
    tier: plan.tier,
    region,
    resourceQuota: {
      cpuMilli: plan.cpuMilli * plan.maxReplicas,
      memMb: plan.memMb * plan.maxReplicas,
      storageGb: plan.storageGb,
      maxPods: plan.maxReplicas,
    },
    limitRange: {
      defaultCpuMilli: plan.cpuMilli,
      defaultMemMb: plan.memMb,
      maxCpuMilli: plan.cpuMilli,
      maxMemMb: plan.memMb,
    },
    podSecurity: "restricted",
    networkPolicy: {
      defaultDenyEgress: true,
      egressAllowlist: params.egressAllowlist ?? [],
    },
    replicas,
  };
}
