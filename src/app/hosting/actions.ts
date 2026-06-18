"use server";

// W5 — Managed-hosting server actions (the hosting control plane).
//
// Tenant-scoped via requireTenant() (the client never supplies a tenant). Four
// surfaces:
//   1. hostingCatalogAction — UNGATED read of the catalog (regions + plans +
//      ZAR prices) for the non-technical picker. No charge, no write.
//   2. runHostingGatedAction — provision/scale/teardown. Validates the request
//      (no-raw-spec guard + server-side enum allowlist) BEFORE anything, then
//      mints + redeems a payload-bound approval token through the ActionRouter
//      (entitlement `managedHosting` + wallet pre-flight checked BEFORE the
//      token). On accept it persists the HostingDeployment + ENQUEUES the durable
//      provisioning job (provisioning never runs in this request).
//   3. hostingStatusAction — read a site's managed-hosting status (reconciling
//      the async op / running the queue in mock so polling drives settlement).
//   4. setHostingKillSwitchAction — the per-tenant kill switch (cost-abuse stop).
//
// SERVER ACTION plane: imports the registry chokepoint + the hosting services;
// never statically imported by a client component (called by reference).

import type { Business } from "@/lib/types";
import type { HostingDeploymentStatus } from "@/lib/db/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import { getOperation } from "@/integrations/core/operationStore";
import { sweepProvisioningQueue } from "@/integrations/hosting/sweep";
import {
  enqueueProvision,
  enqueueScale,
  enqueueTeardown,
  setKillSwitch,
  validateProvisionRequest,
  PROVISION_REJECTION_MESSAGE,
} from "@/integrations/hosting/provision";
import {
  hostingCatalog,
  planPriceZar,
  REGION_LABEL,
  HOSTING_REGIONS,
  type HostingPlanName,
  type HostingRegion,
} from "@/integrations/hosting/catalog";

// --- 1. Catalog (ungated, read-only) ----------------------------------------

export interface HostingPlanOption {
  name: HostingPlanName;
  label: string;
  blurb: string;
  priceZar: string;
}

export interface HostingRegionOption {
  value: HostingRegion;
  label: string;
}

export interface HostingCatalogResponse {
  regions: HostingRegionOption[];
  plans: HostingPlanOption[];
}

/** The picker's data: regions + named plans + ZAR prices (no jargon). */
export async function hostingCatalogAction(): Promise<HostingCatalogResponse> {
  await requireTenant();
  const catalog = hostingCatalog();
  return {
    regions: HOSTING_REGIONS.map((value) => ({
      value,
      label: REGION_LABEL[value],
    })),
    plans: Object.values(catalog).map((plan) => ({
      name: plan.name,
      label: plan.label,
      blurb: plan.blurb,
      priceZar: planPriceZar(plan),
    })),
  };
}

// --- 2. Gated verbs (provision / scale / teardown) ---------------------------

export type HostingGatedVerb =
  | "hosting.provision"
  | "hosting.scale"
  | "hosting.teardown";

export interface RunHostingRequest {
  verb: HostingGatedVerb;
  business: Business;
  slug: string;
  /** Plain-language region (the owner's "where are your customers?"). */
  region?: string;
  /** Named plan (the owner's "how big?"). */
  planName?: string;
  /** Desired replica count for a scale (within the plan ceiling). */
  replicas?: number;
  /** Step-up confirmation (the owner re-affirms intent). */
  stepUp: boolean;
}

export interface RunHostingResult {
  status: "accepted" | "denied";
  detail: string;
  operationId?: string;
}

