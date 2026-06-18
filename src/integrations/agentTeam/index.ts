// W7 — The customer agent team: public surface (ENTERPRISE_REVIEW Part 7).
//
// SERVER-ONLY. The agent team is an orchestrator over the existing adapters +
// the one ActionRouter; it adds roles + a queue + the AgentJob/AgentPolicy model
// + three gated verbs. Owner-facing server actions import from here; client
// components import only the server actions by reference (the CLIENT/SERVER
// split), never this module.

export { planForTrigger, assertNoSelfLoops, rootRole } from "./conductor";
export {
  enqueueRun,
  processQueue,
  createAgentApprovalRequest,
  estimateJobCostMicro,
  type QueueDeps,
  type EnqueueParams,
  type ProcessResult,
} from "./queue";
export {
  runRole,
  runCiMedic,
  runBuilder,
  runBugHunter,
  runSecuritySentinel,
  runReviewer,
  type RoleInput,
  type RoleDeps,
} from "./roles";
export {
  tierForChange,
  friendlyRiskLabel,
  requiresOwnerApproval,
  type ChangeSurface,
  type TierInputs,
} from "./riskTier";
export type {
  AgentTrigger,
  AgentRole,
  AgentRiskTier,
  RoleResult,
  ReviewerVerdict,
  SentinelVerdict,
  AgentPlan,
  PlannedJob,
  JobBudget,
} from "./types";
export { DEFAULT_JOB_BUDGET } from "./types";
