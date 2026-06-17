-- Phase 0 / S7 — Per-tenant slug scoping.
--
-- Previously `generated_sites.slug` was GLOBALLY unique, which let one tenant
-- squat another tenant's business-name slug (and `publish()` keyed off a base-
-- client read by slug, enabling cross-tenant overwrite). We make slug uniqueness
-- PER TENANT instead: drop the global unique index, add a composite unique on
-- (tenantId, slug), and keep a plain slug index for the public host→slug lookup.

-- Drop the global slug uniqueness.
DROP INDEX IF EXISTS "generated_sites_slug_key";

-- Slug is now unique only within a tenant.
CREATE UNIQUE INDEX "generated_sites_tenantId_slug_key" ON "generated_sites"("tenantId", "slug");

-- Plain index for the public, tenant-less getBySlug() resolution.
CREATE INDEX "generated_sites_slug_idx" ON "generated_sites"("slug");
