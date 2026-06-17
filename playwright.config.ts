import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config (M5). Scoped to the `e2e/` directory so it never picks
// up Vitest unit tests (src/**/*.test.ts), and Vitest never picks up these
// `*.spec.ts` files (vitest.config.ts includes only src/**/*.test.ts).
//
// The webServer builds + starts the app in MOCK mode (no DATABASE_URL, no
// secrets) and Playwright waits for it before running. In CI we build once and
// `next start`; locally `reuseExistingServer` lets you point at `next dev`.

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Build then start the production server so the golden path exercises the same
  // server-rendered output (JSON-LD, ISR) CI builds. Mock mode by default.
  webServer: {
    command: "npm run build && npm run start",
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
