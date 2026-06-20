-- Fix: provision_owner_tenant membership INSERT omitted "id".
-- Prisma's @id @default(cuid()) is client-side only — no DB DEFAULT exists —
-- so the raw INSERT produced a null id, failing with PostgreSQL 23502.
-- We supply gen_random_uuid()::text as the id (valid TEXT primary key, built in
-- to PostgreSQL 13+ which Neon uses; no extension required).
--
-- This also re-applies the updatedAt fix from the prior migration so the
-- function is self-consistent as a single source of truth.

CREATE OR REPLACE FUNCTION provision_owner_tenant(
  tenant_id_in TEXT,
  tenant_name_in TEXT,
  tenant_slug_in TEXT,
  user_id_in TEXT
)
RETURNS TEXT AS $$
BEGIN
  INSERT INTO "tenants" ("id", "name", "slug", "updatedAt")
  VALUES (tenant_id_in, tenant_name_in, tenant_slug_in, NOW())
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "memberships" ("id", "tenantId", "userId", "role")
  VALUES (gen_random_uuid()::text, tenant_id_in, user_id_in, 'owner')
  ON CONFLICT ("tenantId", "userId") DO NOTHING;

  RETURN tenant_id_in;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
