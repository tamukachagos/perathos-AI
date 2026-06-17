-- W1 — Reliability hardening: persistent stores + public-read RLS.
--
-- Adds three tables that were previously in-memory globalThis maps (B1/B7/B8):
--   * approval_nonces — the single-use approval nonce ledger. consumedAt is the
--     atomic claim marker; consume is `UPDATE ... WHERE consumedAt IS NULL`.
--   * operations      — the async operation store. Idempotency is per-tenant
--     now (unique (tenantId, idempotencyKey)) so two tenants reusing "idem-1"
--     cannot read each other's operation (fixes B7's cross-tenant leak).
--   * webhook_events  — the webhook dedup ledger (B8/B13); unique (provider,
--     eventId) is the exactly-once guarantee under concurrency.
--
-- Also adds the B5 public-read RLS policy: a published site (and its current
-- version's snapshot) is readable with NO tenant in context, so the public
-- /s/[slug] route's base-client getBySlug works under FORCE ROW LEVEL SECURITY.

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateTable
CREATE TABLE "approval_nonces" (
    "nonce" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "approval_nonces_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "detail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "settleAt" TIMESTAMP(3) NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_nonces_tenantId_idx" ON "approval_nonces"("tenantId");

-- CreateIndex
CREATE INDEX "approval_nonces_expiresAt_idx" ON "approval_nonces"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "operations_tenantId_idempotencyKey_key" ON "operations"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "operations_tenantId_idx" ON "operations"("tenantId");

-- CreateIndex
CREATE INDEX "operations_status_idx" ON "operations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "webhook_events_provider_idx" ON "webhook_events"("provider");

-- AddForeignKey
ALTER TABLE "approval_nonces" ADD CONSTRAINT "approval_nonces_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security for the new tenant-owned stores (mirrors M1 backstop).
-- approval_nonces + operations are tenant-owned and isolated. webhook_events is
-- NOT tenant-owned (the dedup ledger spans providers, written by the
-- signature-authenticated webhook before the tenant is resolved) and so is left
-- without RLS, exactly like the Auth.js tables.
-- =========================================================================

ALTER TABLE "approval_nonces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_nonces" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_nonces"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "operations"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- =========================================================================
-- B5 — Public-read RLS for published sites.
--
-- The public /s/[slug] route reads a site by slug on the BASE client (no tenant
-- in context), so under FORCE RLS the tenant_isolation policy (tenantId =
-- current_tenant_id(), which is NULL) returns zero rows and every public site
-- 404s. We add a permissive SELECT policy that allows reading a PUBLISHED site
-- with NO tenant predicate. Because RLS policies are OR-ed, this is additive: a
-- tenant still sees all its own rows (draft + published) via tenant_isolation,
-- AND anyone (including the unscoped base client) may read published rows.
--
-- A site's content lives in site_versions (currentVersion include), so the same
-- public-read must extend to the version snapshot. We scope that to versions
-- belonging to a published site so unpublished/draft snapshots never leak.
-- =========================================================================

CREATE POLICY public_read_published ON "generated_sites"
  FOR SELECT
  USING ("status" = 'published');

CREATE POLICY public_read_published_versions ON "site_versions"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "generated_sites" gs
      WHERE gs."currentVersionId" = "site_versions"."id"
        AND gs."status" = 'published'
    )
  );

-- =========================================================================
-- B11 — Operations-reconcile maintenance function.
--
-- The reconcile cron runs PLATFORM-WIDE with no tenant session, but the app DB
-- role is non-BYPASSRLS, so it cannot read other tenants' `operations` rows
-- directly (tenant_isolation, NULL tenant => 0 rows) — by design. This
-- SECURITY DEFINER function runs as its owner (the migration role, which DOES
-- see all rows) and performs a tightly-scoped sweep: settle every operation
-- still `pending` whose `settleAt` has elapsed, to `succeeded` (mock-style
-- deterministic settlement; a real vendor webhook supersedes this with the true
-- outcome, which may be `failed`, BEFORE the cron ever runs because webhooks
-- arrive promptly). It returns the count settled. It cannot be used to read or
-- mutate anything else, so it does not widen the app role's surface.
-- =========================================================================

