// Mock AgentProvider: turn a plain-language business description into a
// structured Business profile (M3 onboarding wizard). In M4 this becomes a real
// Claude call behind the same signature; the wizard does not change.
//
// The mock is deliberately deterministic and heuristic (keyword + simple NLP),
// so the wizard is fully exercisable with no API key. It returns a partial
// profile the USER reviews and edits before it populates the dashboard.

import type { Business } from "@/lib/types";

export interface GeneratedProfile {
  /** A best-effort structured profile derived from free text. */
  profile: Business;
  /** Which fields the model is least sure about (surfaced for review). */
  lowConfidence: (keyof Business)[];
}

const INDUSTRY_KEYWORDS: Array<{ match: RegExp; industry: string }> = [
  { match: /\b(spa|massage\w*|wellness|beauty|salon|nails?|hair)\b/i, industry: "Beauty & Wellness" },
  { match: /\b(restaurant|caf[eé]|food|cater\w*|kitchen|bakery|takeaway)\b/i, industry: "Food & Hospitality" },
  { match: /\b(plumb\w*|electric\w*|builder|construct\w*|handyman|paint\w*|repair\w*)\b/i, industry: "Trades & Services" },
  { match: /\b(tutor\w*|school|teach\w*|coach\w*|train\w*|lesson\w*)\b/i, industry: "Education & Training" },
  { match: /\b(clean\w*|laundry|domestic)\b/i, industry: "Cleaning Services" },
  { match: /\b(photograph\w*|design\w*|brand\w*|market\w*|creative|studio)\b/i, industry: "Creative & Media" },
  { match: /\b(shop|store|retail|clothing|boutique|sell\w*)\b/i, industry: "Retail" },
  { match: /\b(consult\w*|account\w*|legal|advis\w*|finance|bookkeep\w*)\b/i, industry: "Professional Services" },
];

// A small set of SA towns/cities to opportunistically extract a location.
const LOCATION_KEYWORDS = [
  "Johannesburg", "Cape Town", "Durban", "Pretoria", "Soweto", "Maboneng",
  "Sandton", "Port Elizabeth", "Gqeberha", "Bloemfontein", "Polokwane",
  "Nelspruit", "Kimberley", "East London", "Stellenbosch", "Centurion",
];

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function firstSentence(text: string): string {
  const m = text.match(/[^.!?\n]+[.!?]?/);
  return (m?.[0] ?? text).trim();
}

/**
 * Heuristic extraction. Pure + synchronous so it is trivially testable and
 * runs anywhere. The async wrapper below mirrors the real (network) shape.
 */
export function deriveProfile(description: string): GeneratedProfile {
  const text = description.trim();
  const lowConfidence: (keyof Business)[] = [];

  // Name: a quoted phrase, or "called X", or "named X", else first 3-4 words.
  let name = "";
  const quoted = text.match(/["“']([^"”']{2,60})["”']/);
  const called = text.match(/\b(?:called|named)\s+([A-Z0-9][\w&'’ -]{1,50})/);
  if (quoted) {
    name = quoted[1].trim();
  } else if (called) {
    name = called[1].trim().replace(/[.,;]+$/, "");
  } else {
    name = titleCase(text.split(/\s+/).slice(0, 3).join(" ")).slice(0, 60);
    lowConfidence.push("name");
  }

  // Industry: keyword scan.
  const industryHit = INDUSTRY_KEYWORDS.find((k) => k.match.test(text));
  const industry = industryHit?.industry ?? "General Services";
  if (!industryHit) lowConfidence.push("industry");

  // Location: known SA place, else blank for review.
  const location =
    LOCATION_KEYWORDS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text)) ?? "";
  if (!location) lowConfidence.push("location");

  // Offer: the first sentence makes a reasonable one-line value prop.
  const offer = firstSentence(text).slice(0, 280) || text.slice(0, 280);

  // Services: split on commas / "and" within service-like context.
  const servicesMatch = text.match(/\b(?:offer|provide|services?|do)\b[:\s]+([^.!?\n]+)/i);
  const services = servicesMatch
    ? servicesMatch[1]
        .split(/,|\band\b/i)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join(", ")
    : "";
  if (!services) lowConfidence.push("services");

  // Tone: light sentiment.
  const tone = /\b(luxur|premium|high-end|exclusive)\b/i.test(text)
    ? "Premium and polished"
    : /\b(affordable|cheap|budget|value)\b/i.test(text)
      ? "Friendly and affordable"
      : "Warm and professional";

  const profile: Business = {
    name,
    industry,
    location,
    offer,
    services,
    tone,
    // These need explicit input from the owner; left blank for the review step.
    whatsapp: "",
    domain: "",
    email: "",
  };

  return { profile, lowConfidence };
}

/**
 * Async wrapper matching the real (network) AgentProvider shape. The wizard and
 * the AgentProvider adapter both call this; M4 swaps the body for a Claude call.
 */
export async function generateBusinessProfile(
  description: string,
): Promise<GeneratedProfile> {
  return deriveProfile(description);
}
