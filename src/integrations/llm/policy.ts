// W3 — LLM routing policy: task → tier → model map (ENTERPRISE_REVIEW Part 6).
//
// CONFIG, NOT CODE. The Engagement-Lead note in §6 is explicit: pin to
// currently-released model ids at build time, but keep the policy
// ENV-OVERRIDABLE because model names churn — OSS slugs on OpenRouter
// (deepseek/qwen/llama/flux/gemini) move fastest, so they are NEVER the only
// option: each tier resolves to an env override first, then a built-in default,
// with an ordered fallback list the router walks on a provider error.
//
// Pure: no DB, no secrets, no network. Importable by the router and by Vitest.

import type { LlmTask, LlmTier } from "./types";

/** Each task's tier (drives the model AND the W2 margin multiplier). */
const TASK_TIER: Record<LlmTask, LlmTier> = {
  "profile.extract": "CHEAP",
  "classify.intent": "CHEAP",
  "copy.generate": "CHEAP",
  "site.codegen": "CODE",
  "site.codefix": "CODE",
  "image.generate": "IMAGE",
  "image.edit": "IMAGE",
  "reason.plan": "PREMIUM",
  "security.review": "PREMIUM",
};

export function tierForTask(task: LlmTask): LlmTier {
  return TASK_TIER[task];
}

/**
 * Per-tier model policy. `primary` + `fallbacks` are the §6 defaults pinned to
 * currently-released ids where they are Anthropic (PREMIUM/CODE use the SDK
 * directly via the Anthropic provider); the OSS slugs for CHEAP/IMAGE are the
 * OpenRouter slugs from §6 and are intentionally treated as defaults only —
 * they're overridden by env first (LLM_MODEL_<TIER>) and never hardcoded as the
 * sole option.
 *
 * Anthropic model ids are the CURRENT ones (claude-opus-4-8 / claude-sonnet-4-6
 * / claude-haiku-4-5-20251001) — NEVER claude-3-*.
 */
interface TierPolicy {
  envVar: string;
  primary: string;
  fallbacks: string[];
}

// Built-in defaults. OpenRouter OSS slugs churn — these are the §6
// recommendations as a starting point; production overrides via env per tier.
const TIER_DEFAULTS: Record<LlmTier, TierPolicy> = {
  CHEAP: {
    envVar: "LLM_MODEL_CHEAP",
    // §6 CHEAP lane (profile.extract / classify / copy). OSS via OpenRouter.
    primary: "meta-llama/llama-3.3-70b-instruct",
    fallbacks: ["qwen/qwen-2.5-72b-instruct", "deepseek/deepseek-chat"],
  },
  CODE: {
    envVar: "LLM_MODEL_CODE",
    // §6: Sonnet for code (must compile / pass CI). Current id.
    primary: "claude-sonnet-4-6",
    fallbacks: ["qwen/qwen-2.5-coder-32b-instruct", "deepseek/deepseek-coder"],
  },
  IMAGE: {
    envVar: "LLM_MODEL_IMAGE",
    // §6: image sub-adapter is STUBBED for now (real provider later). Slugs
    // are recorded so the policy is complete + env-overridable when it lands.
    primary: "google/gemini-2.5-flash-image",
    fallbacks: ["black-forest-labs/flux-1.1-pro"],
  },
  PREMIUM: {
    envVar: "LLM_MODEL_PREMIUM",
    // §6: Opus reserved for the two deploy-gating tasks. Current id (the note
    // pins claude-opus-4-8, replacing the prose's older 4-6).
    primary: "claude-opus-4-8",
    fallbacks: ["claude-sonnet-4-6"],
  },
};

/**
 * The ordered list of model ids to try for a tier: env override (if set) FIRST,
 * then the built-in primary, then the built-in fallbacks — deduped. The router
 * walks this on a provider error or a twice-failed quality gate. Because the env
 * override is prepended (not a replacement), an operator can pin a new OSS slug
 * without losing the vetted fallbacks behind it.
 */
export function modelsForTier(tier: LlmTier): string[] {
  const policy = TIER_DEFAULTS[tier];
  const override = process.env[policy.envVar]?.trim();
  const ordered = [
    ...(override ? [override] : []),
    policy.primary,
    ...policy.fallbacks,
  ];
  // Dedupe, preserve order (an override equal to the primary collapses).
  return [...new Set(ordered)];
}

/** The full ordered candidate list for a task (env → primary → fallbacks). */
export function modelsForTask(task: LlmTask): string[] {
  return modelsForTier(tierForTask(task));
}

/** True for the two image tasks, which route to the STUBBED image sub-adapter. */
export function isImageTask(task: LlmTask): boolean {
  return tierForTask(task) === "IMAGE";
}

/**
 * The metering `kind` for a task: `llm.<tier>.<task>` so multiplierForKind()
 * (W2) reads the tier from the SECOND segment and applies the right margin.
 * e.g. profile.extract → "llm.cheap.profile.extract".
 */
export function meterKindForTask(task: LlmTask): string {
  return `llm.${tierForTask(task).toLowerCase()}.${task}`;
}
