-- W4 — Multi-domain (.com + .co.za), registrar-agnostic (ENTERPRISE_REVIEW §5.1).
--
-- The Domain model was already TLD-neutral (hostname TEXT @unique). This
-- migration extends it with the registrar-routing + lifecycle + pricing state
-- the RegistrarRouter needs, and adds two lifecycle states.
--
--   * status lifecycle: + 'transfer_pending' (a transfer in flight) and
--     'expiring' (auto-renew window / near expiry).
--   * tld / registrar / registrarRef — which backend owns this name + its id.
--   * autoRenew / expiresAt — renewal billing + lifecycle.
--   * authCode — EPP/transfer auth-info, stored ENCRYPTED (AES-256-GCM) by the
--     app's field-crypto helper. The column is just TEXT ciphertext; the DB
--     never sees plaintext and it is never logged.
--   * costCents / priceCents — resale-spread snapshot (ZAR cents, INTEGER).
--   * operationId — the async W1 operation that settles register/transfer/renew.
--
-- The `domains` table is already tenant-owned + RLS (ENABLE+FORCE+
-- tenant_isolation) from the M1 migration; new columns inherit that policy, so
-- no RLS change is needed here. Adding columns + enum values is non-destructive.
--
-- TIME-PARAM NOTE (the W1 lesson): this migration adds no SQL function that
-- takes a timestamp parameter, so the TIMESTAMPTZ binding rule does not apply.
-- `expiresAt` is a plain TIMESTAMP(3) column matching every other Prisma
-- DateTime column in this schema (Prisma maps DateTime → timestamp(3)).

-- AlterEnum: add the two new lifecycle states. PG 12+ permits ADD VALUE inside
-- a transaction as long as the new value is not USED in the same transaction —
-- which holds here (we only add columns; no row uses the new states yet).
ALTER TYPE "DomainStatus" ADD VALUE IF NOT EXISTS 'transfer_pending';
ALTER TYPE "DomainStatus" ADD VALUE IF NOT EXISTS 'expiring';

-- AlterTable: add the W4 columns. All nullable / defaulted so existing rows are
-- valid without backfill.
ALTER TABLE "domains" ADD COLUMN "tld" TEXT;
ALTER TABLE "domains" ADD COLUMN "registrar" TEXT;
ALTER TABLE "domains" ADD COLUMN "registrarRef" TEXT;
ALTER TABLE "domains" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "domains" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "domains" ADD COLUMN "authCode" TEXT;
ALTER TABLE "domains" ADD COLUMN "costCents" INTEGER;
ALTER TABLE "domains" ADD COLUMN "priceCents" INTEGER;
ALTER TABLE "domains" ADD COLUMN "operationId" TEXT;
