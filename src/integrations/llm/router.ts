// W3 — the LLM router: the SINGLE chokepoint for EVERY LLM call
// (ENTERPRISE_REVIEW Part 6). The AgentProvider and (later) the agent team call
// routeLlm(task, input) — NEVER an SDK directly.
//
// The loop, per §6:
//   resolve model from policy
//     → PRE-FLIGHT credit gate (estimate max cost; reject insufficient_credits
//       via the W2 wallet BEFORE any provider call)
//     → CACHE check (key = hash(model+system+messages+params); a hit debits
//       nothing)
//     → call provider
//     → QUALITY gate (expected JSON must parse the schema; on a twice-failed
//       CHEAP result escalate one tier, then walk the fallback models)
//     → METER the REAL usage against the W2 wallet (recordUsage, kind
//       `llm.<task>`, marked up per tier) in one step
//     → AUDIT (action "llm.usage", PII-free metadata: task, model, tokens, cost
//       — NEVER the prompt/PII/key).
//
// It is repository-aware (wallet + audit) but provider-agnostic. It NEVER throws
// on a provider/quality failure — it degrades and returns a structured result
// with `degraded:true`, mirroring the AgentProvider's degraded flag (B12).

import type { Repositories } from "@/lib/db/types";
import { logger } from "@/lib/logger";
import { applyMargin, multiplierForKind } from "@/lib/billing/meteringConfig";
import {
  isImageTask,
  meterKindForTask,
  modelsForTask,
  modelsForTier,
  tierForTask,
} from "./policy";
import {
  imageStubProvider,
  selectLlmProvider,
} from "./provider";
import { cacheGet, cacheKey, cacheSet } from "./cache";
import { meterLlmUsage } from "./meter";
import type {
  LlmCompletion,
  LlmDegradeReason,
  LlmInput,
  LlmProvider,
  LlmResult,
  LlmTask,
  LlmTier,
} from "./types";

/** What routeLlm needs from the data layer. */
export interface RouteDeps {
  /** REQUIRED: the W2 wallet (pre-flight gate + metering). */
  wallet: Repositories["wallet"];
  /** REQUIRED: append-only audit. */
  audit: Repositories["audit"];
  /** Used by recordUsage via meterLlmUsage (debit appends usage + audit). */
  repos: Repositories;
}

export interface RouteParams {
  tenantId: string;
  task: LlmTask;
  input: LlmInput;
  /**
   * Exactly-once metering key for this logical call. A retry with the same key
   * re-attaches to the prior debit (never double-charges). Required.
   */
  idempotencyKey: string;
  /** Optional billing period ("YYYY-MM"); defaults to current UTC month. */
  period?: string;
}

export type RouteOutcome =
  | { status: "ok"; result: LlmResult }
  | {
      status: "insufficient_credits";
      detail: string;
      /** The estimated max cost (retail micro-cents) that exceeded the balance. */
      estimateMicro: bigint;
    };

const AUDIT_USAGE = "llm.usage";
const AUDIT_DENY = "llm.denied";

/**
 * Pre-flight cost ESTIMATE (retail micro-cents) for a task, used by the credit
 * gate BEFORE any provider call. We don't know real tokens yet, so we estimate
 * conservatively from the prompt size at the tier's wholesale rate, then apply
 * the tier margin — the same margin the real debit will use. Env-overridable
 * worst-case ceilings let W5/ops tune it without code.
 */
function estimateRetailMicro(task: LlmTask, input: LlmInput): bigint {
  const tier = tierForTask(task);
  // Image: a flat per-image estimate (one unit), env-overridable.
  if (isImageTask(task)) {
    const raw = process.env.LLM_IMAGE_COST_MICRO?.trim();
    const n = raw ? Number(raw) : NaN;
    const wholesale = BigInt(
      Math.round(Number.isFinite(n) && n > 0 ? n : 2_000_000),
    );
    return applyMargin(wholesale, multiplierForKind(meterKindForTask(task)));
  }
  // Text/code/reason: estimate total tokens (prompt + a generous output cap),
  // ≈ 4 chars/token, at the tier's wholesale per-1k rate.
  const promptChars =
    (input.system?.length ?? 0) +
    input.messages.reduce((n, m) => n + m.content.length, 0);
  const inTokens = Math.ceil(promptChars / 4);
  const outTokens = input.maxTokens ?? 1024;
  const totalK = BigInt(Math.ceil((inTokens + outTokens) / 1000)) || 1n;
  const wholesalePer1k = estimateWholesalePer1kMicro(tier);
  const wholesale = totalK * wholesalePer1k;
  return applyMargin(wholesale, multiplierForKind(meterKindForTask(task)));
}

