// Shared helpers for the DB-backed (*.db.test.ts) suite.
//
// These run ONLY when DATABASE_URL points at a real Postgres with the W1
// migrations applied (the `db-tests` CI job; locally `npm run test:db`). The
// normal `npm test` never imports them. They use the base Prisma client for
// truncation/seeding (which a maintenance/superuser role can do); the RLS smoke
// test separately asserts the APP role is NOT superuser/BYPASSRLS.

import { prisma, withTenant } from "./prisma/client";

export const TENANT_A = "tenant-a-test";
export const TENANT_B = "tenant-b-test";

/** Truncate all app tables (FK-safe via CASCADE) for an isolated test. */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "approval_nonces","operations","webhook_events",
      "token_wallets","usage_records","invoices",
      "domains",
      "local_listings","products","whatsapp_orders",
      "site_repos","deployments",
      "hosting_deployments","provisioning_jobs",
      "agent_jobs","agent_policies",
      "audit_log","leads","site_versions","generated_sites",
      "businesses","subscriptions","adapter_connections","memberships","tenants"
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * Create two tenants so cross-tenant isolation can be exercised. The `tenants`
 * table is FORCE RLS with WITH CHECK (id = current_tenant_id()), so each row
 * must be inserted INSIDE that tenant's scope — a base-client insert with NULL
 * tenant would be rejected by the policy (which is exactly the isolation we
 * want). withTenant() sets the per-transaction tenant so the WITH CHECK passes.
 */
export async function seedTenants(): Promise<void> {
  for (const [id, slug] of [
    [TENANT_A, "tenant-a"],
    [TENANT_B, "tenant-b"],
  ] as const) {
    await withTenant(id, (tx) =>
      tx.tenant.create({ data: { id, name: id, slug } }),
    );
  }
}

/** Reset to a clean, two-tenant baseline. */
export async function resetDb(): Promise<void> {
  await truncateAll();
  await seedTenants();
}
