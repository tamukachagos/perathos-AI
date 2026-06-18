// W3 — LLM router public surface (ENTERPRISE_REVIEW Part 6).
//
// The single chokepoint for every LLM call: callers (the AgentProvider now; the
// agent team later) import `routeLlm` from here and NEVER touch an SDK directly.
// Provider selection, the task→tier→model policy, caching, the credit gate,
// quality gate, metering, and audit all live behind this one function.

export { routeLlm } from "./router";
export type { RouteDeps, RouteParams, RouteOutcome } from "./router";

export { selectLlmProvider, activeProviderName } from "./provider";
export {
  tierForTask,
  modelsForTask,
  modelsForTier,
  meterKindForTask,
  isImageTask,
} from "./policy";
export { __resetLlmCache } from "./cache";

export type {
  LlmTask,
  LlmTier,
  LlmInput,
  LlmMessage,
  LlmResult,
  LlmUsage,
  LlmProvider,
  LlmCompletion,
} from "./types";