/** Conservative wholesale per-1k-token ceiling per tier (env-overridable). */
function estimateWholesalePer1kMicro(tier: LlmTier): bigint {
  const num = (name: string, fallback: number): bigint => {
    const raw = process.env[name]?.trim();
    const n = raw ? Number(raw) : NaN;
    return BigInt(Math.round(Number.isFinite(n) && n > 0 ? n : fallback));
  };
  switch (tier) {
    case "CHEAP":
      return num("LLM_EST_CHEAP_PER_1K_MICRO", 1_000); // ~R0.01/1k
    case "CODE":
      return num("LLM_EST_CODE_PER_1K_MICRO", 30_000); // Sonnet-ish
    case "PREMIUM":
      return num("LLM_EST_PREMIUM_PER_1K_MICRO", 60_000); // Opus-ish
    case "IMAGE":
      return num("LLM_EST_IMAGE_PER_1K_MICRO", 2_000_000);
  }
}

/** Run the JSON quality gate. Returns true when the output is acceptable. */
function passesQuality(input: LlmInput, completion: LlmCompletion): boolean {
  if (!input.expectJson) return true; // free-text task: any text passes.
  let text = completion.text.trim();
  // Strip a ```json fence defensively (mirrors claudeProfile's parser).
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  try {
    const parsed: unknown = JSON.parse(text);
    return input.expectJson(parsed);
  } catch {
    return false;
  }
}

/** The provider for a task: image tasks use the STUB; everything else env-selected. */
function providerForTask(task: LlmTask): LlmProvider {
  return isImageTask(task) ? imageStubProvider() : selectLlmProvider();
}

/**
 * The ordered model candidates to try for a task. The first failure (provider
 * error or quality-gate miss) walks to the next. §6's escalation: a twice-failed
 * CHEAP result escalates ONE tier (CHEAP → CODE), then continues down the
 * fallback list. We model that by appending the next tier's models AFTER the
 * task's own models for CHEAP tasks.
 */
function candidateModels(task: LlmTask): string[] {
  const own = modelsForTask(task);
  if (tierForTask(task) === "CHEAP") {
    // Escalate one tier (to CODE) after the cheap lane is exhausted.
    return [...new Set([...own, ...modelsForTier("CODE")])];
  }
  return own;
}

/**
 * Route an LLM call through the full loop. Returns a structured outcome; never
 * throws on a provider/quality failure (it degrades). The ONLY non-ok status is
 * `insufficient_credits`, returned BEFORE any provider call.
 */