export async function runHostingGatedAction(
  request: RunHostingRequest,
): Promise<RunHostingResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  if (request.stepUp !== true) {
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: request.verb,
      metadata: { verb: request.verb, reason: "step_up_required" },
    });
    return { status: "denied", detail: "Step-up confirmation is required." };
  }

  // Build the payload the approval binds to. For provision/scale we VALIDATE the
  // request first (no-raw-spec guard + server-side enum allowlist) so a bad
  // region/plan or any smuggled raw spec is rejected BEFORE we mint a token or
  // touch the wallet/adapter.
  let region: HostingRegion | undefined;
  let planName: HostingPlanName | undefined;
  const payload: Record<string, unknown> = { slug: request.slug };

  if (request.verb === "hosting.provision") {
    const validated = validateProvisionRequest({
      region: request.region,
      planName: request.planName,
    });
    if (!validated.ok) {
      return {
        status: "denied",
        detail: PROVISION_REJECTION_MESSAGE[validated.reason],
      };
    }
    region = validated.region;
    planName = validated.planName;
    payload.region = region;
    payload.planName = planName;
  } else if (request.verb === "hosting.scale") {
    payload.replicas = request.replicas ?? 1;
    // Pre-validate the scale ceiling BEFORE minting a token / starting an op, so
    // an over-ceiling request (cost-abuse guardrail) is rejected cleanly without
    // leaving a stranded pending op. The run-time guard in enqueueScale is the
    // defence-in-depth backstop.
    const dep = await repos.hostingDeployments.getBySlug(ctx.tenantId, request.slug);
    if (!dep) {
      return { status: "denied", detail: "No managed hosting to resize." };
    }
    const target = request.replicas ?? 1;
    if (target < 1 || target > dep.maxReplicas) {
      return {
        status: "denied",
        detail: `That size is above your plan's limit (max ${dep.maxReplicas}). Upgrade your plan for more.`,
      };
    }
  }

  const idempotencyKey = `${request.verb}:${ctx.tenantId}:${request.slug}:${Date.now()}`;
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({
    verb: request.verb,
    payloadHash,
    idempotencyKey,
    nonce,
    expiresAt,
  });
  await recordIssued({
    nonce,
    tenantId: ctx.tenantId,
    verb: request.verb,
    payloadHash,
    idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });

  const outcome = await executeAction(
    {
      audit: repos.audit,
      subscriptions: repos.subscriptions,
      wallet: repos.wallet,
    },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: request.verb,
      business: request.business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );

  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }
  if (outcome.status !== "accepted") {
    return { status: "accepted", detail: outcome.detail };
  }
  const operationId = outcome.operation.id;

  // On accept (op pending), persist the deployment + enqueue the durable job.
  if (outcome.operation.status !== "failed") {
    try {
      if (request.verb === "hosting.provision" && region && planName) {
        await enqueueProvision(repos, {
          tenantId: ctx.tenantId,
          slug: request.slug,
          region,
          planName,
          operationId,
        });
      } else if (request.verb === "hosting.scale") {
        const scaled = await enqueueScale(repos, {
          tenantId: ctx.tenantId,
          slug: request.slug,
          replicas: request.replicas ?? 1,
          operationId,
        });
        if (!scaled.ok) {
          // The ceiling/guardrail rejection is surfaced to the owner; the op was
          // accepted but there is nothing to do, so settle it informationally by
          // leaving the deny detail. The op reconciles to succeeded as a no-op.
          return { status: "denied", detail: scaled.detail };
        }
      } else if (request.verb === "hosting.teardown") {
        await enqueueTeardown(repos, {
          tenantId: ctx.tenantId,
          slug: request.slug,
          operationId,
        });
      }
    } catch {
      // Enqueue failure must not crash the action; the op + audit row exist.
    }
  }

  return { status: "accepted", detail: outcome.detail, operationId };
}

// --- 3. Status read (mock: drives the queue so polling settles) --------------

export interface HostingStatusResponse {
  status: HostingDeploymentStatus | null;
  region: string | null;
  planName: string | null;
  tier: string | null;
  replicas: number | null;
  maxReplicas: number | null;
  killSwitch: boolean;
  anomalyFlag: boolean;
}

export async function hostingStatusAction(
  slug: string,
): Promise<HostingStatusResponse> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  // In mock mode, run the durable queue so a freshly-enqueued provision/scale/
  // teardown advances on poll (the cron does this in production). Then reconcile
  // the bound op so the deployment reflects the terminal state.
  await sweepProvisioningQueue(Date.now());
  const deployment = await repos.hostingDeployments.getBySlug(ctx.tenantId, slug);
  if (!deployment) {
    return {
      status: null,
      region: null,
      planName: null,
      tier: null,
      replicas: null,
      maxReplicas: null,
      killSwitch: false,
      anomalyFlag: false,
    };
  }
  if (deployment.operationId) {
    await getOperation(deployment.operationId, ctx.tenantId);
  }
  const fresh = await repos.hostingDeployments.getBySlug(ctx.tenantId, slug);
  const row = fresh ?? deployment;
  return {
    status: row.status,
    region: row.region,
    planName: row.planName,
    tier: row.tier,
    replicas: row.replicas,
    maxReplicas: row.maxReplicas,
    killSwitch: row.killSwitch,
    anomalyFlag: row.anomalyFlag,
  };
}

// --- 4. Kill switch (cost-abuse stop) ----------------------------------------

export interface KillSwitchResult {
  status: "ok" | "not_found";
  detail: string;
  on: boolean;
}

export async function setHostingKillSwitchAction(
  slug: string,
  on: boolean,
): Promise<KillSwitchResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const updated = await setKillSwitch(repos, ctx.tenantId, slug, on);
  if (!updated) {
    return { status: "not_found", detail: "No managed hosting to update.", on: false };
  }
  return {
    status: "ok",
    detail: on
      ? "Managed hosting stopped — billing paused."
      : "Managed hosting can run again.",
    on: updated.killSwitch,
  };
}
