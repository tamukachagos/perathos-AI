// W5 — Mock hosting-tier backends (deterministic, no network, no keys).
//
// Three backends mirror the live split (§5.2): StaticTier (Vercel — the free
// W6 default), ContainerTier (Fly/Railway/Hetzner — the workhorse), and
// KubernetesTier (namespace-per-tenant on operator clusters). The MOCK
// implementations:
//   * provision — "apply" the rendered isolation manifest, returning a synthetic
//     backendRef. The async settlement (provisioning → running) is driven by the
//     provisioning queue's reconcile/webhook, exactly like every W1 async verb.
//   * scale/teardown — return ok with a synthetic ref; teardown stops the meter.
//
// SERVER-ONLY (the live versions hold cloud creds / do outbound HTTP — guarded by
// the SSRF outbound allowlist). The router never imports a live backend in W5;
// they are documented as dormant env-gated (see .env.example).

import { createHash } from "node:crypto";
import type {
  HostingTierBackend,
  TierOpResult,
  TierProvisionInput,
  TierScaleInput,
  TierTeardownInput,
} from "./types";

function synthRef(prefix: string, namespace: string): string {
  const h = createHash("sha256").update(namespace).digest("hex").slice(0, 10);
  return `${prefix}_${h}`;
}

/** StaticTier (Vercel) — the free, plan-included default (delegates to W6). */
export const mockStaticBackend: HostingTierBackend = {
  tier: "static",
  label: "StaticTier / Vercel (mock)",
  async provision(input: TierProvisionInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail: `[mock:static] "${input.slug}" served on the included static tier.`,
      backendRef: synthRef("static", input.manifest.namespace),
    };
  },
  async scale(): Promise<TierOpResult> {
    // Static is not scaled by replica — it is CDN-served. A scale is a no-op.
    return { ok: true, detail: "[mock:static] static hosting does not scale by replica." };
  },
  async teardown(input: TierTeardownInput): Promise<TierOpResult> {
    return { ok: true, detail: `[mock:static] "${input.slug}" static hosting released.` };
  },
};

/** ContainerTier (Fly/Railway/Hetzner) — the metered workhorse. */
export const mockContainerBackend: HostingTierBackend = {
  tier: "container",
  label: "ContainerTier / Fly·Railway·Hetzner (mock)",
  async provision(input: TierProvisionInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail:
        `[mock:container] provisioning "${input.slug}" in ${input.manifest.region} ` +
        `(ns ${input.manifest.namespace}, ${input.manifest.replicas}× ` +
        `${input.manifest.limitRange.defaultCpuMilli}m/${input.manifest.limitRange.defaultMemMb}MB).`,
      backendRef: synthRef("fly", input.manifest.namespace),
    };
  },
  async scale(input: TierScaleInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail: `[mock:container] "${input.slug}" scaled to ${input.replicas} replica(s).`,
      backendRef: input.backendRef ?? undefined,
    };
  },
  async teardown(input: TierTeardownInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail: `[mock:container] "${input.slug}" torn down — meter stopped.`,
    };
  },
};

/** KubernetesTier (operator-owned clusters, namespace-per-tenant). */
export const mockKubernetesBackend: HostingTierBackend = {
  tier: "kubernetes",
  label: "KubernetesTier / operator clusters (mock)",
  async provision(input: TierProvisionInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail:
        `[mock:k8s] applying namespace ${input.manifest.namespace} in ` +
        `${input.manifest.region} (PodSecurity ${input.manifest.podSecurity}, ` +
        `default-deny egress, ResourceQuota ${input.manifest.resourceQuota.cpuMilli}m/` +
        `${input.manifest.resourceQuota.memMb}MB).`,
      backendRef: synthRef("ns", input.manifest.namespace),
    };
  },
  async scale(input: TierScaleInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail: `[mock:k8s] "${input.slug}" scaled to ${input.replicas} replica(s).`,
      backendRef: input.backendRef ?? undefined,
    };
  },
  async teardown(input: TierTeardownInput): Promise<TierOpResult> {
    return {
      ok: true,
      detail: `[mock:k8s] namespace for "${input.slug}" deleted — meter stopped.`,
    };
  },
};
