// W2 — Metering config (margins, markups, units). CONFIG, NOT CODE.
//
// Per ENTERPRISE_REVIEW §6/§8: margin lives in the credit→cost spread, with
// a per-tier multiplier (a fat multiple on tiny-absolute cheap volume, near
// pass-through on premium so no single Opus call feels punitive), plus hosting
// and domain markups. These are env-overridable because real costs/FX churn —
// the service reads from here, never hardcodes a number.
//
// Pure: no DB, no secrets, no UI. Importable by the ActionRouter (which must
// avoid the Auth.js chain) and by Vitest unit tests.

/** Money is ZAR MICRO-CENTS everywhere: 1 cent = 1_000 micro; R1 = 100_000. */
export const MICRO_PER_CENT = 1_000n;
export const MICRO_PER_RAND = 100_000n;

/** The LLM tiers (§6). The metering `kind` for an LLM call maps to one of these. */
export type MarginTier = "CHEAP" | "CODE" | "IMAGE" | "PREMIUM";

/**
 * Per-tier retail margin multiplier (retail = round(cost × multiplier)). Defaults
 * follow §6/§8; each is overridable via env (LD_MARGIN_CHEAP etc.) so margins can
 * be re-priced without a deploy. A multiplier < 1 is clamped to 1 (never sell
 * below cost).
 */
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function marginMultiplier(tier: MarginTier): number {
  switch (tier) {
    case "CHEAP":
      return Math.max(1, envFloat("LD_MARGIN_CHEAP", 3.0));
    case "CODE":
      return Math.max(1, envFloat("LD_MARGIN_CODE", 1.6));
    case "IMAGE":
      return Math.max(1, envFloat("LD_MARGIN_IMAGE", 1.8));
    case "PREMIUM":
      return Math.max(1, envFloat("LD_MARGIN_PREMIUM", 1.4));
  }
}

/** Hosting + domain markups (§8): "~40–60% markup" on hosting; domains marked up. */
export function hostingMarkup(): number {
  return Math.max(1, envFloat("LD_MARKUP_HOSTING", 1.5)); // 50% markup
}
export function domainMarkup(): number {
  return Math.max(1, envFloat("LD_MARKUP_DOMAIN", 1.6));
}

/**
 * Map a metering `kind` to its margin multiplier. LLM kinds are namespaced
 * `llm.<tier>.*` or carry a tier; hosting/domain use their markups; anything
 * unknown falls back to the most conservative (PREMIUM-ish near-passthrough is
 * wrong here — an UNKNOWN cost should be marked up defensively, so we use the
 * CHEAP multiple as the safe default for unclassified small events).
 */
export function multiplierForKind(kind: string): number {
  const ns = kind.split(".")[0];
  if (ns === "hosting") return hostingMarkup();
  if (ns === "domain") return domainMarkup();
  if (ns === "whatsapp") return whatsappMarkup();
  if (ns === "llm") {
    // llm.<tier>.* — tier is the SECOND segment when present.
    const seg = kind.split(".")[1]?.toUpperCase();
    if (seg === "CHEAP" || seg === "CODE" || seg === "IMAGE" || seg === "PREMIUM") {
      return marginMultiplier(seg);
    }
    return marginMultiplier("CHEAP");
  }
  return marginMultiplier("CHEAP");
}

/**
 * Compute the retail unit price (micro-cents) from a wholesale unit cost and a
 * margin multiplier, rounded to the nearest micro-cent. Uses BigInt-safe
 * rounding: round(cost × mult) = (cost × scaledMult + scale/2) / scale.
 */
export function applyMargin(unitCostMicro: bigint, multiplier: number): bigint {
  // Scale the float multiplier to an integer with 1e6 precision so the whole
  // calculation stays in BigInt (no float drift on large costs).
  const SCALE = 1_000_000n;
  const scaledMult = BigInt(Math.round(multiplier * 1_000_000));
  const numerator = unitCostMicro * scaledMult + SCALE / 2n;
  return numerator / SCALE;
}

/**
 * The Paystack SKU used when a wallet top-up is paid for real (vs. a plan
 * subscription). The checkout path reuses createCheckout (§6: "top-ups reuse
 * the Paystack createCheckout path as a token_topup SKU"); mock now.
 */
