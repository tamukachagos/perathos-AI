// W7 — The customer agent team: shared contracts (ENTERPRISE_REVIEW Part 7).
//
// Pure types, no runtime/secret/DB dependency, so the roles, the Conductor, the
// queue, and Vitest can all import them. The agent team is an ORCHESTRATOR over
// the existing adapters + the one ActionRouter — these types describe the jobs
// it queues and the deterministic mock results each role produces; any real LLM
// reasoning goes through W3 routeLlm (metered), never an SDK directly.

import type { AgentRiskTier, AgentRole } from "@/lib/db/types";
import type { LlmTask as _LlmTask } from "@/integrations/llm/types";

export type { AgentRiskTier, AgentRole } from "@/lib/db/types";

/**
 * The triggers that spawn an agent run. Each maps (via the Conductor) to a
 * bounded job DAG. Untrusted text (issue bodies, error logs) is carried as DATA
 * on the trigger, never as instructions — the roles treat it as opaque input.
 */
export type AgentTrigger =
  | "ci_failure" // GH Actions workflow_run failure → CI Medic
  | "owner_request" // "Ask your team" box → Builder
  | "improvement_sweep" // scheduled improvement → Builder
  | "error_spike" // runtime error spike → Bug Hunter
  | "schedule" // daily/scheduled → Bug Hunter / Security Sentinel
  | "advisory" // Dependabot/advisory → Security Sentinel
  | "pre_merge"; // pre-merge gate → Security Sentinel + Reviewer

/** The Reviewer's verdict on a PR before the owner ever sees it. */
export type ReviewerVerdict = "approve" | "revise" | "escalate";

/** The Security Sentinel's verdict. A BLOCK halts the DAG (no merge/deploy). */
export type SentinelVerdict = "ok" | "block";

/**
 * Per-job bounds the Conductor allocates (Part 7: `maxAttempts=2`, a `maxTokens`
 * / cost ceiling). These are the budget envelope the queue enforces; the wallet
 * + AgentPolicy spend cap are the hard money ceiling on top.
 */
export interface JobBudget {
  /** Max attempts for a single job (Part 7 pins this at 2). */
  maxAttempts: number;
  /** Max LLM tokens a job may spend (a cost ceiling, not a hard wallet cap). */
  maxTokens: number;
}

export const DEFAULT_JOB_BUDGET: JobBudget = {
  maxAttempts: 2,
  maxTokens: 4_000,
};

/**
 * What a role produces when the queue runs it (deterministic in mock mode). A
 * role NEVER side-effects directly — it returns a typed proposal the queue maps
 * to a risk tier and (for risky work) an owner approval REQUEST. `prRef` is the
 * PR the role opened (CI Medic / Builder / Bug Hunter / Security Sentinel
 * dep-bump); a role never pushes to main.
 */
export interface RoleResult {
  role: AgentRole;
  /** The risk tier this output maps to (auto / review / escalate). */
  riskTier: AgentRiskTier;
  /** The PR ref/url the role opened (null for Reviewer / a BLOCK verdict). */
  prRef: string | null;
  /** A content-addressed reference to the result detail (never raw code). */
  resultRef: string;
  /** Plain-language, owner-facing summary (Reviewer / activity feed). */
  summary: string;
  /** Reviewer verdict, when this is the Reviewer. */
  reviewVerdict?: ReviewerVerdict;
  /** Security Sentinel verdict, when this is the Sentinel. */
  sentinelVerdict?: SentinelVerdict;
  /**
   * The gated verb this result needs the owner to approve to take effect, or
   * null when the result is advisory only (Reviewer summary, a BLOCK verdict).
   * The agent NEVER mints the token for this verb — it creates an approval
   * REQUEST the owner approves.
   */
  gatedVerb: "github.mergePR" | "agent.deployFix" | "agent.applyContent" | null;
  /** Wholesale LLM cost this role drew (micro-cents) — metered to the wallet. */
  costMicro: bigint;
}

/** A single node the Conductor emits when decomposing a trigger into a DAG. */
export interface PlannedJob {
  role: AgentRole;
  /** Index of the parent node in the plan (null for the root), forming the DAG. */
  parentIndex: number | null;
  /** A short note for the audit/UI (never untrusted text verbatim). */
  note: string;
}

/** The Conductor's bounded plan for a trigger: a DAG of jobs + the budget. */
export interface AgentPlan {
  trigger: AgentTrigger;
  jobs: PlannedJob[];
  budget: JobBudget;
}

// Re-export so callers can reference the LLM task vocabulary without a second
// import (the roles route their reasoning through W3 routeLlm).
export type LlmTaskRef = _LlmTask;
