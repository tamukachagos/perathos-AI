// Shared seed data for the in-memory repository (and the Postgres seed script).
//
// The mock repo is seeded with the Maboneng sample so the dashboard and the
// public /s/[slug] route have real content with NO database — exactly the M0
// experience, now flowing through the repository interface.

import { initialBusiness } from "@/lib/platformData";
import { buildPublishedSite } from "@/lib/siteEngine";
import type { BusinessRecord, SiteRecord } from "./types";

/** Stable ids so seeded data is deterministic across reloads/builds. */
export const DEV_TENANT_ID = "dev-tenant";
export const DEV_USER_ID = "dev-user";
export const DEV_USER_EMAIL = "owner@example.com";

const SEED_BUSINESS_ID = "seed-business-maboneng";
const SEED_PUBLISHED_AT = "2026-01-01T08:00:00.000Z";

export function seedBusiness(): BusinessRecord {
  return {
    id: SEED_BUSINESS_ID,
    tenantId: DEV_TENANT_ID,
    ...initialBusiness,
  };
}

export function seedSite(): SiteRecord {
  const built = buildPublishedSite(initialBusiness);
  const site = { ...built, publishedAt: SEED_PUBLISHED_AT };
  return {
    id: "seed-site-maboneng",
    tenantId: DEV_TENANT_ID,
    businessId: SEED_BUSINESS_ID,
    slug: site.slug,
    version: 1,
    site,
  };
}
