// Server-side mock site catalog for M0. The /s/[slug] route renders these
// server-side (real SSR + JSON-LD) so the canonical demo is crawlable today.
// Client-drafted slugs (localStorage) are handled by a client fallback.
// M1/M2 replace this with Postgres-backed published records.

import type { PublishedSites } from "./types";
import { initialBusiness } from "./platformData";
import { buildPublishedSite } from "./siteEngine";

// A deterministic publishedAt keeps SSR output stable across builds.
const SEED_PUBLISHED_AT = "2026-01-01T08:00:00.000Z";

const seedSite = {
  ...buildPublishedSite(initialBusiness),
  publishedAt: SEED_PUBLISHED_AT,
};

export const mockPublishedSites: PublishedSites = {
  [seedSite.slug]: seedSite,
};

export function getMockSite(slug: string) {
  return mockPublishedSites[slug] ?? null;
}

export function mockSiteSlugs(): string[] {
  return Object.keys(mockPublishedSites);
}
