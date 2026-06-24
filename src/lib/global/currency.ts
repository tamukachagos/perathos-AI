// src/lib/global/currency.ts
// Shared currency formatting and plan-price helpers.
// formatCents: convert integer cents → human-readable string for any currency.
// getPlanPrice: return plan price in the given currency's smallest unit.

import { CURRENCY_META, PLAN_PRICE_OVERRIDES } from "@/lib/global/config";

/**
 * Format an integer amount (in the currency's smallest unit, e.g. cents) as a
 * human-readable string.  Falls back to ZAR "R X.XX" for unknown currencies.
 *
 * Examples:
 *   formatCents(1499, "USD")  → "$14.99"
 *   formatCents(14900, "ZAR") → "R149.00"
 *   formatCents(1500, "JPY")  → "¥1500"
 */
export function formatCents(amount: number, currency: string): string {
  const meta = CURRENCY_META[currency];
  if (!meta) {
    // Unknown currency — render raw with code prefix
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }

  const { symbol, decimals, symbolBefore } = meta;
  const value = decimals === 0 ? amount : amount / 100;
  const formatted = value.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return symbolBefore ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

/**
 * Return the plan price (in the currency's smallest unit) for a given currency.
 * Uses PLAN_PRICE_OVERRIDES for known local prices; falls back to USD converted
 * at a rough factor if no override is available.
 *
 * Default USD prices (cents):
 *   growth: $9.99/mo → 999
 *   pro:    $19.99/mo → 1999
 */
const USD_DEFAULTS: Record<string, number> = {
  growth: 999,
  pro: 1999,
};

export function getPlanPrice(plan: "growth" | "pro", currency: string): number {
  const override = PLAN_PRICE_OVERRIDES[currency];
  if (override) return override[plan];
  // Fall back to USD price expressed in the target currency — use 1:1 for
  // simplicity (real FX is handled server-side via middleware).
  return USD_DEFAULTS[plan];
}
