-- Add global localization fields to business profiles
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT 'us-east';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'US';

CREATE TABLE IF NOT EXISTS "GlobalPricingPlan" (
  "id" TEXT NOT NULL,
  "planKey" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "stripePriceId" TEXT,
  "paystackPlanCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalPricingPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalPricingPlan_planKey_currency_key" ON "GlobalPricingPlan"("planKey", "currency");
CREATE INDEX IF NOT EXISTS "GlobalPricingPlan_currency_idx" ON "GlobalPricingPlan"("currency");
