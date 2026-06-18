// W7 — The agent job queue + processor (ENTERPRISE_REVIEW Part 7 / Part 3.C).
//
// This is the orchestrator that turns a trigger into queued AgentJob rows (via
// the Conductor) and processes them one role at a time, enforcing every Part 3.C
// invariant. The agent is "just another actor" through the existing seams — it
// holds no credentials and no signing secret.
//
// INVARIANTS enforced here (each has a test):
//   * PRs, never direct push/deploy — a role produces a PR ref; the risky action
//     is a gated verb routed through the ActionRouter.
//   * The agent NEVER mints its own approval token — when a job needs a risky
//     action it creates an APPROVAL REQUEST (a queued `awaiting_approval` job +
//     audit row) the owner approves; `createAgentApprovalRequest` is the ONLY
//     thing the agent calls, and it CANNOT mint a token. Token minting lives
//     exclusively in the owner-facing approval endpoint (src/app/approvals/*).
//   * Hard spend-cap PRE-FLIGHT between every step — before running a job we
//     check the wallet balance AND the AgentPolicy monthly cap can cover the
//     next step; if not, the job halts `blocked`.
//   * Pause/kill switch — AgentPolicy.pausedByOwner halts ALL processing
//     immediately.
//   * Risk tiering decides who approves; untrusted text is DATA (the role chose
//     the surface, not the text).
//
// SERVER-ONLY (touches repos + routeLlm). Runs end-to-end in mock mode.

import { createHash } from "node:crypto";
import type { Business } from "@/lib/types";
import type {
  AgentJobRecord,
  AgentRiskTier,
  AgentRole,
  Repositories,
} from "@/lib/db/types";
import { currentPeriod } from "@/lib/billing/meteringConfig";
import { logger } from "@/lib/logger";
import { planForTrigger } from "./conductor";
import { requiresOwnerApproval } from "./riskTier";
import { runRole, type RoleInput } from "./roles";
import type { AgentTrigger, RoleResult } from "./types";

export interface QueueDeps {
  repos: Repositories;
}

export interface EnqueueParams {
  tenantId: string;
  trigger: AgentTrigger;
  business: Business;
  slug: string;
  /** Raw untrusted trigger text (error log / request) — hashed, never stored raw. */
  triggerData?: string | null;
}

