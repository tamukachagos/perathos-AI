// Guarded migrate-on-deploy (M6 + B16).
//
// Runs `prisma migrate deploy` ONLY when DATABASE_URL is a real postgres URL.
// In mock mode (no DATABASE_URL, the documented "postgresql://placeholder", or
// any non-postgres value) it is a NO-OP and exits 0 — so `next build` locally
// and in CI (which run with no DB) are never blocked or made to touch a
// database. This mirrors src/lib/env.ts readDatabaseUrl() so the gate is
// identical to the runtime's mock/Postgres switch.
//
// B16 hardening:
//   * On failure, LOG result.error (spawn-level failure, e.g. npx not found) and
//     the captured stderr BEFORE exiting non-zero — previously a failed spawn
//     exited 1 with no message, making CI/deploy failures undiagnosable.
//   * MIGRATION ADVISORY LOCK: `prisma migrate deploy` already takes a Postgres
//     advisory lock (id 72707369) for the duration of the migration so two
//     concurrent deploys cannot race the same migration; we keep that ON
//     (PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK is NOT set) and assert it here so a
//     future change can't silently disable it.

import { spawnSync } from "node:child_process";

const PLACEHOLDER = "postgresql://placeholder";

function isRealPostgresUrl(value) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === PLACEHOLDER) return false;
  return /^postgres(ql)?:\/\//.test(trimmed);
}

const url = process.env.DATABASE_URL;

if (!isRealPostgresUrl(url)) {
  console.log(
    "[db:deploy] No real DATABASE_URL — skipping prisma migrate deploy (mock mode).",
  );
  process.exit(0);
}

// B16: keep Prisma's migration advisory lock enabled. If something set the
// opt-out flag, refuse to run — concurrent deploys must serialize on the lock.
if (process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK === "1") {
  console.error(
    "[db:deploy] PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1 is set — refusing to run " +
      "migrate deploy without the advisory lock (concurrent deploys could race " +
      "migrations). Unset it to proceed.",
  );
  process.exit(1);
}

console.log(
  "[db:deploy] Real DATABASE_URL detected — running prisma migrate deploy (advisory lock ON)…",
);
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  // Capture stderr so we can surface it on failure; still echo both streams.
  stdio: ["inherit", "inherit", "pipe"],
  shell: true,
  encoding: "utf8",
});

if (result.stderr) {
  // Echo captured stderr to our stderr regardless of outcome.
  process.stderr.write(result.stderr);
}

if (result.error) {
  // Spawn-level failure (e.g. npx missing) — previously swallowed.
  console.error("[db:deploy] Failed to spawn prisma migrate deploy:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `[db:deploy] prisma migrate deploy exited with code ${result.status ?? "null"}.`,
  );
  if (result.stderr) {
    console.error("[db:deploy] stderr:\n" + result.stderr);
  }
  process.exit(result.status ?? 1);
}

console.log("[db:deploy] Migrations applied successfully.");
process.exit(0);
