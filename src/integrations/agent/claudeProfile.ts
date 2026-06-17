// Real AgentProvider: turn a plain-language business description into a
// structured Business profile via the Anthropic Messages API. This is the LIVE
// counterpart to the mock heuristic in generateProfile.ts — same signature, same
// GeneratedProfile shape, so the onboarding wizard and the AgentProvider adapter
// do not change. It is DORMANT until ANTHROPIC_API_KEY is set; selectAgentProvider()
// picks this impl only when the key is present, otherwise the mock is used.
//
// Robustness contract: on ANY error (missing key, network, bad/invalid JSON,
// refusal, timeout) this falls back to the deterministic mock heuristic so the
// wizard always returns a usable draft. The API key and the raw description are
// never logged.

import Anthropic from "@anthropic-ai/sdk";
import type { Business } from "@/lib/types";
import { deriveProfile, type GeneratedProfile } from "./generateProfile";

// Current Anthropic model id. Default Sonnet 4.6; override via ANTHROPIC_MODEL.
// (Do NOT use any claude-3-* id — those are outdated.)
const DEFAULT_MODEL = "claude-sonnet-4-6";

/** The descriptive fields Claude fills. Contact fields stay blank for the owner. */
interface ClaudeProfileShape {
  name: string;
  industry: string;
  location: string;
  offer: string;
  services: string;
  tone: string;
}

const SYSTEM_PROMPT = [
  "You are an onboarding assistant for Launch Desk, a platform that helps small",
  "South African businesses get online. Given a plain-language description of a",
  "business, extract a structured profile.",
  "",
  "Return ONLY a JSON object (no markdown, no prose, no code fences) with EXACTLY",
  "these string keys:",
  '  "name"      — the business name (best guess from the text).',
  '  "industry"  — a concise industry label, e.g. "Beauty & Wellness",',
  '                "Food & Hospitality", "Trades & Services", "Retail".',
  '  "location"  — the city/town in South Africa, or "" if not stated.',
  '  "offer"     — a single-sentence value proposition (max ~280 chars).',
  '  "services"  — a short comma-separated list of services offered (max 6).',
  '  "tone"      — the brand voice in a few words, e.g. "Warm and professional",',
  '                "Premium and polished", "Friendly and affordable".',
  "",
  "Every value MUST be a string. Use an empty string for anything you cannot infer.",
  "Do not invent contact details. Do not include any keys other than the six above.",
].join("\n");

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Parse + validate the model's JSON into a partial Business. Throws on anything
 * that is not a well-formed object with usable string fields (the caller then
 * falls back to the mock). Strips code fences defensively.
 */
function parseProfile(raw: string): ClaudeProfileShape {
  let text = raw.trim();
  // Defensive: strip a ```json ... ``` fence if the model added one despite the
  // instruction not to.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();

  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("model_output_not_object");
  }
  const o = parsed as Record<string, unknown>;
  // At minimum we need a usable name or industry to consider the call a success;
  // otherwise the mock heuristic does a better job.
  if (!isNonEmptyString(o.name) && !isNonEmptyString(o.industry)) {
    throw new Error("model_output_empty");
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    name: str(o.name).trim(),
    industry: str(o.industry).trim(),
    location: str(o.location).trim(),
    offer: str(o.offer).trim(),
    services: str(o.services).trim(),
    tone: str(o.tone).trim(),
  };
}

/** Which inferred fields the model left blank — surfaced for the review step. */
function lowConfidenceFor(p: ClaudeProfileShape): (keyof Business)[] {
  const low: (keyof Business)[] = [];
  if (!p.name) low.push("name");
  if (!p.industry) low.push("industry");
  if (!p.location) low.push("location");
  if (!p.services) low.push("services");
  return low;
}

/**
 * Generate a Business profile via Claude. Mirrors generateBusinessProfile()'s
 * signature. On any failure, returns the mock heuristic's result so the wizard is
 * never blocked.
 */
export async function generateBusinessProfileWithClaude(
  description: string,
): Promise<GeneratedProfile> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  // Dormant guard: without a key, defer to the mock. (selectAgentProvider() also
  // gates this, but the direct guard keeps this function safe if called alone.)
  if (!apiKey) return deriveProfile(description);

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: description }],
    });

    // Concatenate text blocks (Claude returns content as a block array).
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    if (!text) throw new Error("empty_response");

    const claude = parseProfile(text);
    const profile: Business = {
      name: claude.name,
      industry: claude.industry,
      location: claude.location,
      offer: claude.offer,
      services: claude.services,
      tone: claude.tone || "Warm and professional",
      // Contact fields always need explicit owner input; left blank for review,
      // exactly like the mock.
      whatsapp: "",
      domain: "",
      email: "",
    };
    return { profile, lowConfidence: lowConfidenceFor(claude) };
  } catch {
    // Never log the key or the raw description/PII. Fall back to the mock so the
    // wizard always returns a usable draft.
    return deriveProfile(description);
  }
}
