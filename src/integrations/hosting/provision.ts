// W5 — Managed-hosting provisioning service (ENTERPRISE_REVIEW §5.2 + Part 3.A).
// SERVER-ONLY orchestration (imports node:crypto-backed tier backends + repos).
//
// The layer between the server actions / ActionRouter and:
//   * the catalog (resolvePlacement = the server-side ENUM ALLOWLIST; the
//     no-raw-spec guard), the manifest renderer (rendered isolation),
//   * the hosting-tier router (Static/Container/K8s mock backends),
//   * the hosting_deployments repo (the state machine) + the provisioning_jobs
//     DURABLE QUEUE (provisioning never runs in the request), and
//   * the W2 metering wallet (recordUsage of cpu_hour + storage_gb_mo at the
//     hosting markup) — with the cost-abuse guardrails (per-plan quota, max-scale
//     ceiling, per-tenant kill switch, billing-anomaly flag).
//
// Lifecycle: requested → provisioning → running → (scaling) → suspended →
// torn_down | failed. A verb ENQUEUES a job (provision/scale/teardown) bound to
// the async W1 op; the reconcile cron runs the queue against the tier backend
// and settles the op + advances the deployment. Non-payment / kill-switch / a
// running deployment the tenant cannot fund → suspended (cost-safe) → teardown.

import type {
  HostingDeploymentRecord,
  ProvisioningJobRecord,
  Repositories,
} from "@/lib/db/types";
import { hasCredits, recordUsage } from "@/lib/billing/metering";
import { logger } from "@/lib/logger";
import {
  assertNoRawSpec,
  hostingCatalog,
  planEstimateMicro,
  resolvePlacement,
  unitCostsForPlan,
  type HostingPlanName,
  type HostingRegion,
} from "./catalog";
import { renderManifest } from "./manifest";
import { selectTierBackend } from "./tier/router";

// --- Request-time validation (the enum allowlist + no-raw-spec guard) --------

export type ProvisionRejection =
  | "bad_region"
  | "bad_plan"
  | "region_not_in_pool"
  | "raw_spec_rejected";

export const PROVISION_REJECTION_MESSAGE: Record<ProvisionRejection, string> = {
  bad_region:
    "Please choose where your customers are from the list — we can't host in a custom location.",
  bad_plan: "Please choose one of the listed sizes.",
  region_not_in_pool: "That size isn't available in that region — pick another.",
  raw_spec_rejected:
    "We build your hosting for you from a vetted template — custom configuration files aren't accepted.",
};

/**
 * Validate a provisioning REQUEST: the no-raw-spec guard FIRST (reject any
 * smuggled manifest/yaml/env/command — RCE guard), then the server-side enum
 * allowlist (region + plan must be on the closed lists and the region in the
 * plan's pool). Returns the resolved placement or a stable rejection. This is
 * the ONE validation chokepoint every hosting verb calls before any work.
 */
export function validateProvisionRequest(
  payload: Record<string, unknown>,
):
  | { ok: true; region: HostingRegion; planName: HostingPlanName }
  | { ok: false; reason: ProvisionRejection } {
  // 1. NO RAW SPEC from owners, ever (Part 3.A). Reject before anything else.
  const noSpec = assertNoRawSpec(payload);
  if (!noSpec.ok) {
    logger.warn("hosting.raw_spec_rejected", { key: noSpec.key });
    return { ok: false, reason: "raw_spec_rejected" };
  }
  // 2. Server-side ENUM allowlist for region + plan (never free-form).
  const resolved = resolvePlacement(payload.region, payload.planName);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return {
    ok: true,
    region: resolved.placement.region,
    planName: resolved.placement.plan.name,
  };
}

// --- Deployment persistence + queue enqueue (on an accepted verb) ------------

export interface EnqueueProvisionInput {
  tenantId: string;
  slug: string;
  region: HostingRegion;
  planName: HostingPlanName;
  /** The async W1 operation id this provisioning settles. */
  operationId: string;
  /** Settlement/run delay for the queue job (tests pass 0 to run immediately). */
  runDelayMs?: number;
}

/**
 * Persist the HostingDeployment row (status=provisioning) and ENQUEUE a durable
 * provision job bound to the async op. Idempotent on (tenant, slug): a retry
 * re-uses the existing deployment row. Provisioning itself does NOT run here —
 * the reconcile cron picks up the queued job. Returns the deployment + job.
 */
