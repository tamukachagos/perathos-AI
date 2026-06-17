-- W2 — Metering wallet: prepaid credit wallet + append-only usage ledger +
-- rolled invoices (ENTERPRISE_REVIEW §5.4 / §8).
--
-- Adds three tenant-owned tables:
--   * token_wallets  — one per tenant (@unique tenantId). balanceMicro (BigInt)
--     is ZAR micro-cents, the cached prepaid running total.
--   * usage_records  — append-only billing source of truth. Exactly-once
--     accounting via unique (tenantId, idempotencyKey): a duplicate event is a
--     no-op (never double-debits).
--   * invoices       — a period's usage rolled into one invoice (one per
--     (tenantId, period)), charged via the dormant Paystack BillingProvider.
--
-- All three are tenant-owned → RLS (ENABLE + FORCE + tenant_isolation policy),
-- mirroring the M1/W1 backstop so cross-tenant IDOR is closed at the DB layer
-- even if an app-layer scope is ever missed.
--
-- Money is ZAR micro-cents (1 cent = 1000 micro; R1 = 100000 micro), stored as
-- BigInt so per-token retail prices (fractions of a cent) stay exact.

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'paid', 'void');

-- CreateTable
CREATE TABLE "token_wallets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "balanceMicro" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCostMicro" BIGINT NOT NULL DEFAULT 0,
    "unitPriceMicro" BIGINT NOT NULL DEFAULT 0,
    "amountMicro" BIGINT NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalMicro" BIGINT NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'open',
    "providerInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_wallets_tenantId_key" ON "token_wallets"("tenantId");

-- CreateIndex
CREATE INDEX "token_wallets_tenantId_idx" ON "token_wallets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_tenantId_idempotencyKey_key" ON "usage_records"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "usage_records_tenantId_idx" ON "usage_records"("tenantId");

-- CreateIndex
CREATE INDEX "usage_records_tenantId_period_idx" ON "usage_records"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_period_key" ON "invoices"("tenantId", "period");

-- CreateIndex
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_period_idx" ON "invoices"("tenantId", "period");

-- AddForeignKey
ALTER TABLE "token_wallets" ADD CONSTRAINT "token_wallets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security — all three are tenant-owned and tenant-isolated
-- (mirrors the M1/W1 backstop). ENABLE + FORCE so even the table owner is
-- subject to the policy, and a tenant_isolation policy scoped to
-- current_tenant_id() (the per-transaction setting withTenant() sets).
-- =========================================================================

ALTER TABLE "token_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_wallets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "token_wallets"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "usage_records"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- =========================================================================
-- Atomic debit (the exactly-once metering primitive).
--
-- record_usage_debit() does the WHOLE metering event in ONE statement set
-- inside the caller's transaction:
--   1. INSERT the usage row, keyed by (tenantId, idempotencyKey). A duplicate
--      key hits ON CONFLICT DO NOTHING → no new row, NO debit (exactly-once).
--   2. ONLY when the insert actually created a row, decrement the wallet by the
--      same amount, atomically (UPDATE ... SET balanceMicro = balanceMicro - n).
--
-- It returns the resulting balance and whether THIS call performed the debit
-- (so a duplicate returns applied=false + the prior balance, never re-charging).
-- Because both steps share the caller's transaction (withTenant), they commit
-- or roll back together — no usage row can exist without its wallet debit.
--
-- This function is NOT SECURITY DEFINER: it runs as the calling app role inside
-- withTenant(), so RLS still scopes every row it touches to the active tenant.
-- The wallet row is created on first credit/debit (upsert in the app layer).
--
-- NOTE on the time/param types: this function takes no timestamp parameter, so
-- the W1 TIMESTAMPTZ rule does not apply here. amount_in is BIGINT (micro-cents).
-- =========================================================================

-- NOTE on parameter types (the W1 binding lesson, generalized): Prisma's
-- $queryRaw binds a JS `number` as int8 (BIGINT) and a JS `bigint` as int8 too,
-- so EVERY numeric parameter here is declared BIGINT to match the bound types
-- exactly. A mismatched int4 (INTEGER) for `quantity` causes a 42883 "function
-- does not exist" (no matching overload). `quantity` is cast back to INTEGER on
-- INSERT (the column is INTEGER).
CREATE OR REPLACE FUNCTION record_usage_debit(
  tenant_in TEXT,
  usage_id_in TEXT,
  kind_in TEXT,
  quantity_in BIGINT,
  unit_cost_micro_in BIGINT,
  unit_price_micro_in BIGINT,
  amount_micro_in BIGINT,
  period_in TEXT,
  idempotency_key_in TEXT
)
RETURNS TABLE(balance_micro BIGINT, applied BOOLEAN) AS $$
DECLARE
  inserted_count INTEGER;
  new_balance BIGINT;
BEGIN
  -- 1. Append the usage row exactly once. A retry with the same
  --    (tenantId, idempotencyKey) conflicts and inserts nothing.
  INSERT INTO "usage_records" (
    "id","tenantId","kind","quantity","unitCostMicro","unitPriceMicro",
    "amountMicro","period","idempotencyKey","createdAt"
  ) VALUES (
    usage_id_in, tenant_in, kind_in, quantity_in::INTEGER, unit_cost_micro_in,
    unit_price_micro_in, amount_micro_in, period_in, idempotency_key_in, now()
  )
  ON CONFLICT ("tenantId","idempotencyKey") DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 1 THEN
    -- 2. Debit the wallet by the same amount, in the same transaction.
    UPDATE "token_wallets"
      SET "balanceMicro" = "balanceMicro" - amount_micro_in,
          "updatedAt" = now()
      WHERE "tenantId" = tenant_in
      RETURNING "balanceMicro" INTO new_balance;
    RETURN QUERY SELECT new_balance, TRUE;
  ELSE
    -- Duplicate: no debit. Return the current balance + applied=false.
    SELECT "balanceMicro" INTO new_balance
      FROM "token_wallets" WHERE "tenantId" = tenant_in;
    RETURN QUERY SELECT new_balance, FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql;