-- NOTE: the time parameter is `timestamptz` (not `timestamp(3)`): the Prisma
-- client binds a JS Date as `timestamptz`, so the function signature must match
-- or Postgres reports "function ... does not exist" (no matching overload).
-- `settleAt` is a naive-UTC `timestamp(3)`, so we compare against the param's
-- UTC wall-clock (`AT TIME ZONE 'UTC'`) to stay timezone-correct.
CREATE OR REPLACE FUNCTION reconcile_pending_operations(now_ts TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  settled_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE "operations"
    SET "status" = 'succeeded',
        "detail" = "verb" || ' for "' || "target" || '" completed.',
        "result" = jsonb_build_object('settledBy', 'cron-reconciliation'),
        "updatedAt" = now()
    WHERE "status" = 'pending' AND "settleAt" <= (now_ts AT TIME ZONE 'UTC')
    RETURNING 1
  )
  SELECT count(*) INTO settled_count FROM updated;
  RETURN settled_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- B5 (equivalents) — privileged cross-tenant maintenance functions.
--
-- The POPIA purge cron, the DSAR endpoint, and the billing webhook all operate
-- PLATFORM-WIDE with no tenant session (a data subject / subscription id is
-- global, not tenant-scoped), so their base-client reads/writes on `leads` and
-- `subscriptions` would return 0 rows under FORCE RLS with the non-bypass app
-- role. These tightly-scoped SECURITY DEFINER functions run as the migration
-- owner so those specific, already-access-controlled endpoints work, WITHOUT
-- granting the app role blanket cross-tenant read. Each does exactly one thing.
-- =========================================================================

-- POPIA retention purge: delete every lead whose retentionUntil has elapsed,
-- across all tenants. Returns the count deleted. (Cron-authenticated.)
-- `as_of` is `timestamptz` to match the Prisma-bound JS Date (see the note on
-- reconcile_pending_operations); compared against the naive-UTC column via UTC.
CREATE OR REPLACE FUNCTION purge_expired_leads(as_of TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH removed AS (
    DELETE FROM "leads"
    WHERE "retentionUntil" IS NOT NULL AND "retentionUntil" <= (as_of AT TIME ZONE 'UTC')
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM removed;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- DSAR erasure: delete every lead whose contact matches (case-insensitive,
-- trimmed), across all tenants. Returns the count deleted. (IO-authenticated.)
CREATE OR REPLACE FUNCTION delete_leads_by_contact(contact_in TEXT)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
  key TEXT := lower(btrim(contact_in));
BEGIN
  IF key = '' THEN RETURN 0; END IF;
  WITH removed AS (
    DELETE FROM "leads" WHERE lower(btrim("contact")) = key RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM removed;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- DSAR export: return every lead whose contact matches, across all tenants.
CREATE OR REPLACE FUNCTION find_leads_by_contact(contact_in TEXT)
RETURNS SETOF "leads" AS $$
  SELECT * FROM "leads"
  WHERE lower(btrim("contact")) = lower(btrim(contact_in))
    AND btrim(contact_in) <> ''
  ORDER BY "createdAt" DESC
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Billing webhook tenant resolution: return the owning tenantId for a provider
-- subscription id, across all tenants (the webhook has no session). Returns
-- NULL when unknown. The webhook then enters withTenant(tenantId) for any write.
CREATE OR REPLACE FUNCTION subscription_tenant_by_provider(
  provider_in TEXT,
  provider_sub_id_in TEXT
)
RETURNS TEXT AS $$
  SELECT "tenantId" FROM "subscriptions"
  WHERE "provider" = provider_in
    AND "providerSubscriptionId" = provider_sub_id_in
  LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;