export const TOKEN_TOPUP_SKU = "token_topup";

// --- W8 WhatsApp per-message pricing (Meta 2025 per-template model) ----------

/**
 * Meta's 2025 WhatsApp Business pricing moved from per-CONVERSATION to
 * per-TEMPLATE-MESSAGE for marketing/utility/authentication, while SERVICE
 * conversations (a business reply to a user-initiated message inside the 24-hour
 * customer-service window) are FREE. We model exactly that here:
 *   * "service"       → FREE (replies inside the 24h window). Cost 0.
 *   * "utility"       → charged per delivered template message.
 *   * "authentication"→ charged per delivered template message.
 *   * "marketing"     → charged per delivered template message (the priciest).
 *
 * Prices are the WHOLESALE per-message cost in ZAR micro-cents (what the
 * operator pays the BSP/Meta); the wallet then applies the WhatsApp markup on
 * top. Defaults are SA-anchored placeholders, env-overridable because Meta's
 * rate card + FX churn. They are conservative and meant to be re-priced without
 * a deploy — never hardcoded at a call site.
 */
export type WhatsappMessageCategory =
  | "service"
  | "utility"
  | "authentication"
  | "marketing";

/** Wholesale per-message cost (ZAR micro-cents) for a message category. */
export function whatsappMessageCostMicro(
  category: WhatsappMessageCategory,
): bigint {
  // Service replies inside the 24h window are free under Meta's 2025 model.
  if (category === "service") return 0n;
  const map: Record<Exclude<WhatsappMessageCategory, "service">, [string, bigint]> = {
    // ~R0.14 / utility, ~R0.14 / auth, ~R0.50 / marketing (placeholder ZAR).
    utility: ["LD_WA_COST_UTILITY_MICRO", 14_000n],
    authentication: ["LD_WA_COST_AUTH_MICRO", 14_000n],
    marketing: ["LD_WA_COST_MARKETING_MICRO", 50_000n],
  };
  const [envName, fallback] = map[category];
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  try {
    const n = BigInt(raw);
    return n >= 0n ? n : fallback;
  } catch {
    return fallback;
  }
}

/** The WhatsApp per-message retail markup multiplier (§8 markup pattern). */
export function whatsappMarkup(): number {
  return Math.max(1, envFloat("LD_MARKUP_WHATSAPP", 2.0)); // 2× on tiny absolute
}

/**
 * Format ZAR micro-cents as a display string, e.g. 1_000_000n → "R10.00".
 * Owner-facing UX shows RAND only — never tokens or model names (§6). Rounds to
 * the nearest cent for display (the ledger stays micro-exact underneath).
 */
export function formatMicroZar(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  // micro-cents → cents (round to nearest cent), then → rand with 2 decimals.
  const cents = (abs + MICRO_PER_CENT / 2n) / MICRO_PER_CENT;
  const rand = Number(cents) / 100;
  const formatted = rand.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "-" : ""}R${formatted}`;
}

/** The current billing period key, "YYYY-MM", for a given date (default now). */
export function currentPeriod(at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Per-verb pre-flight cost ESTIMATE (micro-cents) for the ActionRouter credit
 * gate. W2 ships a simple map; W3/W5 supply real numbers from the LLM router /
 * hosting catalog. A verb absent here costs nothing to gate (estimate 0), so
 * free verbs are never blocked. Values are conservative upper bounds in ZAR
 * micro-cents (e.g. a domain.register ≈ R249 retail → 24_900_000 micro).
 */
const VERB_ESTIMATE_MICRO: Record<string, bigint> = {
  "domain.register": 24_900_000n, // ~R249 retail
  "domain.transfer": 24_900_000n,
  "domain.renew": 24_900_000n,
  "hosting.deploy": 5_000_000n, // ~R50 estimated deploy/build cost
  "hosting.provision": 50_000_000n, // ~R500 (managed tier guard)
  "email.provision": 2_000_000n, // ~R20
};

/** The estimated worst-case cost of a verb, in micro-cents (0 if none/unknown). */
export function estimateVerbCostMicro(verb: string): bigint {
  return VERB_ESTIMATE_MICRO[verb] ?? 0n;
}
