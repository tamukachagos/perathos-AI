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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
