-- =========================================================================
-- Tenant bootstrap helpers.
--
-- Auth.js signs the user in before the application knows the tenant. With FORCE
-- RLS enabled, an unscoped app-role query against memberships returns zero rows
-- by design, so tenant lookup/bootstrap must go through narrow SECURITY DEFINER
-- helpers. The app still derives user_id from the authenticated session; these
-- functions only resolve or create that user's own owner tenant.
-- =========================================================================

CREATE OR REPLACE FUNCTION primary_tenant_for_user(user_id_in TEXT)
RETURNS TABLE("tenantId" TEXT) AS $$
  SELECT "tenantId" FROM "memberships"
  WHERE "userId" = user_id_in
  ORDER BY "createdAt" ASC
  LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION provision_owner_tenant(
  tenant_id_in TEXT,
  tenant_name_in TEXT,
  tenant_slug_in TEXT,
  user_id_in TEXT
)
RETURNS TEXT AS $$
BEGIN
  INSERT INTO "tenants" ("id", "name", "slug")
  VALUES (tenant_id_in, tenant_name_in, tenant_slug_in)
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "memberships" ("tenantId", "userId", "role")
  VALUES (tenant_id_in, user_id_in, 'owner')
  ON CONFLICT ("tenantId", "userId") DO NOTHING;

  RETURN tenant_id_in;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
