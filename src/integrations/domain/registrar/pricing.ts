// W4 — Registrar pricing config (ENTERPRISE_REVIEW §8 resale spreads). CONFIG.
//
// Per §8: ".co.za wholesale ~R65–90/yr sell R149; .com wholesale ~R150–220/yr
// sell R249". These are the per-backend defaults, env-overridable because real
// wholesale costs + FX churn. Prices are ZAR CENTS (integer). The verb layer
// converts the retail price to micro-cents for the wallet/metering markup.
//
// Pure: no DB, no secrets, no network. The mock backends read from here so the
// availability quote is deterministic and the resale spread is visible in tests.

function envCents(name: string, fallbackRand: number): number {
  const raw = process.env[name]?.trim();
  const fallback = Math.round(fallbackRand * 100);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** ZACR (.co.za) retail price, ZAR cents. Default R149. */
export function zaRetailCents(): number {
  return envCents("LD_DOMAIN_ZA_PRICE_CENTS", 149);
}
/** ZACR (.co.za) wholesale cost, ZAR cents. Default R80 (mid of R65–90). */
export function zaCostCents(): number {
  return envCents("LD_DOMAIN_ZA_COST_CENTS", 80);
}
/** gTLD (.com etc.) retail price, ZAR cents. Default R249. */
export function gtldRetailCents(): number {
  return envCents("LD_DOMAIN_GTLD_PRICE_CENTS", 249);
}
/** gTLD (.com etc.) wholesale cost, ZAR cents. Default R185 (mid of R150–220). */
export function gtldCostCents(): number {
  return envCents("LD_DOMAIN_GTLD_COST_CENTS", 185);
}