/** Content-addressed reference for untrusted trigger data (never the raw text). */
function dataRefFor(text: string | null | undefined): string | null {
  if (!text) return null;
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Estimate the next step's cost so the spend-cap pre-flight can decide BEFORE
 * doing work (Part 3.C: "a hard pre-flight between every step, not a post-hoc
 * reconcile"). A conservative per-job ceiling in ZAR micro-cents; env-overridable.
 */
export function estimateJobCostMicro(): bigint {
  const raw = process.env.LD_AGENT_JOB_EST_MICRO?.trim();
  const n = raw ? Number(raw) : NaN;
  return BigInt(Math.round(Number.isFinite(n) && n > 0 ? n : 500_000)); // ~R5
}

/**
 * Enqueue a run: the Conductor decomposes the trigger into a bounded DAG, which
 * we persist as AgentJob rows (root first, children linked by parentJobId). The
 * root job is `queued`; downstream gate/review jobs are created `queued` too but
 * the processor runs them in DAG order. Returns the created jobs (root first).
 */
export async function enqueueRun(
  deps: QueueDeps,
  params: EnqueueParams,
): Promise<AgentJobRecord[]> {
  const { repos } = deps;
  // Pause/kill switch: a paused tenant enqueues NOTHING.
  const policy = await repos.agentPolicies.get(params.tenantId);
  if (policy.pausedByOwner) {
    await repos.audit.append(params.tenantId, {
      actorId: null,
      action: "agent.paused",
      targetType: "agent",
      targetId: params.trigger,
      metadata: { trigger: params.trigger, reason: "paused_by_owner" },
    });
    return [];
  }

  const plan = planForTrigger(params.trigger);
  const dataRef = dataRefFor(params.triggerData);
  const created: AgentJobRecord[] = [];

  for (const node of plan.jobs) {
    const parentJobId =
      node.parentIndex === null ? null : created[node.parentIndex]?.id ?? null;
    const job = await repos.agentJobs.create(params.tenantId, {
      role: node.role,
      trigger: params.trigger,
      status: "queued",
      // The tier is resolved when the job RUNS (from the role's output); we seed
      // a conservative "review" so a never-run job is never accidentally AUTO.
      riskTier: "review",
      inputRef: dataRef,
      parentJobId,
    });
    created.push(job);
  }

  await repos.audit.append(params.tenantId, {
    actorId: null,
    action: "agent.enqueued",
    targetType: "agent",
    targetId: params.trigger,
    metadata: {
      trigger: params.trigger,
      jobCount: created.length,
      // PII-free: only the REFERENCE to untrusted data, never the data itself.
      dataRef,
    },
  });
  return created;
}

export interface ProcessResult {
  jobId: string;
  role: AgentRole;
  status: AgentJobRecord["status"];
  riskTier: AgentRiskTier;
  /** The gated verb an owner approval was requested for, when risky. */
  approvalRequestedFor:
    | "github.mergePR"
    | "agent.deployFix"
    | "agent.applyContent"
    | null;
}

/**
 * Process all of a tenant's `queued` jobs in DAG order (parents before children).
 * Each step runs the spend-cap pre-flight + pause check FIRST; a role produces a
 * RoleResult mapped to a risk tier; a risky result creates an OWNER approval
 * REQUEST (never a token). Returns one ProcessResult per job touched.
 */
export async function processQueue(
  deps: QueueDeps,
  tenantId: string,
  business: Business,
  slug: string,
): Promise<ProcessResult[]> {
  const { repos } = deps;
  const results: ProcessResult[] = [];

  // Snapshot the queued jobs (oldest first = DAG order, since we created them
  // root-first). We re-read policy + balance before EACH job (pre-flight).
  const queued = await repos.agentJobs.listByStatus(tenantId, "queued");

  for (const job of queued) {
    // --- PAUSE pre-flight: a paused tenant halts ALL remaining jobs `blocked`.
    const policy = await repos.agentPolicies.get(tenantId);
    if (policy.pausedByOwner) {
      await repos.agentJobs.update(tenantId, job.id, { status: "blocked" });
      await repos.audit.append(tenantId, {
        actorId: null,
        action: "agent.blocked",
        targetType: "agent_job",
        targetId: job.id,
        metadata: { role: job.role, reason: "paused_by_owner" },
      });
      results.push({
        jobId: job.id,
        role: job.role,
        status: "blocked",
        riskTier: job.riskTier,
        approvalRequestedFor: null,
      });
      continue;
    }

    // --- SPEND-CAP pre-flight: the wallet balance AND the monthly agent cap must
    // cover the next step's estimate. Either ceiling failing halts `blocked`.
    const estimate = estimateJobCostMicro();
    const balance = await repos.wallet.getBalance(tenantId);
    const capRemaining = await remainingCapMicro(repos, tenantId, policy.monthlySpendCapMicro);
    if (balance < estimate || capRemaining < estimate) {
      await repos.agentJobs.update(tenantId, job.id, { status: "blocked" });
      await repos.audit.append(tenantId, {
        actorId: null,
        action: "agent.blocked",
        targetType: "agent_job",
        targetId: job.id,
        metadata: {
          role: job.role,
          reason: balance < estimate ? "insufficient_credits" : "spend_cap_reached",
          estimateMicro: estimate.toString(),
          balanceMicro: balance.toString(),
        },
      });
      results.push({
        jobId: job.id,
        role: job.role,
        status: "blocked",
        riskTier: job.riskTier,
        approvalRequestedFor: null,
      });
      continue;
    }

    // --- RUN the role. The role reasons via W3 routeLlm (metered) and returns a
    // deterministic RoleResult; the LLM never holds a credential or a token.
    await repos.agentJobs.update(tenantId, job.id, { status: "running" });
    const input: RoleInput = {
      tenantId,
      business,
      slug,
      dataRef: job.inputRef,
      jobId: job.id,
      idempotencyKey: `agent:${tenantId}:${job.id}`,
    };

    let result: RoleResult;
    try {
      result = await runRole(job.role, { repos }, input);
    } catch (error) {
      await repos.agentJobs.update(tenantId, job.id, { status: "failed" });
      logger.warn("agent.job_failed", {
        role: job.role,
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      results.push({
        jobId: job.id,
        role: job.role,
        status: "failed",
        riskTier: job.riskTier,
        approvalRequestedFor: null,
      });
      continue;
    }

    // Persist the role's tier + PR ref + (informational) cost on the job.
    await repos.agentJobs.update(tenantId, job.id, {
      riskTier: result.riskTier,
      prUrl: result.prRef,
      resultRef: result.resultRef,
      costMicro: result.costMicro,
    });

    // --- A risky result needs an OWNER approval. The agent does NOT mint a
    // token — it leaves the job `awaiting_approval` and records an approval
    // REQUEST audit row. Only when the result is AUTO with auto-approve do we
    // mark it `done` (notify, don't ask). A Reviewer/BLOCK with no gated verb is
    // advisory → `done`.
    let approvalRequestedFor: ProcessResult["approvalRequestedFor"] = null;
    let finalStatus: AgentJobRecord["status"] = "done";

    if (result.gatedVerb) {
      const needsOwner = requiresOwnerApproval(
        result.riskTier,
        policy.autoApproveContent,
      );
      if (needsOwner) {
        approvalRequestedFor = result.gatedVerb;
        finalStatus = "awaiting_approval";
        await createAgentApprovalRequest(repos, {
          tenantId,
          jobId: job.id,
          verb: result.gatedVerb,
          slug,
          prRef: result.prRef,
          riskTier: result.riskTier,
          summary: result.summary,
        });
      } else {
        // AUTO + auto-approve-content: notify, don't ask. Still NO token minted by
        // the agent — an AUTO action's owner approval is auto-issued by the
        // owner-side endpoint when the owner has opted in; here we just record it
        // as applied-pending-owner-side. We mark the job done and audit the notify.
        finalStatus = "done";
        await repos.audit.append(tenantId, {
          actorId: null,
          action: "agent.auto_applied",
          targetType: "agent_job",
          targetId: job.id,
          metadata: {
            role: result.role,
            verb: result.gatedVerb,
            riskTier: result.riskTier,
          },
        });
      }
    }

    await repos.agentJobs.update(tenantId, job.id, { status: finalStatus });
    await repos.audit.append(tenantId, {
      actorId: null,
      action: "agent.completed",
      targetType: "agent_job",
      targetId: job.id,
      metadata: {
        role: result.role,
        riskTier: result.riskTier,
        verdict: result.reviewVerdict ?? result.sentinelVerdict ?? null,
        gatedVerb: result.gatedVerb,
        status: finalStatus,
        // PII-free, owner-facing summary string is fine (no payload/PII).
        summary: result.summary,
      },
    });

    results.push({
      jobId: job.id,
      role: result.role,
      status: finalStatus,
      riskTier: result.riskTier,
      approvalRequestedFor,
    });
  }

  return results;
}

/**
 * The remaining agent spend allowed this period under the monthly cap. A cap of 0
 * means "no separate cap — the wallet balance is the only ceiling" → effectively
 * unbounded by the cap (the wallet still bounds it). Computed from the period's
 * `agent.*` usage rows.
 */
async function remainingCapMicro(
  repos: Repositories,
  tenantId: string,
  monthlySpendCapMicro: bigint,
): Promise<bigint> {
  if (monthlySpendCapMicro <= 0n) {
    // No cap: return a large sentinel so the wallet is the sole ceiling.
    return 1n << 62n;
  }
  const period = currentPeriod();
  const rows = await repos.usage.listByPeriod(tenantId, period);
  const agentSpend = rows
    .filter((r) => r.kind.startsWith("agent.") || r.kind.startsWith("llm."))
    .reduce((sum, r) => sum + r.amountMicro, 0n);
  const remaining = monthlySpendCapMicro - agentSpend;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Create an OWNER approval REQUEST for a risky agent action. This is the ONLY
 * agent-side path toward a risky verb, and it provably CANNOT mint a token: it
 * writes an audit row + a metadata reference the owner-facing endpoint reads. The
 * approval token is minted EXCLUSIVELY by src/app/approvals/* (the owner endpoint)
 * after the owner taps — the agent has no signing secret. The job sits
 * `awaiting_approval` until then.
 */
export async function createAgentApprovalRequest(
  repos: Repositories,
  params: {
    tenantId: string;
    jobId: string;
    verb: "github.mergePR" | "agent.deployFix" | "agent.applyContent";
    slug: string;
    prRef: string | null;
    riskTier: AgentRiskTier;
    summary: string;
  },
): Promise<void> {
  await repos.audit.append(params.tenantId, {
    actorId: null, // the AGENT actor, never the owner — distinct identity
    action: "agent.approval_requested",
    targetType: "agent_job",
    targetId: params.jobId,
    metadata: {
      verb: params.verb,
      slug: params.slug,
      prRef: params.prRef,
      riskTier: params.riskTier,
      summary: params.summary,
      // NOTE: deliberately NO token, NO nonce, NO signing material. The agent
      // cannot self-approve — this is a request, not an approval.
    },
  });
}
