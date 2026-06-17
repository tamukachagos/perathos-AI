import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // M0 runs entirely on mocks: no env vars, no database, no secrets required.
  // ESLint and TS are enforced as CI gates, so we do NOT silence them here.
};

export default nextConfig;
