-- W6 — GitHub + Vercel per-customer repos & deploys (ENTERPRISE_REVIEW §5.3).
--
-- Adds two tenant-owned tables:
--   * site_repos  — one operator-owned private GitHub repo per customer site
--     (launchdesk-sites/{slug}). GitHub is the single source of truth; the owner
--     never sees Git. repoRef/repoUrl/defaultBranch carry the repo identity;
--     lastCommitSha ties a publish (a commit) back to the site_versions history.
--   * deployments — one StaticTier (Vercel) deploy attempt per publish. A deploy
--     is GATED + ASYNC: the ActionRouter starts a W1 operation (operationId) and
--     returns 202; the Vercel webhook (or the reconcile cron in mock) settles it
--     to live/failed and updates status + url here. target='static' in W6;
--     container/K8s tiers are Phase 3 (target is plain TEXT so they need no enum
--     migration). providerDeploymentId correlates the inbound Vercel webhook.
--
-- Both tables are tenant-owned -> RLS (ENABLE + FORCE + tenant_isolation policy),
-- mirroring the M1/W1/W2/W4/W8 backstop so cross-tenant IDOR is closed at the DB
-- layer even if an app-layer scope is ever missed.
--
-- TYPE NOTES (the W1/W2 lessons):
--   * This migration adds NO SQL function taking a timestamp parameter, so the
--     TIMESTAMPTZ-binding / count-as-BIGINT rules do not apply here. All timestamp
--     columns are plain TIMESTAMP(3), matching every other Prisma DateTime column.
--   * version is a plain INTEGER (the site_versions.version it published).

-- =========================================================================
-- Enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('queued', 'building', 'live', 'failed');

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateTable
CREATE TABLE "site_repos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "repoRef" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "lastCommitSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'static',
    "status" "DeploymentStatus" NOT NULL DEFAULT 'queued',
    "url" TEXT,
    "operationId" TEXT,
    "version" INTEGER,
    "providerDeploymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_repos_tenantId_slug_key" ON "site_repos"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "site_repos_tenantId_idx" ON "site_repos"("tenantId");

-- CreateIndex
CREATE INDEX "deployments_tenantId_idx" ON "deployments"("tenantId");

-- CreateIndex
CREATE INDEX "deployments_slug_idx" ON "deployments"("slug");

-- CreateIndex
CREATE INDEX "deployments_operationId_idx" ON "deployments"("operationId");

-- CreateIndex
CREATE INDEX "deployments_providerDeploymentId_idx" ON "deployments"("providerDeploymentId");

-- AddForeignKey
ALTER TABLE "site_repos" ADD CONSTRAINT "site_repos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security — both tables are tenant-owned and tenant-isolated
-- (mirrors the M1/W1/W2/W4/W8 backstop). ENABLE + FORCE so even the table owner
-- is subject to the policy, scoped to current_tenant_id() (the per-transaction
-- setting withTenant() sets).
-- =========================================================================

ALTER TABLE "site_repos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_repos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "site_repos"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "deployments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deployments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deployments"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- =========================================================================
-- Vercel webhook tenant resolution (mirrors W1's subscription_tenant_by_provider).
--
-- The signed Vercel deploy webhook has NO tenant session: it correlates an
-- inbound deployment.succeeded/error event to a Deployment row by its vendor-side
-- providerDeploymentId, which is global, not tenant-scoped. Under FORCE RLS a
-- base-client read on `deployments` returns 0 rows for the non-bypass app role,
-- so this tightly-scoped SECURITY DEFINER function resolves the owning tenantId
-- (and the deployment id) for a providerDeploymentId; the webhook then enters
-- withTenant(tenantId) for the actual settle. It returns NULL when unknown and
-- cannot read or mutate anything else, so it does not widen the app role.
-- =========================================================================

CREATE OR REPLACE FUNCTION deployment_owner_by_provider_id(provider_deploy_id_in TEXT)
RETURNS TABLE("tenantId" TEXT, "id" TEXT) AS $$
  SELECT "tenantId", "id" FROM "deployments"
  WHERE "providerDeploymentId" = provider_deploy_id_in
  LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;
