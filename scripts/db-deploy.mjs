// Guarded migrate-on-deploy (M6).
//
// Runs `prisma migrate deploy` ONLY when DATABASE_URL is a real postgres URL.
// In mock mode (no DATABASE_URL, or the documented "postgresql://placeholder",
// or any non-postgres value) it is a NO-OP and exits 0 — so `next build`
// locally and in CI (which run with no DB) are never blocked or made to touch a
// database. This mirrors src/lib/env.ts readDatabaseUrl() so the gate is
// identical to the runtime's mock/Postgres switch.

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

console.log("[db:deploy] Real DATABASE_URL detected — running prisma migrate deploy…");
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
