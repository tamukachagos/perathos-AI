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
export const env = {
  /** Default action-plane mode for all adapters. */
  adapterMode: readMode(process.env.LAUNCH_DESK_ADAPTER_MODE, "mock"),

  /** Public base URL for building absolute site links; safe localhost default. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;

/** True when we are running entirely on mocks (the M0 default). */
export function isMockMode(): boolean {
  return env.adapterMode === "mock";
}
