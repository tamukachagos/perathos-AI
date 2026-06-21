// W3 — LLM provider selection (ENTERPRISE_REVIEW Part 6).
//
// Mirrors selectAgentProvider()/selectBillingProvider(): one function picks the
// active backend from env, defaulting to a deterministic MOCK so the whole
// routing + metering UX is exercisable with NO keys.
//
//   OPENROUTER_API_KEY → OpenRouter (OpenAI-compatible Chat Completions over
//                        fetch — no new dep; returns native token usage + cost)
//   else ANTHROPIC_API_KEY → direct Anthropic (existing @anthropic-ai/sdk)
//   else                   → deterministic mock with SYNTHETIC token usage
//
// Image tasks always route to a STUBBED image sub-adapter (real provider later);
// see imageStubProvider below.

import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmCompletion,
  LlmInput,
  LlmProvider,
  LlmTier,
  LlmUsage,
} from "./types";

// --- Cost synthesis ----------------------------------------------------------

/**
 * Wholesale rate used by the MOCK and (as a fallback) when a real provider does
 * not report a cost: ZAR micro-cents per 1k tokens. Deliberately tiny so the
 * mock's synthetic spend resembles a cheap OSS call — enough to exercise the
 * wallet without draining a test grant. Env-overridable.
 */
function ratePer1kMicro(): bigint {
  const raw = process.env.LLM_MOCK_RATE_PER_1K_MICRO?.trim();
  const n = raw ? Number(raw) : NaN;
  // Default ≈ R0.005 / 1k tokens = 500 micro-cents.
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n)) : 500n;
}

/** Synthesize a wholesale cost from token counts at the per-1k rate. */
function synthCostMicro(inputTokens: number, outputTokens: number): bigint {
  const total = BigInt(Math.max(0, inputTokens) + Math.max(0, outputTokens));
  return (total * ratePer1kMicro()) / 1000n;
}

/** Rough deterministic token estimate (≈ 4 chars/token) for mock + cost floor. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function promptText(input: LlmInput): string {
  return [input.system ?? "", ...input.messages.map((m) => m.content)].join("\n");
}

// --- Mock provider -----------------------------------------------------------

/**
 * Deterministic mock with SYNTHETIC usage. Produces a stable, parseable output
 * so the JSON quality gate, caching, and metering all exercise end-to-end with
 * no key. The text is a tiny echo wrapper — callers that need structured output
 * (profile.extract) pass `expectJson`, and the mock returns a minimal valid
 * object so the gate passes deterministically.
 */
export function mockLlmProvider(): LlmProvider {
  return {
    name: "mock",
    real: false,
    async complete(model: string, input: LlmInput): Promise<LlmCompletion> {
      const prompt = promptText(input);
      const inputTokens = estimateTokens(prompt);
      // The mock returns a deterministic JSON object when JSON is expected, else
      // a short echo. It does NOT try to be smart — the AgentProvider keeps its
      // own heuristic fallback; the mock here just makes the ROUTER exercisable.
      const text = input.expectJson
        ? JSON.stringify({ mock: true, model })
        : `[mock:${model}] ${input.messages.at(-1)?.content?.slice(0, 80) ?? ""}`;
      const outputTokens = estimateTokens(text);
      const usage: LlmUsage = {
        inputTokens,
        outputTokens,
        costMicro: synthCostMicro(inputTokens, outputTokens),
      };
      return { model, text, usage };
    },
  };
}

// --- OpenRouter provider (OpenAI-compatible Chat Completions via fetch) -------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** OpenRouter returns the upstream USD cost here when usage accounting is on. */
  cost?: number;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenRouterUsage;
  model?: string;
}

/** FX buffer: ZAR per USD (buffered). Default 18.5; env LLM_FX_ZAR_PER_USD. */
function fxZarPerUsd(): number {
  const raw = process.env.LLM_FX_ZAR_PER_USD?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 18.5;
}

/** USD cost → ZAR micro-cents. 1 USD = fx ZAR = fx×100 cents = fx×100×1000 micro. */
function usdToMicro(costUsd: number): bigint {
  const micro = costUsd * fxZarPerUsd() * 100 * 1000;
  return BigInt(Math.max(0, Math.round(micro)));
}

export function openRouterProvider(apiKey: string): LlmProvider {
  return {
    name: "openrouter",
    real: true,
    async complete(model: string, input: LlmInput): Promise<LlmCompletion> {
      const messages = [
        ...(input.system ? [{ role: "system", content: input.system }] : []),
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: input.maxTokens ?? 1024,
          // Ask OpenRouter to include native cost accounting in `usage`.
          usage: { include: true },
        }),
      });
      if (!res.ok) {
        // Never log the key/prompt; only the HTTP class.
        throw new Error(`openrouter_http_${res.status}`);
      }
      const data = (await res.json()) as OpenRouterResponse;
      const text = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens ?? estimateTokens(promptText(input));
      const outputTokens = data.usage?.completion_tokens ?? estimateTokens(text);
      // Prefer the provider's native cost (USD → ZAR micro); fall back to the
      // synthetic per-1k rate if it didn't report one.
      const costMicro =
        typeof data.usage?.cost === "number"
          ? usdToMicro(data.usage.cost)
          : synthCostMicro(inputTokens, outputTokens);
      return {
        model: data.model ?? model,
        text,
        usage: { inputTokens, outputTokens, costMicro },
      };
    },
  };
}

// --- Anthropic provider (direct, existing SDK) -------------------------------

