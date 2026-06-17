// Env-gated data-access factory.
//
//   DATABASE_URL set (to a real postgres URL) -> Prisma/Postgres repositories
//   DATABASE_URL unset / placeholder           -> in-memory mock repositories
//
// Selection is automatic from env (src/lib/env.ts `hasDatabase()`); flipping
// between mock and Postgres requires ZERO code change. The Prisma module is
// loaded lazily via dynamic import so that, with no database, `@prisma/client`
// is never even evaluated — `next build` does not touch the DB.

import { hasDatabase } from "@/lib/env";
import type { Repositories } from "./types";
import { memoryRepositories } from "./memory";

let cached: Repositories | undefined;

/**
 * Resolve the active repositories. Server-only — call this from route handlers,
 * server actions, and server components, never from client code.
 */
export async function getRepositories(): Promise<Repositories> {
  if (cached) return cached;

  if (hasDatabase()) {
    const { prismaRepositories } = await import("./prisma/repositories");
    cached = prismaRepositories;
  } else {
    cached = memoryRepositories;
  }
  return cached;
}

/** True when the Prisma/Postgres repositories are in use. */
export function isPersistent(): boolean {
  return hasDatabase();
}

// Re-export the contracts for convenience.
export type * from "./types";
