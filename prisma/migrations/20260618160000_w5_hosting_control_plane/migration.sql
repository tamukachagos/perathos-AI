-- W5 — Hosting reseller control plane (ENTERPRISE_REVIEW §5.2 + Part 3.A).
--
-- Adds two tenant-owned tables:
--   * hosting_deployments — one managed-hosting deployment per (tenant, slug),
--     carrying the state machine (requested → provisioning → running → scaling →
--     suspended → torn_down | failed). region/planName/tier are the VETTED enum
--     strings the server resolved (server-side allowlist; never free-form).
--     killSwitch (per-tenant hard stop) + anomalyFlag (billing-anomaly) are the
--     cost-abuse guardrails. Money snapshots are ZAR cents (INTEGER).
--   * provisioning_jobs — the DURABLE provisioning queue: provisioning never
--     runs in the request. A verb enqueues a job; the reconcile cron (live:
--     QStash/Inngest) runs it against the tier backend and settles the async W1
--     operation. runAfter is epoch-MS as BIGINT (matches the in-memory store's
--     Date.now() and avoids timezone math).
--
-- Both tables are tenant-owned -> RLS (ENABLE + FORCE + tenant_isolation policy),
-- mirroring the M1/W1/W2/W4/W6/W8 backstop so cross-tenant IDOR is closed at the
-- DB layer even if an app-layer scope is ever missed.
--
-- TYPE NOTES (the W1/W2 lessons, applied):
--   * The two cross-tenant maintenance functions below take a count/time
--     parameter. The metering tick + queue sweep both work in epoch-MS, so the
--     queue-sweep parameter is BIGINT (matching Prisma's bind of a JS number to
--     int8) — NOT a timestamp. No timestamp PARAMETER is taken by any function
--     here, so the TIMESTAMPTZ-binding rule does not apply; the BIGINT rule does.
--   * runAfter / counts are BIGINT to match Prisma's $queryRaw int8 binding.

-- =========================================================================
-- Enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "HostingDeploymentStatus" AS ENUM (
  'requested', 'provisioning', 'running', 'scaling', 'suspended', 'torn_down', 'failed'
);

-- CreateEnum
CREATE TYPE "ProvisioningJobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateTable
CREATE TABLE "hosting_deployments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" "HostingDeploymentStatus" NOT NULL DEFAULT 'requested',
    "replicas" INTEGER NOT NULL DEFAULT 1,
    "maxReplicas" INTEGER NOT NULL DEFAULT 1,
    "backendRef" TEXT,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "anomalyFlag" BOOLEAN NOT NULL DEFAULT false,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provisioning_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ProvisioningJobStatus" NOT NULL DEFAULT 'queued',
    "operationId" TEXT,
    "targetReplicas" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" BIGINT NOT NULL DEFAULT 0,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provisioning_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hosting_deployments_tenantId_slug_key" ON "hosting_deployments"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "hosting_deployments_tenantId_idx" ON "hosting_deployments"("tenantId");

-- CreateIndex
CREATE INDEX "hosting_deployments_status_idx" ON "hosting_deployments"("status");

-- CreateIndex
CREATE INDEX "provisioning_jobs_tenantId_idx" ON "provisioning_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "provisioning_jobs_status_idx" ON "provisioning_jobs"("status");

-- CreateIndex
CREATE INDEX "provisioning_jobs_deploymentId_idx" ON "provisioning_jobs"("deploymentId");

-- AddForeignKey
ALTER TABLE "hosting_deployments" ADD CONSTRAINT "hosting_deployments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security — both tables are tenant-owned and tenant-isolated
-- (mirrors the M1/W1/W2/W4/W6/W8 backstop). ENABLE + FORCE so even the table
-- owner is subject to the policy, scoped to current_tenant_id() (the
-- per-transaction setting withTenant() sets).
-- =========================================================================

ALTER TABLE "hosting_deployments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hosting_deployments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "hosting_deployments"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "provisioning_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provisioning_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "provisioning_jobs"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- =========================================================================
-- Cross-tenant maintenance functions (the W1 SECURITY DEFINER pattern).
--
-- The metering tick and the provisioning-queue reconcile both run PLATFORM-WIDE
-- with NO tenant session, but the app DB role is non-BYPASSRLS so a base-client
-- read on these tables returns 0 rows by design. These tightly-scoped SECURITY
-- DEFINER functions run as their migration owner to LIST the rows that need
-- attention; the caller then enters withTenant(tenantId) for the per-tenant
-- meter/run. They only SELECT (read) — they cannot mutate or read anything
-- else, so they do not widen the app role's surface.
-- =========================================================================

-- All RUNNING managed-hosting deployments across all tenants (the metering tick).
CREATE OR REPLACE FUNCTION running_hosting_deployments()
RETURNS SETOF "hosting_deployments" AS $$
  SELECT * FROM "hosting_deployments" WHERE "status" = 'running'
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- All QUEUED provisioning jobs whose runAfter has elapsed, across all tenants
-- (the durable-queue reconcile sweep). `now_ms` is BIGINT to match Prisma's bind
-- of a JS number to int8 (the W2 binding lesson) — it is epoch-MS, NOT a
-- timestamp, so no TIMESTAMPTZ conversion applies.
CREATE OR REPLACE FUNCTION runnable_provisioning_jobs(now_ms BIGINT)
RETURNS SETOF "provisioning_jobs" AS $$
  SELECT * FROM "provisioning_jobs"
  WHERE "status" = 'queued' AND "runAfter" <= now_ms
  ORDER BY "createdAt" ASC
$$ LANGUAGE sql STABLE SECURITY DEFINER;
