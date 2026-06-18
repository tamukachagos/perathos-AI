// W7 — Trigger ingress (ENTERPRISE_REVIEW Part 7 / §5.3).
//
// SERVER-ONLY. Bridges an external signal (the GitHub workflow_run webhook) to an
// enqueued agent run, with the entitlement + tenant resolution the webhook needs.
// The webhook has no session: it resolves the owning tenant from the repoRef via
// the SECURITY DEFINER resolver, then — only if the tenant holds the `agentTeam`
// entitlement — enqueues a CI Medic run. Everything risky still flows through the
// queue + ActionRouter; this just spawns the run.

import type { Repositories } from "@/lib/db/types";
import { checkEntitlement } from "@/lib/billing/entitlements";
import { logger } from "@/lib/logger";
import { enqueueRun } from "./queue";

export interface CiFailureTrigger {
  /** Operator-side repo ref, e.g. "launchdesk-sites/joes-shop". */
  repoRef: string;
  /** The workflow conclusion (we act on "failure"). */
  conclusion: string;
  /** Untrusted summary text (run name / head branch). Hashed, never stored raw. */
  triggerData?: string | null;
}

export interface TriggerOutcome {
  enqueued: boolean;
  reason:
    | "ok"
    | "not_a_failure"
    | "unknown_repo"
    | "not_entitled"
    | "paused"
    | "no_business";
  jobCount: number;
}

/**
 * Handle a GH Actions workflow_run failure: resolve the tenant from the repo,
 * gate on the `agentTeam` entitlement, then enqueue a CI Medic run. Returns a
 * structured outcome (never throws). The webhook caller has already verified the
 * signature (fail-closed) + deduped the event.
 */
export async function handleCiFailure(
  repos: Repositories,
  trigger: CiFailureTrigger,
): Promise<TriggerOutcome> {
  if (trigger.conclusion !== "failure") {
    return { enqueued: false, reason: "not_a_failure", jobCount: 0 };
  }

  // Resolve the owning tenant + slug from the repo (cross-tenant, no session).
  const owner = await repos.siteRepos.resolveByRepoRef(trigger.repoRef);
  if (!owner) {
    logger.info("agent.ci_failure.unknown_repo", {});
    return { enqueued: false, reason: "unknown_repo", jobCount: 0 };
  }
  const { tenantId, slug } = owner;

  // Entitlement gate: only `agentTeam` tenants get an autonomous CI Medic run.
  const ent = await checkEntitlement(repos.subscriptions, tenantId, "agentTeam");
  if (!ent.allowed) {
    await repos.audit.append(tenantId, {
      actorId: null,
      action: "agent.trigger_denied",
      targetType: "agent",
      targetId: "ci_failure",
      metadata: { reason: "not_entitled", slug },
    });
    return { enqueued: false, reason: "not_entitled", jobCount: 0 };
  }

  // The trigger needs the tenant's business profile for the role inputs.
  const business = await repos.businesses.getPrimary(tenantId);
  if (!business) {
    return { enqueued: false, reason: "no_business", jobCount: 0 };
  }
  const { id: _id, tenantId: _t, ...bizProfile } = business;
  void _id;
  void _t;

  const jobs = await enqueueRun(
    { repos },
    {
      tenantId,
      trigger: "ci_failure",
      business: bizProfile,
      slug,
      // Untrusted run summary — hashed by the queue, never stored raw.
      triggerData: trigger.triggerData ?? null,
    },
  );
  if (jobs.length === 0) {
    // enqueueRun returns [] only when the tenant is paused (kill switch).
    return { enqueued: false, reason: "paused", jobCount: 0 };
  }
  return { enqueued: true, reason: "ok", jobCount: jobs.length };
}
