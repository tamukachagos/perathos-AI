// W7 — The Conductor (ENTERPRISE_REVIEW Part 7).
//
// A THIN planner: it decomposes a trigger into a BOUNDED job DAG and a budget.
// It does not side-effect — it returns an AgentPlan the queue persists as
// AgentJob rows (root first, children linked by parentJobId). Invariants:
//   * NO role self-loops — a role never appears as its own parent (and we forbid
//     the same role twice in a direct parent→child chain, so a run cannot spin
//     forever re-triggering itself).
//   * Every plan ends with a Reviewer node gating the change-producing job,
//     because "every PR is reviewed before the owner sees it" (Part 7).
//   * Per-job maxAttempts=2 + a token/cost ceiling (DEFAULT_JOB_BUDGET).
//
// Pure: no DB, no secrets, no LLM (the Conductor's own reasoning is a fixed
// decomposition in mock mode; a real build would route reason.plan through W3).
// Importable by the queue + Vitest.

import {
  DEFAULT_JOB_BUDGET,
  type AgentPlan,
  type AgentTrigger,
  type PlannedJob,
} from "./types";
import type { AgentRole } from "@/lib/db/types";

/**
 * Decompose a trigger into a bounded DAG. The shape per trigger:
 *   ci_failure       → CI Medic → Reviewer
 *   owner_request    → Builder → Security Sentinel (pre-merge) → Reviewer
 *   improvement_sweep→ Builder → Reviewer
 *   error_spike      → Bug Hunter → Reviewer
 *   schedule         → Bug Hunter → Reviewer            (maintenance sweep)
 *   advisory         → Security Sentinel → Reviewer
 *   pre_merge        → Security Sentinel → Reviewer
 *
 * Each chain is a DAG: the change-producing root, optional gates, then the
 * Reviewer as the final machine gate. No role is its own parent; no role repeats
 * in a direct parent→child step (the no-self-loop guard).
 */
export function planForTrigger(trigger: AgentTrigger): AgentPlan {
  const roots: Record<AgentTrigger, AgentRole> = {
    ci_failure: "ci_medic",
    owner_request: "builder",
    improvement_sweep: "builder",
    error_spike: "bug_hunter",
    schedule: "bug_hunter",
    advisory: "security_sentinel",
    pre_merge: "security_sentinel",
  };

  const jobs: PlannedJob[] = [];
  const rootRole = roots[trigger];
  jobs.push({ role: rootRole, parentIndex: null, note: `${trigger} → ${rootRole}` });

  // owner_request runs a pre-merge Security Sentinel gate before the Reviewer.
  let lastIndex = 0;
  if (trigger === "owner_request") {
    jobs.push({
      role: "security_sentinel",
      parentIndex: lastIndex,
      note: "pre-merge security gate",
    });
    lastIndex = jobs.length - 1;
  }

  // Every plan ends with the Reviewer gating the latest change-producing job.
  jobs.push({
    role: "reviewer",
    parentIndex: lastIndex,
    note: "final review before the owner",
  });

  const plan: AgentPlan = { trigger, jobs, budget: DEFAULT_JOB_BUDGET };
  assertNoSelfLoops(plan);
  return plan;
}

/**
 * Guard: no role is its own parent, and no role repeats in a direct parent→child
 * step. Throws if violated — a malformed plan must never be queued (Part 7: "no
 * role self-loops"). Exposed so a test can assert the invariant on any plan.
 */
export function assertNoSelfLoops(plan: AgentPlan): void {
  plan.jobs.forEach((job, i) => {
    if (job.parentIndex === null) return;
    if (job.parentIndex === i) {
      throw new Error(`Agent plan self-loop: job ${i} is its own parent.`);
    }
    const parent = plan.jobs[job.parentIndex];
    if (parent && parent.role === job.role) {
      throw new Error(
        `Agent plan self-loop: role "${job.role}" is a direct parent of itself.`,
      );
    }
  });
}

/** The change-producing root role of a plan (the job the Reviewer gates). */
export function rootRole(plan: AgentPlan): AgentRole {
  return plan.jobs[0]?.role ?? "reviewer";
}