export async function enqueueProvision(
  repos: Repositories,
  input: EnqueueProvisionInput,
): Promise<{ deployment: HostingDeploymentRecord; job: ProvisioningJobRecord }> {
  const plan = hostingCatalog()[input.planName];
  const existing = await repos.hostingDeployments.getBySlug(
    input.tenantId,
    input.slug,
  );

  const deployment = existing
    ? await repos.hostingDeployments.update(input.tenantId, existing.id, {
        status: "provisioning",
        operationId: input.operationId,
        // Re-provisioning resets the kill switch off (the owner re-requested it).
        killSwitch: false,
      })
    : await repos.hostingDeployments.create(input.tenantId, {
        slug: input.slug,
        region: input.region,
        planName: input.planName,
        tier: plan.tier,
        status: "provisioning",
        replicas: plan.replicas,
        maxReplicas: plan.maxReplicas,
        priceCents: plan.priceCents,
        costCents: plan.costCents,
        operationId: input.operationId,
      });

  const job = await repos.provisioningJobs.create(input.tenantId, {
    deploymentId: deployment.id,
    kind: "provision",
    operationId: input.operationId,
    runAfter: Date.now() + (input.runDelayMs ?? 0),
    detail: `provision ${input.planName} in ${input.region}`,
  });
  logger.info("hosting.provision.enqueued", {
    slug: input.slug,
    plan: input.planName,
    region: input.region,
    tier: plan.tier,
  });
  return { deployment, job };
}

// --- Scale (with the max-scale ceiling guardrail) ----------------------------

export type ScaleRejection = "not_found" | "exceeds_ceiling" | "not_running";

/**
 * Enqueue a scale job for a running deployment, enforcing the per-plan max-scale
 * CEILING server-side (the cost-abuse guardrail). A request above the plan's
 * `maxReplicas` is REJECTED — never silently clamped — so the owner sees why.
 * The deployment moves to `scaling`; the queue applies it.
 */
export async function enqueueScale(
  repos: Repositories,
  input: {
    tenantId: string;
    slug: string;
    replicas: number;
    operationId: string;
    runDelayMs?: number;
  },
): Promise<
  | { ok: true; deployment: HostingDeploymentRecord; job: ProvisioningJobRecord }
  | { ok: false; reason: ScaleRejection; detail: string }
> {
  const deployment = await repos.hostingDeployments.getBySlug(
    input.tenantId,
    input.slug,
  );
  if (!deployment) {
    return { ok: false, reason: "not_found", detail: "No managed hosting to resize." };
  }
  if (deployment.status !== "running" && deployment.status !== "scaling") {
    return {
      ok: false,
      reason: "not_running",
      detail: "Your hosting must be running before it can be resized.",
    };
  }
  if (input.replicas < 1 || input.replicas > deployment.maxReplicas) {
    return {
      ok: false,
      reason: "exceeds_ceiling",
      detail: `That size is above your plan's limit (max ${deployment.maxReplicas}). Upgrade your plan for more.`,
    };
  }
  const updated = await repos.hostingDeployments.update(
    input.tenantId,
    deployment.id,
    { status: "scaling", operationId: input.operationId },
  );
  const job = await repos.provisioningJobs.create(input.tenantId, {
    deploymentId: deployment.id,
    kind: "scale",
    operationId: input.operationId,
    targetReplicas: input.replicas,
    runAfter: Date.now() + (input.runDelayMs ?? 0),
    detail: `scale to ${input.replicas}`,
  });
  return { ok: true, deployment: updated, job };
}

// --- Teardown (stops the meter) ----------------------------------------------

/**
 * Enqueue a teardown job. Moves the deployment toward `torn_down`; the queue
 * applies it against the backend. A torn-down deployment is no longer metered
 * (the tick only meters `running` rows). Idempotent: tearing down an already
 * torn-down deployment is a no-op success.
 */
export async function enqueueTeardown(
  repos: Repositories,
  input: {
    tenantId: string;
    slug: string;
    operationId: string;
    runDelayMs?: number;
  },
): Promise<
  | { ok: true; deployment: HostingDeploymentRecord; job: ProvisioningJobRecord | null }
  | { ok: false; reason: "not_found"; detail: string }
> {
  const deployment = await repos.hostingDeployments.getBySlug(
    input.tenantId,
    input.slug,
  );
  if (!deployment) {
    return { ok: false, reason: "not_found", detail: "No managed hosting to stop." };
  }
  if (deployment.status === "torn_down") {
    return { ok: true, deployment, job: null };
  }
  const updated = await repos.hostingDeployments.update(
    input.tenantId,
    deployment.id,
    { status: "suspended", operationId: input.operationId },
  );
  const job = await repos.provisioningJobs.create(input.tenantId, {
    deploymentId: deployment.id,
    kind: "teardown",
    operationId: input.operationId,
    runAfter: Date.now() + (input.runDelayMs ?? 0),
    detail: "teardown",
  });
  return { ok: true, deployment: updated, job };
}

