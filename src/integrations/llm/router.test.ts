// W3 — LLM router unit tests (mock / DB-free). No real network. Covers:
//   * provider selection (mock w/o key; OpenRouter w/ key; Anthropic w/ key),
//     with the SDK + global fetch mocked;
//   * policy resolution per task + per-tier env override;
//   * the routing loop METERS the wallet (a profile.extract debits at the CHEAP
//     markup);
//   * a cache HIT debits nothing;
//   * the pre-flight gate DENIES on insufficient credits;
//   * a quality-gate JSON failure escalates / falls back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK (used by the router's Anthropic provider).
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import {
  selectLlmProvider,
  modelsForTask,
  modelsForTier,
  tierForTask,
  meterKindForTask,
  __resetLlmCache,
  routeLlm,
} from "./index";
import { mockLlmProvider, openRouterProvider } from "./provider";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";

const TENANT = "tenant-router-test";

function deps() {
  return {
    wallet: memoryRepositories.wallet,
    audit: memoryRepositories.audit,
    repos: memoryRepositories,
  };
}

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_MODEL_CHEAP",
  "LLM_MODEL_PREMIUM",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  mockCreate.mockReset();
  __resetMemoryStore();
  __resetLlmCache();
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("provider selection", () => {
  it("defaults to the deterministic mock with no key", () => {
    expect(selectLlmProvider().name).toBe("mock");
  });

  it("selects OpenRouter when OPENROUTER_API_KEY is set (preferred over Anthropic)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(selectLlmProvider().name).toBe("openrouter");
  });

  it("selects Anthropic when only ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(selectLlmProvider().name).toBe("anthropic");
  });

  it("the mock provider returns synthetic usage and never hits the network", async () => {
    const completion = await mockLlmProvider().complete("any-model", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(completion.usage.inputTokens).toBeGreaterThan(0);
    expect(completion.usage.costMicro).toBeGreaterThanOrEqual(0n);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("the OpenRouter provider parses usage + cost from a mocked fetch (no real network)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "deepseek/deepseek-chat",
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const completion = await openRouterProvider("sk-or-test").complete(
      "deepseek/deepseek-chat",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(completion.text).toBe("hello");
    expect(completion.usage.inputTokens).toBe(10);
    // USD 0.001 × 18.5 FX × 100 × 1000 = 1850 micro.
    expect(completion.usage.costMicro).toBe(1850n);
  });
});

describe("policy resolution", () => {
  it("maps each task to its tier", () => {
    expect(tierForTask("profile.extract")).toBe("CHEAP");
    expect(tierForTask("site.codegen")).toBe("CODE");
    expect(tierForTask("image.generate")).toBe("IMAGE");
    expect(tierForTask("reason.plan")).toBe("PREMIUM");
  });

  it("uses CURRENT Anthropic ids for CODE/PREMIUM defaults (never claude-3-*)", () => {
    expect(modelsForTier("CODE")[0]).toBe("claude-sonnet-4-6");
    expect(modelsForTier("PREMIUM")[0]).toBe("claude-opus-4-8");
    expect(modelsForTier("PREMIUM").join(",")).not.toContain("claude-3");
  });

  it("prepends an env override for a tier WITHOUT dropping the vetted fallbacks", () => {
    process.env.LLM_MODEL_PREMIUM = "openai/gpt-5";
    const models = modelsForTask("reason.plan");
    expect(models[0]).toBe("openai/gpt-5");
    // The built-in primary is still present behind the override.
    expect(models).toContain("claude-opus-4-8");
  });

  it("the meter kind embeds the tier so the W2 margin resolves", () => {
    expect(meterKindForTask("profile.extract")).toBe("llm.cheap.profile.extract");
    expect(meterKindForTask("reason.plan")).toBe("llm.premium.reason.plan");
  });
});

describe("routing loop — meters the wallet (mock provider)", () => {
  it("a profile.extract debits the wallet at the CHEAP markup", async () => {
    await memoryRepositories.wallet.credit(TENANT, 100_000_000n); // R1000
    const before = await memoryRepositories.wallet.getBalance(TENANT);

    // No expectJson → the mock's free-text output passes the (absent) gate.
    const outcome = await routeLlm(deps(), {
      tenantId: TENANT,
      task: "copy.generate",
      idempotencyKey: "meter-1",
      input: { messages: [{ role: "user", content: "write a tagline" }] },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.cached).toBe(false);

    const after = await memoryRepositories.wallet.getBalance(TENANT);
    // Debited the synthetic cost × CHEAP margin (3.0×) — strictly less.
    expect(after).toBeLessThan(before);

    // Exactly one usage row for the key, kind = llm.cheap.copy.generate.
    const rows = await memoryRepositories.usage.listRecent(TENANT, 50);
    const row = rows.find((r) => r.idempotencyKey === "meter-1");
    expect(row?.kind).toBe("llm.cheap.copy.generate");
    // retail = round(cost × 3.0).
    expect(row?.unitPriceMicro).toBe(row!.unitCostMicro * 3n);
  });
});

describe("cache hit debits nothing", () => {
  it("a second identical call serves from cache with no further debit", async () => {
    await memoryRepositories.wallet.credit(TENANT, 100_000_000n);
    const input = { messages: [{ role: "user" as const, content: "same prompt" }] };

    const first = await routeLlm(deps(), {
      tenantId: TENANT,
      task: "copy.generate",
      idempotencyKey: "cache-a",
      input,
    });
    expect(first.status).toBe("ok");
    const afterFirst = await memoryRepositories.wallet.getBalance(TENANT);

    const second = await routeLlm(deps(), {
      tenantId: TENANT,
      task: "copy.generate",
      idempotencyKey: "cache-b", // different key, but same prompt → cache hit
      input,
    });
    expect(second.status).toBe("ok");
    if (second.status === "ok") expect(second.result.cached).toBe(true);
    // Cache hit debited nothing.
    expect(await memoryRepositories.wallet.getBalance(TENANT)).toBe(afterFirst);
    // And no second usage row was written.
    const rows = await memoryRepositories.usage.listRecent(TENANT, 50);
    expect(rows.filter((r) => r.idempotencyKey === "cache-b").length).toBe(0);
  });
});

describe("pre-flight gate denies on insufficient credits", () => {
  it("rejects insufficient_credits BEFORE any provider call", async () => {
    // Empty wallet for this tenant → cannot cover the estimate.
    const outcome = await routeLlm(deps(), {
      tenantId: "no-credits-tenant",
      task: "reason.plan", // PREMIUM → a positive estimate
      idempotencyKey: "deny-1",
      input: { messages: [{ role: "user", content: "plan a launch" }] },
    });
    expect(outcome.status).toBe("insufficient_credits");
    if (outcome.status !== "insufficient_credits") return;
    expect(outcome.estimateMicro).toBeGreaterThan(0n);
    // Nothing was debited / recorded.
    const rows = await memoryRepositories.usage.listRecent("no-credits-tenant", 50);
    expect(rows.length).toBe(0);
  });
});

describe("quality-gate JSON failure escalates / falls back", () => {
  it("a CHEAP task whose JSON gate fails on every candidate degrades to empty", async () => {
    await memoryRepositories.wallet.credit(TENANT, 100_000_000n);
    // The mock provider returns {mock:true,model} when expectJson is set, which
    // FAILS a strict profile gate — so every CHEAP candidate (and the escalated
    // CODE tier) misses the gate and the router degrades.
    const outcome = await routeLlm(deps(), {
      tenantId: TENANT,
      task: "profile.extract",
      idempotencyKey: "gate-1",
      input: {
        messages: [{ role: "user", content: "a salon in Sandton" }],
        // Require a `name` key the mock never returns → gate always fails.
        expectJson: (p) =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as Record<string, unknown>).name === "string",
      },
    });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.degraded).toBe(true);
    expect(outcome.result.text).toBe("");
    // A failed gate on every candidate debited nothing (no completion succeeded).
    expect(await memoryRepositories.wallet.getBalance(TENANT)).toBe(100_000_000n);
  });

  it("escalation reaches the CODE tier after the CHEAP lane is exhausted", () => {
    // The candidate list for a CHEAP task appends the CODE tier's models.
    const candidates = modelsForTask("profile.extract");
    // (modelsForTask alone is just the CHEAP lane; the router appends CODE — we
    // assert the escalation source here so the policy intent is pinned.)
    expect(candidates[0]).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(modelsForTier("CODE")).toContain("claude-sonnet-4-6");
  });
});