export async function routeLlm(
  deps: RouteDeps,
  params: RouteParams,
): Promise<RouteOutcome> {
  const { tenantId, task, input, idempotencyKey, period } = params;
  const tier = tierForTask(task);
  const provider = providerForTask(task);
  const models = candidateModels(task);

  // --- PRE-FLIGHT credit gate (the LLM analogue of the entitlement gate). The
  // estimate is the retail max cost; deny BEFORE any provider work if the wallet
  // can't cover it. FAIL CLOSED is structural: an empty wallet (0) can't cover a
  // positive estimate, so a tenant with no credits is rejected here.
  const estimateMicro = estimateRetailMicro(task, input);
  if (estimateMicro > 0n) {
    const balance = await deps.wallet.getBalance(tenantId);
    if (balance < estimateMicro) {
      await deps.audit.append(tenantId, {
        actorId: null,
        action: AUDIT_DENY,
        targetType: "llm",
        targetId: task,
        metadata: {
          task,
          tier,
          reason: "insufficient_credits",
          estimateMicro: estimateMicro.toString(),
          balanceMicro: balance.toString(),
        },
      });
      return {
        status: "insufficient_credits",
        detail:
          "Your credit balance is too low for this action. Top up your credits to continue.",
        estimateMicro,
      };
    }
  }

  // --- Walk the candidate models: cache → call → quality gate → meter+audit.
  let lastModel = models[0] ?? "unknown";
  let degradeReason: LlmDegradeReason | undefined;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    lastModel = model;
    const escalated = i > 0; // any model past the first means we fell back/escalated

    // --- CACHE: a hit debits NOTHING (the biggest margin lever). It is keyed on
    // model+system+messages+params, so an escalation to a different model is a
    // distinct key (correct: a different model is a different answer).
    const key = cacheKey(model, input);
    const cached = cacheGet(key);
    if (cached && passesQuality(input, cached)) {
      // Audit the cache hit (PII-free); NO wallet debit.
      await deps.audit.append(tenantId, {
        actorId: null,
        action: AUDIT_USAGE,
        targetType: "llm",
        targetId: task,
        metadata: {
          task,
          tier,
          model: cached.model,
          cached: true,
          inputTokens: cached.usage.inputTokens,
          outputTokens: cached.usage.outputTokens,
          costMicro: cached.usage.costMicro.toString(),
        },
      });
      return {
        status: "ok",
        result: {
          model: cached.model,
          tier,
          task,
          text: cached.text,
          usage: cached.usage,
          cached: true,
          degraded: escalated,
          degradeReason: escalated ? "escalated" : undefined,
        },
      };
    }

    // --- CALL the provider. A throw is a provider error → try the next model.
    let completion: LlmCompletion;
    try {
      completion = await provider.complete(model, input);
    } catch (error) {
      // Log the error CLASS only (never key/prompt/PII), then fall back.
      logger.warn("llm.provider_error", {
        task,
        model,
        provider: provider.name,
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      degradeReason = "provider_error";
      continue;
    }

    // --- QUALITY gate. On a miss, try the next candidate (escalation/fallback).
    if (!passesQuality(input, completion)) {
      logger.warn("llm.quality_gate_failed", {
        task,
        model,
        provider: provider.name,
      });
      degradeReason = "quality_gate_failed";
      continue;
    }

    // Cache the good completion (future identical calls debit nothing).
    cacheSet(key, completion);

    // --- METER the REAL usage + AUDIT in one step (recordUsage debits the
    // wallet, appends the usage row, and writes its own `wallet.debited` audit;
    // we add a PII-free `llm.usage` audit row for the routing view).
    const metered = await meterLlmUsage(deps.repos, {
      tenantId,
      task,
      usage: completion.usage,
      idempotencyKey,
      period,
    });
    await deps.audit.append(tenantId, {
      actorId: null,
      action: AUDIT_USAGE,
      targetType: "llm",
      targetId: task,
      metadata: {
        task,
        tier,
        model: completion.model,
        provider: provider.name,
        cached: false,
        escalated,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        costMicro: completion.usage.costMicro.toString(),
        amountMicro: metered.amountMicro.toString(),
        applied: metered.applied,
      },
    });

    return {
      status: "ok",
      result: {
        model: completion.model,
        tier,
        task,
        text: completion.text,
        usage: completion.usage,
        cached: false,
        degraded: escalated || Boolean(degradeReason),
        degradeReason: escalated ? "escalated" : degradeReason,
      },
    };
  }

  // --- Every candidate failed (provider errors / quality misses). Return a
  // degraded, empty-text result rather than throwing — the caller (e.g. the
  // AgentProvider) then applies its own heuristic fallback. No wallet debit
  // happened (nothing succeeded). Audit the terminal degrade.
  await deps.audit.append(tenantId, {
    actorId: null,
    action: AUDIT_USAGE,
    targetType: "llm",
    targetId: task,
    metadata: {
      task,
      tier,
      model: lastModel,
      cached: false,
      degraded: true,
      reason: degradeReason ?? "provider_error",
    },
  });
  return {
    status: "ok",
    result: {
      model: lastModel,
      tier,
      task,
      text: "",
      usage: { inputTokens: 0, outputTokens: 0, costMicro: 0n },
      cached: false,
      degraded: true,
      degradeReason: degradeReason ?? "provider_error",
    },
  };
}
