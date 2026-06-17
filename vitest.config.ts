import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DB-backed tests live in `*.db.test.ts` and require a real DATABASE_URL +
// applied migrations (see the `db-tests` CI job). They are EXCLUDED from the
// normal `npm test` run so the default suite stays DB-free and passes with no
// env (the M0 contract). `npm run test:db` flips VITEST_DB=1 to run ONLY them.
const dbOnly = process.env.VITEST_DB === "1";

export default defineConfig({
  test: {
    environment: "node",
    // Vitest owns unit tests under src/ only. Playwright E2E specs live in e2e/
    // (*.spec.ts) and are explicitly excluded so the two runners never overlap.
    include: dbOnly
      ? ["src/**/*.db.test.ts"]
      : ["src/**/*.test.ts"],
    exclude: [
      "e2e/**",
      "node_modules/**",
      ".next/**",
      // The default (DB-free) run never touches the DB-backed suite.
      ...(dbOnly ? [] : ["src/**/*.db.test.ts"]),
    ],
    // DB tests share one Postgres instance; run them serially so they don't race
    // each other's tables. (No effect on the DB-free run.)
    ...(dbOnly ? { fileParallelism: false } : {}),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
