// AgentProvider tests (W3 — now routed through the LLM router).
//
// The Claude AgentProvider no longer calls the Anthropic SDK directly; it calls
// routeLlm("profile.extract", …). These tests mock the Anthropic SDK (so the
// router's Anthropic provider is exercised with NO real network) and drive the
// routed path with an in-memory wallet so metering is real. The keyless mock
// path and the anonymous (no-context) path are covered too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK so no real network call is ever made. The router's
// Anthropic provider (provider.ts) constructs `new Anthropic({apiKey})` and
// calls `messages.create`; this controllable spy backs it.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import {
  selectAgentProvider,
  mockAgentProvider,
  claudeAgentProvider,
} from "./provider";
import { generateBusinessProfileWithClaude } from "./claudeProfile";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetLlmCache } from "@/integrations/llm";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_OR = process.env.OPENROUTER_API_KEY;
const TENANT = "tenant-agent-test";

/** A funded metering context backed by the in-memory wallet. */
async function fundedCtx(idempotencyKey: string) {
  await memoryRepositories.wallet.credit(TENANT, 100_000_000n); // R1000
  return {
    wallet: memoryRepositories.wallet,
    audit: memoryRepositories.audit,
    repos: memoryRepositories,
    tenantId: TENANT,
    idempotencyKey,
  };
}

/** A valid Anthropic Messages API response carrying our JSON profile. */
function mockAnthropicJson(obj: Record<string, unknown>) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(obj) }],
    usage: { input_tokens: 120, output_tokens: 60 },
  });
}

beforeEach(() => {
  mockCreate.mockReset();
  __resetMemoryStore();
  __resetLlmCache();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_OR === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_OR;
});

const DESCRIPTION = "We run a small hair salon in Sandton offering cuts and colour.";

describe("selectAgentProvider — dormant without a key", () => {
  it("returns the mock provider when no LLM key is set", () => {
    const provider = selectAgentProvider();
    expect(provider.name).toBe("mock");
    expect(provider.real).toBe(false);
  });

  it("returns the real provider when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const provider = selectAgentProvider();
    expect(provider.name).toBe("claude");
    expect(provider.real).toBe(true);
  });

  it("returns the real provider when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const provider = selectAgentProvider();
    expect(provider.name).toBe("claude");
    expect(provider.real).toBe(true);
  });

  it("the mock provider never touches the SDK and runs the heuristic", async () => {
    const { profile } = await mockAgentProvider().generateProfile(DESCRIPTION);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(profile.location).toBe("Sandton");
  });
});

describe("Claude profile generation — routed through routeLlm + metered", () => {
  it("parses strict JSON from the router into a Business profile AND debits the wallet", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockAnthropicJson({
      name: "Glow Salon",
      industry: "Beauty & Wellness",
      location: "Sandton",
      offer: "Premium cuts and colour in the heart of Sandton.",
      services: "Cuts, Colour, Styling",
      tone: "Premium and polished",
    });

    const ctx = await fundedCtx("profile-1");
    const before = await memoryRepositories.wallet.getBalance(TENANT);

    const { profile, lowConfidence } = await claudeAgentProvider().generateProfile(
      DESCRIPTION,
      ctx,
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(profile.name).toBe("Glow Salon");
    expect(profile.industry).toBe("Beauty & Wellness");
    expect(profile.location).toBe("Sandton");
    expect(profile.whatsapp).toBe("");
    expect(lowConfidence).toEqual([]);

    // The CHEAP-tier call debited the wallet exactly once.
    const after = await memoryRepositories.wallet.getBalance(TENANT);
    expect(after).toBeLessThan(before);
  });

  it("a second identical call is served from cache — debits NOTHING more", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockAnthropicJson({ name: "Cache Co", industry: "Retail" });

    const ctx = await fundedCtx("profile-cache");
    await claudeAgentProvider().generateProfile(DESCRIPTION, ctx);
    const afterFirst = await memoryRepositories.wallet.getBalance(TENANT);
    expect(mockCreate).toHaveBeenCalledOnce();

    // Same description + same model → cache hit. No second SDK call, no debit.
    await claudeAgentProvider().generateProfile(DESCRIPTION, {
      ...ctx,
      idempotencyKey: "profile-cache-2",
    });
    expect(mockCreate).toHaveBeenCalledOnce(); // still once
    expect(await memoryRepositories.wallet.getBalance(TENANT)).toBe(afterFirst);
  });

  it("falls back to the heuristic (degraded) when the model returns invalid JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
      usage: { input_tokens: 50, output_tokens: 10 },
    });
    const ctx = await fundedCtx("profile-bad");
    const result = await claudeAgentProvider().generateProfile(DESCRIPTION, ctx);
    // Heuristic recognises the salon keyword + Sandton; flagged degraded.
    expect(result.profile.industry).toBe("Beauty & Wellness");
    expect(result.profile.location).toBe("Sandton");
    expect(result.degraded).toBe(true);
  });

  it("falls back to the heuristic (degraded) on insufficient credits", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockAnthropicJson({ name: "Broke Co", industry: "Retail" });
    // Wallet has zero balance → pre-flight gate denies before any SDK call.
    const ctx = {
      wallet: memoryRepositories.wallet,
      audit: memoryRepositories.audit,
      repos: memoryRepositories,
      tenantId: "broke-tenant",
      idempotencyKey: "profile-broke",
    };
    const result = await claudeAgentProvider().generateProfile(DESCRIPTION, ctx);
    expect(mockCreate).not.toHaveBeenCalled(); // gated before the call
    expect(result.degraded).toBe(true);
    expect(result.profile.location).toBe("Sandton");
  });

  it("the anonymous (no-context) path uses the heuristic and never routes", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { profile } = await generateBusinessProfileWithClaude(DESCRIPTION);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(profile.location).toBe("Sandton");
  });
});
