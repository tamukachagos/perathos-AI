// W3 — LLM router shared contracts (ENTERPRISE_REVIEW Part 6).
//
// Pure types, no runtime/secret/DB dependency, so both the provider impls and
// the router (which must avoid the Auth.js chain) and Vitest can import them.

import type { MarginTier } from "@/lib/billing/meteringConfig";

/**
 * The set of LLM tasks the platform routes. Each maps to a TIER (and thus a
 * model + margin) in policy.ts. This is the closed vocabulary callers use —
 * `routeLlm("profile.extract", …)` — so a typo'd task can't reach a model.
 */
export type LlmTask =
  | "profile.extract"
  | "classify.intent"
  | "copy.generate"
  | "site.codegen"
  | "site.codefix"
  | "image.generate"
  | "image.edit"
  | "reason.plan"
  | "security.review";

/** The four routing tiers (§6). Maps 1:1 to the W2 metering MarginTier. */
export type LlmTier = MarginTier; // "CHEAP" | "CODE" | "IMAGE" | "PREMIUM"

/** A chat message in the provider-neutral (OpenAI-compatible) shape. */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The request a caller hands to routeLlm (besides the task). */
export interface LlmInput {
  /** System prompt (instructions). Hoisted out so the cache key is stable. */
  system?: string;
  /** The conversation turns (at minimum one user turn). */
  messages: LlmMessage[];
  /** Output cap. Defaults per provider; kept modest for cost. */
  maxTokens?: number;
  /**
   * When set, the router runs the JSON quality gate: the model output must
   * `JSON.parse` to an object passing this predicate, else it escalates/falls
   * back. Omit for free-text tasks (copy, code) where any text is acceptable.
   */
  expectJson?: (parsed: unknown) => boolean;
}

/** Token usage + wholesale cost as reported by the provider (or synthesised). */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Wholesale cost in ZAR MICRO-CENTS (what the operator pays upstream). The
   * OpenRouter provider derives this from its native USD cost × FX; the mock
   * synthesises it from a per-1k-token rate so the metering UX is exercisable.
   */
  costMicro: bigint;
}

/** What a provider's `complete()` returns (before metering). */
export interface LlmCompletion {
  /** The model id that actually served the call (after fallback resolution). */
  model: string;
  /** The concatenated text output. */
  text: string;
  usage: LlmUsage;
}

/** Why the router degraded (for the `degraded` flag + audit, never PII). */
export type LlmDegradeReason =
  | "provider_error"
  | "quality_gate_failed"
  | "escalated";

/** The final result the router returns to the caller. */
export interface LlmResult {
  /** Model id that produced the returned text (post fallback/escalation). */
  model: string;
  tier: LlmTier;
  task: LlmTask;
  text: string;
  usage: LlmUsage;
  /** True when served from cache (no provider call, no wallet debit). */
  cached: boolean;
  /**
   * True when the router fell back/escalated/degraded to produce this — e.g. a
   * provider error or a twice-failed quality gate. Surfaced (not swallowed) so
   * callers/UX can see "AI is live" is qualified, mirroring the agent
   * `degraded` flag (B12).
   */
  degraded: boolean;
  degradeReason?: LlmDegradeReason;
}

/**
 * The provider-neutral completion interface every backend implements. The
 * router only ever calls `complete()`; provider selection + model resolution
 * happen above it. `name`/`real` mirror the AgentProvider contract for logging.
 */
export interface LlmProvider {
  readonly name: string;
  /** True when this makes a real network call (false for the mock). */
  readonly real: boolean;
  /**
   * Run a completion against an explicit model id. Throws on a provider error
   * (the router catches it and falls back). MUST NOT log the prompt/key/PII.
   */
  complete(model: string, input: LlmInput): Promise<LlmCompletion>;
}
