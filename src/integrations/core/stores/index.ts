// Env-gated reliability-store factory (B1/B7/B8).
//
//   DATABASE_URL set (real postgres) -> Prisma/Postgres stores (persistent,
//                                        atomic consume/claim, multi-process safe)
//   DATABASE_URL unset / placeholder  -> in-memory stores (mock mode / tests)
//
// Mirrors src/lib/db/index.ts exactly: selection is automatic from env
// (hasDatabase()), the Prisma module is loaded LAZILY via dynamic import so
// `@prisma/client` is never evaluated with no database, and `next build` (no
// env) never touches the DB. Flipping mock<->Postgres requires ZERO code change.

import { hasDatabase } from "@/lib/env";
import type { ReliabilityStores } from "./types";
import { memoryStores } from "./memory";

let cached: ReliabilityStores | undefined;

/** Resolve the active reliability stores. Server-only. */
export async function getStores(): Promise<ReliabilityStores> {
  if (cached) return cached;
  if (hasDatabase()) {
    const { prismaStores } = await import("./prisma");
    cached = prismaStores;
  } else {
    cached = memoryStores;
  }
  return cached;
}

/** True when the Prisma/Postgres reliability stores are in use. */
export function isPersistentStores(): boolean {
  return hasDatabase();
}

/**
 * Reset the cached selection. Tests flip env between mock + Postgres and need
 * the factory to re-resolve; production never calls this.
 */
export function __resetStoreFactory(): void {
  cached = undefined;
}

export type * from "./types";
