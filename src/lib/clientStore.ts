// Client-only draft/site store. In M0 this is localStorage (a TEMPORARY store);
// M1 replaces it with Postgres + Auth.js sessions behind the same read/write
// shape. Ported from the prototype's localStorage helpers in src/siteEngine.js.
//
// This module must only run in the browser — guard every access for SSR safety.

import type { Business, PublishedSites } from "./types";
import { initialBusiness } from "./platformData";

const DRAFT_KEY = "launchdesk:draft:v1";
const SITES_KEY = "launchdesk:sites:v1";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can fail in private browsing or locked-down environments.
  }
}

export function readStoredDraft(): Business {
  return { ...initialBusiness, ...readJson<Partial<Business>>(DRAFT_KEY, {}) };
}

export function writeStoredDraft(business: Business): void {
  writeJson(DRAFT_KEY, business);
}

export function readPublishedSites(): PublishedSites {
  return readJson<PublishedSites>(SITES_KEY, {});
}

export function writePublishedSites(sites: PublishedSites): void {
  writeJson(SITES_KEY, sites);
}

// Absolute, shareable URL for a published site under the App Router (/s/:slug).
export function siteUrl(slug: string): string {
  if (typeof window === "undefined") return `/s/${slug}`;
  return `${window.location.origin}/s/${slug}`;
}
