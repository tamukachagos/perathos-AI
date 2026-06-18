-- W8 — Google Business Profile automation (B1) + WhatsApp commerce (B2).
-- (ENTERPRISE_REVIEW Part 4: Tier 1 B1 GBP + B2 WhatsApp commerce.)
--
-- Adds three tenant-owned tables:
--   * local_listings  — the GBP listing. NAP (name/area/phone) is the single
--     source derived from the Business profile (also used on-site in JSON-LD)
--     and pushed to GBP. Verification is async → status lifecycle.
--   * products        — the WhatsApp catalog. priceCents is ZAR cents (BigInt).
--   * whatsapp_orders — orders captured over WhatsApp. totalCents BigInt; items
--     is a JSON line-item snapshot; paymentLinkRef links a created payment link.
--
-- All three are tenant-owned → RLS (ENABLE + FORCE + tenant_isolation policy),
-- mirroring the M1/W1/W2 backstop so cross-tenant IDOR is closed at the DB layer
-- even if an app-layer scope is ever missed. New columns/tables inherit nothing;
-- the RLS blocks below are explicit per table.
--
-- TYPE NOTES (the W1/W2 lessons):
--   * Money is ZAR cents stored as BIGINT (priceCents / totalCents) so Prisma's
--     int8 binding matches and large totals stay exact.
--   * This migration adds NO SQL function taking a timestamp parameter, so the
--     TIMESTAMPTZ-binding rule does not apply. All timestamp columns are plain
--     TIMESTAMP(3), matching every other Prisma DateTime column in this schema.

-- =========================================================================
-- Enums
-- =========================================================================

-- CreateEnum
CREATE TYPE "LocalListingStatus" AS ENUM ('draft', 'pending_verification', 'live', 'failed');

-- CreateEnum
CREATE TYPE "WhatsappOrderStatus" AS ENUM ('draft', 'sent', 'paid', 'fulfilled', 'canceled');

-- =========================================================================
-- Tables
-- =========================================================================

-- CreateTable
CREATE TABLE "local_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "categories" JSONB,
    "hours" JSONB,
    "status" "LocalListingStatus" NOT NULL DEFAULT 'draft',
    "googleLocationId" TEXT,
    "operationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" BIGINT NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "customerContact" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalCents" BIGINT NOT NULL DEFAULT 0,
    "status" "WhatsappOrderStatus" NOT NULL DEFAULT 'draft',
    "paymentLinkRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "local_listings_tenantId_idx" ON "local_listings"("tenantId");

-- CreateIndex
CREATE INDEX "local_listings_businessId_idx" ON "local_listings"("businessId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE INDEX "products_businessId_idx" ON "products"("businessId");

-- CreateIndex
CREATE INDEX "whatsapp_orders_tenantId_idx" ON "whatsapp_orders"("tenantId");

-- CreateIndex
CREATE INDEX "whatsapp_orders_businessId_idx" ON "whatsapp_orders"("businessId");

-- AddForeignKey
ALTER TABLE "local_listings" ADD CONSTRAINT "local_listings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_listings" ADD CONSTRAINT "local_listings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_orders" ADD CONSTRAINT "whatsapp_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_orders" ADD CONSTRAINT "whatsapp_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================================
-- Row-Level Security — all three are tenant-owned and tenant-isolated
-- (mirrors the M1/W1/W2 backstop). ENABLE + FORCE so even the table owner is
-- subject to the policy, scoped to current_tenant_id() (the per-transaction
-- setting withTenant() sets).
-- =========================================================================

ALTER TABLE "local_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "local_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "local_listings"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE "whatsapp_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "whatsapp_orders"
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