/**
 * Anthropic input/output cost in ZAR micro-cents per 1k tokens, env-overridable
 * (LLM_ANTHROPIC_IN_PER_1K_MICRO / _OUT_). Defaults are rough Opus-tier
 * wholesale at the buffered FX; the policy routes Sonnet/Opus here so a sensible
 * default keeps metering meaningful even before precise per-model pricing.
 */
function anthropicRatesMicro(): { inPer1k: bigint; outPer1k: bigint } {
  const num = (name: string, fallback: number): bigint => {
    const raw = process.env[name]?.trim();
    const n = raw ? Number(raw) : NaN;
    return BigInt(Math.round(Number.isFinite(n) && n > 0 ? n : fallback));
  };
  // ~ $5/$25 per 1M (Opus) → per 1k = $0.005/$0.025 → ×18.5×100×1000 micro.
  return {
    inPer1k: num("LLM_ANTHROPIC_IN_PER_1K_MICRO", 9250),
    outPer1k: num("LLM_ANTHROPIC_OUT_PER_1K_MICRO", 46250),
  };
}

export function anthropicLlmProvider(apiKey: string): LlmProvider {
  return {
    name: "anthropic",
    real: true,
    async complete(model: string, input: LlmInput): Promise<LlmCompletion> {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: input.maxTokens ?? 1024,
        ...(input.system ? { system: input.system } : {}),
        messages: input.messages.map((m) => ({
          // Anthropic accepts user/assistant turns; a stray system turn is
          // already hoisted into `system` above.
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const inputTokens = response.usage?.input_tokens ?? estimateTokens(promptText(input));
      const outputTokens = response.usage?.output_tokens ?? estimateTokens(text);
      const rates = anthropicRatesMicro();
      const costMicro =
        (BigInt(inputTokens) * rates.inPer1k) / 1000n +
        (BigInt(outputTokens) * rates.outPer1k) / 1000n;
      return { model, text, usage: { inputTokens, outputTokens, costMicro } };
    },
  };
}

// --- Image stub sub-adapter --------------------------------------------------

/**
 * STUBBED image sub-adapter (§6: "image models route through a per-image
 * sub-adapter (OpenRouter or fal.ai/Replicate)" — real provider LATER). The
 * decision for W3: keep the IMAGE tier wired through the SAME routeLlm
 * chokepoint and metering path, but DO NOT make a real image call yet. The stub
 * returns a deterministic placeholder URL + synthetic per-image usage so the
 * pre-flight gate, caching, metering, and audit are all exercised; swapping in a
 * real fal.ai/OpenRouter image call is a provider change with no router change.
 */
export function imageStubProvider(): LlmProvider {
  return {
    name: "image-stub",
    real: false,
    async complete(model: string, input: LlmInput): Promise<LlmCompletion> {
      const prompt = input.messages.at(-1)?.content ?? "";
      // Deterministic placeholder; a real adapter returns a generated asset URL.
      const text = JSON.stringify({
        stub: true,
        model,
        url: `https://images.launchdesk.local/stub/${encodeURIComponent(
          prompt.slice(0, 40),
        )}.png`,
      });
      // Per-image synthetic cost: a flat unit cost (one "image", not tokens).
      // Env-overridable so the IMAGE margin lane is exercisable.
      const raw = process.env.LLM_IMAGE_COST_MICRO?.trim();
      const n = raw ? Number(raw) : NaN;
      const costMicro = BigInt(
        Math.round(Number.isFinite(n) && n > 0 ? n : 2_000_000), // ~R20 wholesale
      );
      return {
        model,
        text,
        usage: { inputTokens: estimateTokens(prompt), outputTokens: 1, costMicro },
      };
    },
  };
}

/**
 * Select the active TEXT/CODE/REASONING provider from env. MOCK by default;
 * OpenRouter when its key is set; else direct Anthropic when its key is set.
 * (Image tasks bypass this and always use the image stub — see router.ts.)
 *
 * Kept for backward-compat (tests + external callers). The router uses
 * selectLlmProviderForTier() for hybrid routing.
 */
export function selectLlmProvider(): LlmProvider {
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouter) return openRouterProvider(openrouter);
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) return anthropicLlmProvider(anthropic);
  return mockLlmProvider();
}

/**
 * Tier-aware provider selection for hybrid routing.
 *
 * CHEAP/IMAGE tiers are OSS-first: their model slugs (Llama, Qwen, Deepseek,
 * Flux) only exist on OpenRouter, so OpenRouter is preferred and Anthropic is
 * the fallback when no OR key is set.
 *
 * CODE/PREMIUM tiers use Anthropic models (claude-sonnet-4-6 / claude-opus-4-8):
 * prefer the direct Anthropic SDK (no intermediary markup); OpenRouter is the
 * fallback when only its key is set (it can route to Anthropic models too).
 *
 * With BOTH keys set: CHEAP/IMAGE go through OpenRouter (cheap OSS), CODE/PREMIUM
 * stay on direct Anthropic (no markup). With only one key set, all tiers fall
 * back to that provider.
 */
export function selectLlmProviderForTier(tier: LlmTier): LlmProvider {
  const openrouter = process.env.OPENROUTER_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  switch (tier) {
    case "CHEAP":
    case "IMAGE":
      if (openrouter) return openRouterProvider(openrouter);
      if (anthropic) return anthropicLlmProvider(anthropic);
      return mockLlmProvider();
    case "CODE":
    case "PREMIUM":
      if (anthropic) return anthropicLlmProvider(anthropic);
      if (openrouter) return openRouterProvider(openrouter);
      return mockLlmProvider();
  }
}

/** The active provider's name (for logging/telemetry — never PII/keys). */
export function activeProviderName(): string {
  return selectLlmProvider().name;
}