// --- The durable-queue runner (the reconcile cron drives this) ---------------

/**
 * Run ONE provisioning job against its tier backend, INSIDE its owning tenant's
 * scope, then advance the deployment + settle the async W1 op. Renders the
 * isolation manifest from the catalog (never an owner spec). Returns the new job
 * status. Bounded retries: a failed backend bumps `attempts` and re-queues until
 * a ceiling, then settles the op `failed`. The op-settle calls are passed in so
 * this module does not import the operation store (kept testable + decoupled).
 */
export async function runProvisioningJob(
  repos: Repositories,
  job: ProvisioningJobRecord,
  settle: (
    operationId: string,
    status: "succeeded" | "failed",
    detail: string,
    tenantId: string,
  ) => Promise<void>,
): Promise<ProvisioningJobRecord["status"]> {
  const { tenantId } = job;
  const deployment = await repos.hostingDeployments.get(tenantId, job.deploymentId);
  if (!deployment) {
    await repos.provisioningJobs.update(tenantId, job.id, {
      status: "failed",
      detail: "deployment missing",
    });
    if (job.operationId) {
      await settle(job.operationId, "failed", "Hosting record not found.", tenantId);
    }
    return "failed";
  }

  const region = deployment.region as HostingRegion;
  const plan = hostingCatalog()[deployment.planName as HostingPlanName];
  if (!plan) {
    await repos.provisioningJobs.update(tenantId, job.id, {
      status: "failed",
      detail: "unknown plan",
    });
    if (job.operationId) {
      await settle(job.operationId, "failed", "Hosting plan no longer offered.", tenantId);
    }
    return "failed";
  }
  const backend = selectTierBackend(plan.tier);

  try {
    await repos.provisioningJobs.update(tenantId, job.id, { status: "running" });

    if (job.kind === "provision") {
      const manifest = renderManifest({
        tenantId,
        slug: deployment.slug,
        region,
        plan,
      });
      const result = await backend.provision({
        tenantId,
        slug: deployment.slug,
        manifest,
      });
      if (!result.ok) throw new Error(result.detail);
      await repos.hostingDeployments.update(tenantId, deployment.id, {
        status: "running",
        backendRef: result.backendRef ?? null,
        replicas: manifest.replicas,
      });
    } else if (job.kind === "scale") {
      const target = Math.min(
        Math.max(1, job.targetReplicas ?? deployment.replicas),
        deployment.maxReplicas, // hard ceiling, defence-in-depth at run time
      );
      const result = await backend.scale({
        tenantId,
        slug: deployment.slug,
        backendRef: deployment.backendRef,
        replicas: target,
      });
      if (!result.ok) throw new Error(result.detail);
      await repos.hostingDeployments.update(tenantId, deployment.id, {
        status: "running",
        replicas: target,
      });
    } else {
      const result = await backend.teardown({
        tenantId,
        slug: deployment.slug,
        backendRef: deployment.backendRef,
      });
      if (!result.ok) throw new Error(result.detail);
      await repos.hostingDeployments.update(tenantId, deployment.id, {
        status: "torn_down",
        backendRef: null,
      });
    }

    await repos.provisioningJobs.update(tenantId, job.id, { status: "done" });
    if (job.operationId) {
      await settle(
        job.operationId,
        "succeeded",
        `Managed hosting ${job.kind} completed for "${deployment.slug}".`,
        tenantId,
      );
    }
    return "done";
  } catch (error) {
    const attempts = job.attempts + 1;
    const MAX_ATTEMPTS = 3;
    const errMsg = error instanceof Error ? error.message : "provisioning error";
    logger.warn("hosting.provision.job_failed", {
      kind: job.kind,
      attempts,
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    if (attempts < MAX_ATTEMPTS) {
      // Re-queue with a backoff so the sweep retries it later (durable queue).
      await repos.provisioningJobs.update(tenantId, job.id, {
        status: "queued",
        attempts,
        runAfter: Date.now() + attempts * 5_000,
        detail: errMsg,
      });
      return "queued";
    }
    await repos.provisioningJobs.update(tenantId, job.id, {
      status: "failed",
      attempts,
      detail: errMsg,
    });
    await repos.hostingDeployments.update(tenantId, deployment.id, {
      status: "failed",
    });
    if (job.operationId) {
      await settle(
        job.operationId,
        "failed",
        `Managed hosting ${job.kind} failed.`,
        tenantId,
      );
    }
    return "failed";
  }
}

// --- Metering tick + cost-abuse guardrails -----------------------------------

/**
 * Meter ONE running deployment for ONE tick interval (default 1 hour): debit
 * cpu_hour + storage_gb_mo against the wallet at the hosting markup, EXACTLY-ONCE
 * keyed on (deployment, tick period). Then enforce the cost-safe guardrails:
 *   * if the wallet cannot fund the NEXT tick → SUSPEND (stop the meter), or
 *   * if the per-tenant KILL SWITCH is on → SUSPEND immediately, and
 *   * raise the BILLING-ANOMALY flag if a tick's draw is unexpectedly large.
 * `tickKey` makes the debit idempotent (the tick cron may overlap on serverless).
 */
export async function meterDeploymentTick(
  repos: Repositories,
  deployment: HostingDeploymentRecord,
  tickKey: string,
): Promise<{ metered: boolean; suspended: boolean }> {
  const { tenantId } = deployment;

  // Kill switch is the hard stop — suspend without metering (cost-safe).
  if (deployment.killSwitch) {
    if (deployment.status === "running") {
      await repos.hostingDeployments.update(tenantId, deployment.id, {
        status: "suspended",
      });
    }
    return { metered: false, suspended: true };
  }

  const plan = hostingCatalog()[deployment.planName as HostingPlanName];
  if (!plan) return { metered: false, suspended: false };
  const units = unitCostsForPlan(plan);

  // One CPU-hour per replica + the plan's storage, this tick.
  const cpuResult = await recordUsage(repos, {
    tenantId,
    kind: "hosting.cpu_hour",
    quantity: deployment.replicas,
    unitCostMicro: units.cpuHourCostMicro,
    idempotencyKey: `hosting.cpu_hour:${deployment.id}:${tickKey}`,
  });
  const storageResult = await recordUsage(repos, {
    tenantId,
    kind: "hosting.storage_gb_mo",
    // Per-hour slice of the monthly storage charge (1/730 of a GB-month per hour).
    quantity: plan.storageGb,
    unitCostMicro: units.storageGbMonthCostMicro / 730n,
    idempotencyKey: `hosting.storage_gb_mo:${deployment.id}:${tickKey}`,
  });

  // Billing-anomaly flag: a single tick should never approach the plan's monthly
  // estimate. If it does, flag for review (does not auto-suspend on its own).
  const tickMicro = cpuResult.amountMicro + storageResult.amountMicro;
  if (!deployment.anomalyFlag && tickMicro * 24n > planEstimateMicro(plan)) {
    await repos.hostingDeployments.update(tenantId, deployment.id, {
      anomalyFlag: true,
    });
    logger.warn("hosting.billing_anomaly", { deploymentId: deployment.id });
  }

  // Cost-safe: if the wallet cannot fund the NEXT tick, SUSPEND now (the running
  // deployment a tenant can't fund is suspended, never left racking up cost).
  const nextTickEstimate = tickMicro > 0n ? tickMicro : 1n;
  const canFundNext = await hasCredits(repos, tenantId, nextTickEstimate);
  if (!canFundNext) {
    await repos.hostingDeployments.update(tenantId, deployment.id, {
      status: "suspended",
    });
    logger.info("hosting.suspended_low_balance", { deploymentId: deployment.id });
    return { metered: cpuResult.applied || storageResult.applied, suspended: true };
  }

  return {
    metered: cpuResult.applied || storageResult.applied,
    suspended: false,
  };
}

/**
 * Flip a tenant's deployment kill switch (the per-tenant hard stop). When turned
 * ON a running deployment is immediately suspended (cost-safe). Owner-driven via
 * a server action; also used by the non-payment path. Returns the updated row.
 */
export async function setKillSwitch(
  repos: Repositories,
  tenantId: string,
  slug: string,
  on: boolean,
): Promise<HostingDeploymentRecord | null> {
  const deployment = await repos.hostingDeployments.getBySlug(tenantId, slug);
  if (!deployment) return null;
  const status =
    on && deployment.status === "running" ? "suspended" : deployment.status;
  const updated = await repos.hostingDeployments.update(tenantId, deployment.id, {
    killSwitch: on,
    status,
  });
  await repos.audit.append(tenantId, {
    actorId: null,
    action: on ? "hosting.kill_switch_on" : "hosting.kill_switch_off",
    targetType: "hosting_deployment",
    targetId: deployment.id,
    metadata: { slug, status: updated.status },
  });
  return updated;
}

// Re-exported convenience for the picker UI (owner-facing).
export {
  hostingCatalog,
  planPriceZar,
  REGION_LABEL,
  HOSTING_REGIONS,
  HOSTING_PLAN_NAMES,
} from "./catalog";
