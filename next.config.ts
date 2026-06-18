import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // M0 runs entirely on mocks: no env vars, no database, no secrets required.
  // ESLint and TS are enforced as CI gates, so we do NOT silence them here.
  //
  // Build stamp: bake the deploy's commit SHA + build time into the bundle so
  // "which build is live?" is answerable at a glance (footer chip + /api/health).
  // Vercel sets VERCEL_GIT_COMMIT_SHA at build; "dev" locally. `env` inlines
  // these as process.env.* on both server and client.
  env: {
    LD_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    LD_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
