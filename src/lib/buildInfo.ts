// Build stamp — the deploy's commit SHA + build time, baked in by next.config's
// `env` (LD_BUILD_SHA / LD_BUILD_TIME). Client-safe: pure process.env reads, no
// Node APIs. Lets the UI footer and /api/health report exactly which build is
// live, so a stale deploy is obvious at a glance.

export const BUILD_SHA: string = process.env.LD_BUILD_SHA ?? "dev";
export const BUILD_SHA_SHORT: string =
  BUILD_SHA === "dev" ? "dev" : BUILD_SHA.slice(0, 7);
export const BUILD_TIME: string = process.env.LD_BUILD_TIME ?? "";
