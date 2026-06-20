-- Fix: provision_owner_tenant omitted "updatedAt" from the tenants INSERT.
-- Prisma's @updatedAt is client-side only — no DB DEFAULT exists for that
-- column — so the raw SQL INSERT failed with PostgreSQL error 23502 (NOT NULL
-- violation) on every first-time sign-in, blocking users from reaching the
-- dashboard after clicking their magic link.

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

  INSERT INTO "memberships" ("tenantId", "userId", "role")
  VALUES (tenant_id_in, user_id_in, 'owner')
  ON CONFLICT ("tenantId", "userId") DO NOTHING;

  RETURN tenant_id_in;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
