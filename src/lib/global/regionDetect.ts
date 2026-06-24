// src/lib/global/regionDetect.ts
import { COUNTRY_LOCALE, COUNTRY_CURRENCY, COUNTRY_REGION, COUNTRY_TIMEZONE } from "./config";

export interface DetectedGeoContext {
  countryCode: string;
  locale: string;
  currency: string;
  region: string;
  timezone: string;
}

export function detectFromHeaders(headers: Headers): DetectedGeoContext {
  const countryCode = (
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    "US"
  ).toUpperCase();
  return {
    countryCode,
    locale:   COUNTRY_LOCALE[countryCode]   ?? "en",
    currency: COUNTRY_CURRENCY[countryCode] ?? "USD",
    region:   COUNTRY_REGION[countryCode]   ?? "us-east",
    timezone: COUNTRY_TIMEZONE[countryCode] ?? "UTC",
  };
}

export function parseAcceptLanguage(header: string | null): string {
  if (!header) return "en";
  const supported = ["en","es","pt","pt-BR","fr","de","it","nl","ar","zh","ja","ko","hi","ru","tr","sw","af"];
  for (const l of header.split(",").map(s => s.split(";")[0].trim())) {
    if (supported.includes(l)) return l;
    const base = l.split("-")[0];
    if (supported.includes(base)) return base;
  }
  return "en";
}
