"use server";

// W6 — Deploy + custom-domain server actions.
//
// Two tenant-scoped surfaces (the client never supplies a tenant):
//   1. deployStatusAction — read the latest deploy status for a site. In mock
//      mode the async deploy op settles via the W1 reconcile sweep; this action
//      reconciles, then SYNCS the Deployment row to the op's terminal state so
//      the owner sees "live" without a real Vercel webhook (the live path is the
//      signed webhook). Returns a friendly status + url + repo "history" info.
//   2. connectCustomDomainAction — tie a W4-registered domain to the deployed
//      site via the gated dns.write + the mock Vercel domains attach. Gated by
//      the customDomain entitlement at the ActionRouter.
//
// SERVER ACTION plane: imports the registry chokepoint + the hosting/github
// services; never statically imported by a client component (called by reference).

import type { Business } from "@/lib/types";
import type { DeploymentStatus } from "@/lib/db/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { getOperation } from "@/integrations/core/operationStore";
import { settleDeployment } from "@/integrations/hosting/service";
import { connectCustomDomain } from "@/integrations/hosting/customDomain";

export interface DeployStatusResponse {
  /** null when the site has never been deployed. */
  status: DeploymentStatus | null;
  url: string | null;
  /** The per-customer GitHub repo URL ("history" surface), when one exists. */
  repoUrl: string | null;
  /** The latest recorded commit sha (mock: deterministic), when one exists. */
  lastCommitSha: string | null;
}

/**
 * Read (and, in mock mode, reconcile) the latest deploy status for a site. The
 * Deployment row is kept in sync with the async W1 operation: when the op has
 * settled (reconcile sweep in mock; the Vercel webhook in live), the Deployment
 * follows to live/failed so the owner UI reflects it.
 */
export async function deployStatusAction(
  slug: string,
): Promise<DeployStatusResponse> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  const deployment = await repos.deployments.getLatestBySlug(ctx.tenantId, slug);
  const repo = await repos.siteRepos.getBySlug(ctx.tenantId, slug);

  if (!deployment) {
    return {
      status: null,
      url: null,
      repoUrl: repo?.repoUrl ?? null,
      lastCommitSha: repo?.lastCommitSha ?? null,
    };
  }

  let status = deployment.status;
  let url = deployment.url;

  // If the deploy is still in flight, reconcile the async op (mock: the W1 sweep
  // settles it) and sync the Deployment row to the op's terminal state. The
  // signed Vercel webhook does this in live mode; this keeps the owner UI fresh
  // when polling drives settlement (the M3 pending->poll contract).
  if (
    (status === "queued" || status === "building") &&
    deployment.operationId
  ) {
    const op = await getOperation(deployment.operationId, ctx.tenantId);
    if (op && op.status !== "pending") {
      const next: Extract<DeploymentStatus, "live" | "failed"> =
        op.status === "succeeded" ? "live" : "failed";
      const settled = await settleDeployment(
        repos,
        ctx.tenantId,
        deployment.id,
        next,
      );
      if (settled) {
        status = settled.status;
        url = settled.url;
      }
    }
  }

  return {
    status,
    url,
    repoUrl: repo?.repoUrl ?? null,
    lastCommitSha: repo?.lastCommitSha ?? null,
  };
}

export interface ConnectCustomDomainRequest {
  business: Business;
  slug: string;
  hostname: string;
  /** Step-up confirmation (the owner re-affirms intent). */
  stepUp: boolean;
}

export interface ConnectCustomDomainResponse {
  status: "connected" | "denied";
  detail: string;
}

/**
 * Connect a custom domain to a deployed site. Gated by the customDomain
 * entitlement at the ActionRouter (a free tenant is denied). Requires step-up.
 */
export async function connectCustomDomainAction(
  request: ConnectCustomDomainRequest,
): Promise<ConnectCustomDomainResponse> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  if (request.stepUp !== true) {
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: "dns.write",
      metadata: { verb: "dns.write", reason: "step_up_required" },
    });
    return { status: "denied", detail: "Step-up confirmation is required." };
  }

  return connectCustomDomain(repos, {
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    business: request.business,
    slug: request.slug,
    hostname: request.hostname,
  });
}
