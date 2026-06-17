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

  /**
   * Secret used to sign single-use approval tokens (M3 ActionRouter). Optional:
   * in mock mode a stable dev secret is used so the approval flow is fully
   * exercisable with no secrets. Real deployments MUST set this; it is only ever
   * read server-side in the action plane.
   */
  approvalSecret:
    process.env.LAUNCH_DESK_APPROVAL_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET,
} as const;

/**
 * Resolve the HMAC key for approval tokens. Falls back to a stable dev key in
 * mock mode so the whole approval flow runs with no secrets configured. Real
 * deployments set LAUNCH_DESK_APPROVAL_SECRET (or AUTH_SECRET).
 */
const DEV_APPROVAL_SECRET = "launch-desk-dev-approval-secret-not-for-production";
export function approvalSecret(): string {
  // B6/S4: in production-non-mock the approval HMAC secret MUST be present —
  // the hardcoded dev fallback is public (open-source repo), so relying on it
  // in production would let anyone mint approval tokens. Runtime check (first
  // token sign/verify), never import-time, so `next build` is unaffected.
  if (env.approvalSecret) return env.approvalSecret;
  if (isDevMockMode()) return DEV_APPROVAL_SECRET;
  throw new MissingProductionSecretError("LAUNCH_DESK_APPROVAL_SECRET");
}

/** True when we are running entirely on mocks (the M0 default). */
export function isMockMode(): boolean {
  return env.adapterMode === "mock";
}

/**
 * True when the app is running in an explicit MOCK/dev context where missing
 * secrets are tolerated and dev fallbacks apply.
 *
 * Mock mode is EITHER:
 *   * `LAUNCH_DESK_MOCK=1` (explicit opt-in, works even in production), OR
 *   * `NODE_ENV !== "production"` (dev/test).
 *
 * It is deliberately NOT inferred from `hasDatabase()` — a malformed
 * DATABASE_URL must never silently re-enable dev/passwordless behaviour
 * (B4/S3). `next build` runs with NODE_ENV=production and no secrets, so this
 * is only ever consulted at RUNTIME inside request handlers / first use, never
 * at import time (so the build never trips a fail-closed check).
 */
export function isDevMockMode(): boolean {
  if (process.env.LAUNCH_DESK_MOCK === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * Fail-closed secret resolver for privileged endpoints (B3/S1/S2/B6/S4).
 *
 * Reads `name` (optionally falling back through `fallbacks`). In production
 * WITHOUT an explicit mock opt-in, a missing value is a hard error — callers
 * MUST treat that as "reject the request" (never "accept"). In mock/dev mode a
 * missing value returns `undefined` so the dev-friendly behaviour is preserved.
 *
 * MUST be called at runtime (request handling), never at module top level, so
 * `next build` (production, no secrets) does not throw at import time.
 */
export class MissingProductionSecretError extends Error {
  readonly code = "missing_production_secret";
  constructor(name: string) {
    super(
      `Required secret "${name}" is not set. Refusing to run in production ` +
        `without it (set LAUNCH_DESK_MOCK=1 to allow dev/mock behaviour).`,
    );
    this.name = "MissingProductionSecretError";
  }
}

export function requireProductionSecret(
  name: string,
  ...fallbacks: string[]
): string | undefined {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  // No secret found.
  if (isDevMockMode()) return undefined; // dev/mock: tolerate, caller stays open
  throw new MissingProductionSecretError(name); // production: caller must reject
}

/**
 * True when a real Postgres database is configured. When false the app uses the
 * in-memory repository and the dev/mock auth path, so it builds and runs with no
 * DATABASE_URL and no secrets.
 */
export function hasDatabase(): boolean {
  return env.databaseUrl !== undefined;
}
