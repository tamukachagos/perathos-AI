-- W7 — The customer agent team (ENTERPRISE_REVIEW Part 7 / Part 3.C).
--
-- Adds two tenant-owned tables:
--   * agent_jobs     — one row per job in the bounded DAG the Conductor
--     decomposes a trigger into. role/trigger/status/riskTier/parentJobId carry
--     the queue + DAG state; inputRef/resultRef are content REFERENCES (hashes),
--     never raw untrusted text or code; prUrl is the fix/feature PR the job
--     opened (agents open PRs, never push direct); costMicro (BigInt) is the
--     wallet draw attributed to the job, ZAR micro-cents.
--   * agent_policies — one row per tenant: the pause/kill switch
--     (pausedByOwner), the AUTO-tier auto-approve toggle (autoApproveContent),
--     and the hard agent spend cap (monthlySpendCapMicro, BigInt micro-cents).
--
-- Metering reuses W2's token_wallets / usage_records (a per-job `agent.*` usage
-- kind), so the always-on team is naturally budget-bounded — no new money table.
--
-- Both tables are tenant-owned -> RLS (ENABLE + FORCE + tenant_isolation policy),
-- mirroring the M1/W1/W2/W4/W6/W8 backstop so cross-tenant IDOR is closed at the
-- DB layer even if an app-layer scope is ever missed.
--
-- TYPE NOTES (the W1/W2 lessons):
--   * This migration adds NO SQL function taking a timestamp parameter, so the
--     TIMESTAMPTZ-binding rule does not apply here. All timestamp columns are
--     plain TIMESTAMP(3), matching every other Prisma DateTime column.
--   * Money columns (costMicro / monthlySpendCapMicro) are BIGINT (ZAR
--     micro-cents), mirroring token_wallets.balanceMicro — never widened.

-- =========================================================================
-- Enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('queued', 'running', 'awaiting_approval', 'done', 'failed', 'blocked');

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "AgentJobStatus" NOT NULL DEFAULT 'queued',
    "riskTier" TEXT NOT NULL DEFAULT 'review',
    "inputRef" TEXT,
    "resultRef" TEXT,
    "prUrl" TEXT,
    "parentJobId" TEXT,
    "costMicro" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pausedByOwner" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveContent" BOOLEAN NOT NULL DEFAULT true,
    "monthlySpendCapMicro" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_jobs_tenantId_idx" ON "agent_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "agent_jobs_tenantId_status_idx" ON "agent_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "agent_jobs_parentJobId_idx" ON "agent_jobs"("parentJobId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_policies_tenantId_key" ON "agent_policies"("tenantId");

-- CreateIndex
CREATE INDEX "agent_policies_tenantId_idx" ON "agent_policies"("tenantId");

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security — both tables are tenant-owned and tenant-isolated
-- (mirrors the M1/W1/W2/W6/W8 backstop). ENABLE + FORCE so even the table owner
-- is subject to the policy, scoped to current_tenant_id() (the per-transaction
-- setting withTenant() sets).
-- =========================================================================

ALTER TABLE "agent_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_jobs"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "agent_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_policies"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- =========================================================================
-- GitHub webhook tenant resolution (mirrors W6's deployment_owner_by_provider_id).
--
-- The signed GitHub webhook (workflow_run failure -> CI Medic) has NO tenant
-- session: it correlates an inbound event to a site by the operator-side repoRef
-- ("launchdesk-sites/{slug}"), which is global, not tenant-scoped. Under FORCE
-- RLS a base-client read on `site_repos` returns 0 rows for the non-bypass app
-- role, so this tightly-scoped SECURITY DEFINER function resolves the owning
-- tenantId + slug for a repoRef; the webhook then enters withTenant(tenantId) to
-- enqueue the CI Medic job. It returns NULL when unknown and cannot read or
-- mutate anything else, so it does not widen the app role. No timestamp param,
-- so the TIMESTAMPTZ-binding rule does not apply.
-- =========================================================================

CREATE OR REPLACE FUNCTION site_repo_owner_by_repo_ref(repo_ref_in TEXT)
RETURNS TABLE("tenantId" TEXT, "slug" TEXT) AS $$
  SELECT "tenantId", "slug" FROM "site_repos"
  WHERE "repoRef" = repo_ref_in
  LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;
