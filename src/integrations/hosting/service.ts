// W6 — Hosting service (SERVER-ONLY orchestration for the StaticTier deploy).
//
// StaticTier = Vercel (§5.2): a published site at /s/[slug] deploys from its
// per-customer GitHub repo via a Vercel project + deploy hook. The deploy is
// GATED + ASYNC through the ActionRouter (hosting.deploy): the router starts a
// W1 operation and returns 202 + an OperationRef; the signed Vercel webhook (or
// the reconcile cron in mock) settles the op to live/failed and updates the
// Deployment row.
//
// NOT METERED in W6: static hosting is plan-included (§8), so the verb's cost
// estimate is 0 and the wallet is never debited here.
//
// SERVER-ONLY. The real Vercel API is DORMANT behind VERCEL_* (see .env.example);
// in mock mode the project + deploy are synthetic + keyless so the whole chain
// runs with no keys. Container/K8s tiers are Phase 3.

import type {
  DeploymentRecord,
  DeploymentStatus,
  Repositories,
} from "@/lib/db/types";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/** Whether the real Vercel API is configured (else the deterministic mock). */
export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN);
}

/** The Vercel project name for a site, e.g. "launchdesk-joes-shop". */
export function vercelProjectForSlug(slug: string): string {
  const prefix = process.env.VERCEL_PROJECT_PREFIX?.trim() || "launchdesk";
  return `${prefix}-${slug}`;
}

/** The (mock) live URL a deployment resolves to once settled. */
export function deployUrlForSlug(slug: string): string {
  // In mock mode the public site is served from the app origin at /s/[slug];
  // a real Vercel project would resolve to {project}.vercel.app.
  return `${env.appUrl.replace(/\/$/, "")}/s/${slug}`;
}

/**
 * Create (or reuse) a Deployment row for a publish, in the `queued` state, bound
 * to the async W1 operation that will settle it. Called from the publish path on
 * an accepted hosting.deploy. The deploy target is "static" in W6.
 */
export async function createDeployment(
  repos: Repositories,
  params: {
    tenantId: string;
    slug: string;
    operationId: string;
    version: number;
    /** Vendor-side deploy id, correlating the inbound Vercel webhook (synthetic in mock). */
    providerDeploymentId?: string | null;
    status?: DeploymentStatus;
  },
): Promise<DeploymentRecord> {
  const record = await repos.deployments.create(params.tenantId, {
    slug: params.slug,
    target: "static",
    status: params.status ?? "queued",
    operationId: params.operationId,
    version: params.version,
    providerDeploymentId:
      params.providerDeploymentId ?? mockProviderDeploymentId(params.operationId),
  });
  logger.info("hosting.deploy.created", {
    slug: params.slug,
    operationId: params.operationId,
    mode: env.adapterMode,
    live: isVercelConfigured(),
  });
  return record;
}

/**
 * The synthetic Vercel deployment id used in mock mode, derived from the W1
 * operation id so the mock webhook (and tests) can correlate the inbound event
 * back to the Deployment row deterministically.
 */
export function mockProviderDeploymentId(operationId: string): string {
  return `dpl_mock_${operationId}`;
}

/**
 * Settle a Deployment row to a terminal state (live/failed) + url. Called by the
 * Vercel webhook (deployment.succeeded -> live, deployment.error -> failed) and,
 * in mock mode, by the deploy reconcile. Tenant-scoped. Returns null if the
 * deploy is not this tenant's. Terminal updates are idempotent (a redelivery
 * just re-writes the same status/url).
 */
export async function settleDeployment(
  repos: Repositories,
  tenantId: string,
  deploymentId: string,
  status: Exclude<DeploymentStatus, "queued" | "building">,
): Promise<DeploymentRecord | null> {
  const existing = await repos.deployments.get(tenantId, deploymentId);
  if (!existing) return null;
  return repos.deployments.update(tenantId, deploymentId, {
    status,
    url: status === "live" ? deployUrlForSlug(existing.slug) : existing.url,
  });
}
