// Prisma client singleton + tenant-scoped transaction helper.
//
// This module is only ever imported by the Prisma repository impl, which the
// factory loads ONLY when a real DATABASE_URL is set. Nothing here runs at
// build/static-generation time when there is no database.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __launchDeskPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__launchDeskPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__launchDeskPrisma = prisma;
}

/**
 * Run `work` inside a transaction whose connection has the active tenant set, so
 * the Postgres RLS policies (current_tenant_id()) scope every statement to that
 * tenant. This is the DB-layer backstop behind the app-layer scoping.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // set_config(..., true) => transaction-local, reset at COMMIT/ROLLBACK.
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return work(tx);
  });
}
