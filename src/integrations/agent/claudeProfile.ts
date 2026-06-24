// Real AgentProvider: turn a plain-language business description into a
// structured Business profile. W3: this now routes through the LLM router
// (routeLlm("profile.extract", …)) instead of calling the Anthropic SDK
// directly, so EVERY model call goes through the one chokepoint — provider
// selection, the task→tier→model policy (CHEAP tier for extraction), the
// pre-flight credit gate, caching, the JSON quality gate, metering, and audit.
//
// Same signature + same GeneratedProfile shape, so the onboarding wizard and the
// AgentProvider adapter do not change. It stays MOCK-safe with no keys/DB: the
// router's mock provider returns synthetic usage, and a metering context is
// OPTIONAL — the anonymous wizard route routes without a wallet debit; the
// tenant-scoped adapter verb (agent.generateProfile) passes a context so the
// onboarding action meters credits.
//
// Robustness contract (unchanged from B12): on ANY failure (provider error,
// twice-failed quality gate, bad/empty/invalid JSON, refusal) it falls back to
// the deterministic mock heuristic and surfaces `degraded:true`. The key and the
// raw description are never logged.

import type { Business } from "@/lib/types";
import type { Repositories } from "@/lib/db/types";
import { deriveProfile, type GeneratedProfile } from "./generateProfile";

// NOTE: the LLM router (and its server-only metering deps — node:crypto via the
// billing chain) is loaded with a DYNAMIC import inside the routed branch only,
// NOT a top-level import. claudeProfile.ts is reachable from the client bundle
// (Dashboard → agent registry → provider → here), so a static import of the
// router would drag server-only modules into the client build and fail
// `next build`. The dynamic import keeps the chain server-side, mirroring the
// lazy Prisma import in src/lib/db/index.ts.

/**
 * Optional metering context. When present (the tenant-scoped adapter path) the
 * router meters the call against the tenant's W2 wallet and applies the
 * pre-flight credit gate. When absent (the anonymous pre-sign-in wizard route)
 * the call is routed but NOT metered/gated — there is no tenant to charge.
 */
export interface AgentMeterContext {
  wallet: Repositories["wallet"];
  audit: Repositories["audit"];
  repos: Repositories;
  tenantId: string;
  idempotencyKey: string;
  /** BCP-47 locale for generated offer/services text. Defaults to "en". */
  locale?: string;
  /** ISO 3166-1 alpha-2 country code for cultural localisation. Defaults to "US". */
  countryCode?: string;
}

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

/** The quality-gate predicate: a usable object with at least a name or industry. */
function looksLikeProfile(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return isNonEmptyString(o.name) || isNonEmptyString(o.industry);
}

/**
 * Parse the router's text output into a ClaudeProfileShape. Throws on anything
 * not a well-formed object with a usable name/industry (caller falls back to the
 * mock). Strips a ```json fence defensively. The router's quality gate already
 * runs `looksLikeProfile`, so this is the post-gate extraction.
 */
function parseProfile(raw: string): ClaudeProfileShape {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();

  const parsed: unknown = JSON.parse(text);
  if (!looksLikeProfile(parsed)) throw new Error("model_output_empty");
  const o = parsed as Record<string, unknown>;
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
 * Generate a Business profile via the LLM router. Mirrors
 * generateBusinessProfile()'s signature; an optional metering context routes the
 * call through the tenant's wallet (gate + meter). On any failure — including
 * `insufficient_credits` — it returns the mock heuristic's result with
 * `degraded:true` so the wizard is never blocked.
 */
export async function generateBusinessProfileWithClaude(
  description: string,
  ctx?: AgentMeterContext,
): Promise<GeneratedProfile> {
  // Dormant/mock-safe: without a metering context we still ROUTE (the router's
  // mock provider runs with no keys), but we cannot meter (no tenant/wallet). We
  // therefore only take the routed path when a context is present; the keyless
  // pre-sign-in wizard route falls through to the mock heuristic directly, which
  // is the same behaviour it has always had with no key.
  if (!ctx) {
    // No tenant to charge and the wizard runs pre-sign-in. Keep the prior
    // behaviour: defer to the deterministic mock heuristic. (A future
    // anonymous-but-rate-limited routed path can drop in here unchanged.)
    return deriveProfile(description);
  }

  try {
    // Lazy import: keeps the router + server-only billing deps out of the
    // client bundle (see the note at the top of this file).
    const { routeLlm } = await import("@/integrations/llm");

    // Build locale-aware user message: append language instruction for non-English.
    const locale = ctx.locale ?? "en";
    const countryCode = ctx.countryCode ?? "US";
    const langSuffix = locale !== "en"
      ? `\n\nGenerate the "offer" and "services" fields in ${locale} language, culturally appropriate for ${countryCode}. All other fields (name, industry, location, tone) may remain in English.`
      : "";
    const userMessage = description + langSuffix;

    const outcome = await routeLlm(
      { wallet: ctx.wallet, audit: ctx.audit, repos: ctx.repos },
      {
        tenantId: ctx.tenantId,
        task: "profile.extract",
        idempotencyKey: ctx.idempotencyKey,
        input: {
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
          maxTokens: 1024,
          expectJson: looksLikeProfile,
        },
      },
    );

    if (outcome.status === "insufficient_credits") {
      // Gated out before any model call — fall back to the heuristic, degraded.
      const fallback = deriveProfile(description);
      return { ...fallback, degraded: true };
    }

    const { result } = outcome;
    // The router degraded (every candidate failed / empty text) — heuristic.
    if (result.degraded && !result.text) {
      const fallback = deriveProfile(description);
      return { ...fallback, degraded: true };
    }

    const claude = parseProfile(result.text);
    const profile: Business = {
      name: claude.name,
      industry: claude.industry,
      location: claude.location,
      offer: claude.offer,
      services: claude.services,
      tone: claude.tone || "Warm and professional",
      whatsapp: "",
      domain: "",
      email: "",
    };
    return {
      profile,
      lowConfidence: lowConfidenceFor(claude),
      // Surface a router-side escalation/fallback as degraded (B12 parity).
      ...(result.degraded ? { degraded: true } : {}),
    };
  } catch {
    // A post-route parse failure (the gate passed but extraction still threw) —
    // fall back to the heuristic, degraded. The router already logged the
    // provider/quality class (PII-free); nothing is logged here.
    const fallback = deriveProfile(description);
    return { ...fallback, degraded: true };
  }
}
