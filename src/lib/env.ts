// Typed environment access with mock defaults.
//
// M0 contract: the app must `npm install && npm run build` and run with NO env
// vars, NO database, NO secrets. Every value here therefore has a safe default
// that keeps the app in MOCK mode. Real keys (M4) drop in per-provider with no
// UI change; secrets are only ever read in the server action plane.

import type { AdapterMode } from "./types";

function readMode(value: string | undefined, fallback: AdapterMode): AdapterMode {
  if (value === "mock" || value === "sandbox" || value === "live") return value;
  return fallback;
}

/**
 * Global default adapter mode. Defaults to "mock" so the app is fully runnable
 * with no configuration. Per-provider overrides can layer on top in later
 * milestones without changing the interface.
 */
// A placeholder DATABASE_URL kept in `.env` so the Prisma CLI (validate/generate)
// works with no real database. It must NEVER be treated as a live connection.
const DATABASE_URL_PLACEHOLDER = "postgresql://placeholder";

/**
 * Resolve a real Postgres connection string, or `undefined` when we should stay
 * in mock/in-memory persistence mode. A value equal to the documented
 * placeholder, or any non-postgres URL, counts as "no database".
 */
function readDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === DATABASE_URL_PLACEHOLDER) return undefined;
  if (!/^postgres(ql)?:\/\//.test(trimmed)) return undefined;
  return trimmed;
}

export const env = {
  /** Default action-plane mode for all adapters. */
  adapterMode: readMode(process.env.LAUNCH_DESK_ADAPTER_MODE, "mock"),

  /** Public base URL for building absolute site links; safe localhost default. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  /**
   * Real Postgres URL, or undefined in mock mode. This is the single switch that
   * the data-access factory uses to choose Prisma vs. the in-memory repository.
   * No DB calls happen at build/static-generation time; the Prisma client is
   * only instantiated when this is set.
   */
  databaseUrl: readDatabaseUrl(process.env.DATABASE_URL),

  /** Auth.js secret. Optional in mock mode (a dev secret is used instead). */
  authSecret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
} as const;

/** True when we are running entirely on mocks (the M0 default). */
export function isMockMode(): boolean {
  return env.adapterMode === "mock";
}

/**
 * True when a real Postgres database is configured. When false the app uses the
 * in-memory repository and the dev/mock auth path, so it builds and runs with no
 * DATABASE_URL and no secrets.
 */
export function hasDatabase(): boolean {
  return env.databaseUrl !== undefined;
}
