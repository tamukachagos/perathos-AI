import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Anthropic SDK so no real network call is ever made. The mock's
// `create` is controllable per-test via the shared `mockCreate` spy.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  // Default export is the Anthropic client class.
  return {
    default: class {
      messages = { create: mockCreate };
    },
  };
});

import { selectAgentProvider, mockAgentProvider, claudeAgentProvider } from "./provider";
import { generateBusinessProfileWithClaude } from "./claudeProfile";

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_MODEL = process.env.ANTHROPIC_MODEL;

beforeEach(() => {
  mockCreate.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_MODEL === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = ORIGINAL_MODEL;
});

const DESCRIPTION = "We run a small hair salon in Sandton offering cuts and colour.";

describe("selectAgentProvider — dormant without a key", () => {
  it("returns the mock provider when ANTHROPIC_API_KEY is absent", () => {
    const provider = selectAgentProvider();
    expect(provider.name).toBe("mock");
    expect(provider.real).toBe(false);
  });

  it("returns the real Claude provider when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const provider = selectAgentProvider();
    expect(provider.name).toBe("claude");
    expect(provider.real).toBe(true);
  });

  it("the mock provider never calls the SDK", async () => {
    const { profile } = await mockAgentProvider().generateProfile(DESCRIPTION);
    expect(mockCreate).not.toHaveBeenCalled();
    // Heuristic still extracts a known SA location.
    expect(profile.location).toBe("Sandton");
  });
});

describe("Claude profile generation — JSON parse + fallback", () => {
  it("parses strict JSON from the Messages API into a Business profile", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Glow Salon",
            industry: "Beauty & Wellness",
            location: "Sandton",
            offer: "Premium cuts and colour in the heart of Sandton.",
            services: "Cuts, Colour, Styling",
            tone: "Premium and polished",
          }),
        },
      ],
    });

    const { profile, lowConfidence } =
      await claudeAgentProvider().generateProfile(DESCRIPTION);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(profile.name).toBe("Glow Salon");
    expect(profile.industry).toBe("Beauty & Wellness");
    expect(profile.location).toBe("Sandton");
    expect(profile.services).toBe("Cuts, Colour, Styling");
    expect(profile.tone).toBe("Premium and polished");
    // Contact fields are always left blank for the owner to fill in.
    expect(profile.whatsapp).toBe("");
    expect(profile.domain).toBe("");
    expect(profile.email).toBe("");
    // All inferred fields present => nothing flagged low-confidence.
    expect(lowConfidence).toEqual([]);
  });

  it("strips a ```json code fence the model may add", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '```json\n{"name":"Fenced Co","industry":"Retail"}\n```',
        },
      ],
    });
    const { profile } = await claudeAgentProvider().generateProfile(DESCRIPTION);
    expect(profile.name).toBe("Fenced Co");
    expect(profile.industry).toBe("Retail");
  });

  it("falls back to the mock heuristic when the model returns invalid JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
    });
    const { profile } = await claudeAgentProvider().generateProfile(DESCRIPTION);
    // Mock heuristic recognises the salon keyword + Sandton.
    expect(profile.industry).toBe("Beauty & Wellness");
    expect(profile.location).toBe("Sandton");
  });

  it("falls back to the mock heuristic when the API call throws", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockCreate.mockRejectedValue(new Error("network down"));
    const { profile } = await generateBusinessProfileWithClaude(DESCRIPTION);
    expect(profile.industry).toBe("Beauty & Wellness");
    expect(profile.location).toBe("Sandton");
  });

  it("falls back to the mock heuristic when the key is absent (dormant guard)", async () => {
    // No key set. Even calling the Claude impl directly must not hit the SDK.
    const { profile } = await generateBusinessProfileWithClaude(DESCRIPTION);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(profile.location).toBe("Sandton");
  });
});
