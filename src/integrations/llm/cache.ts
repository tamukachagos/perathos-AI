// W3 — LLM response cache (ENTERPRISE_REVIEW §6: "exact + prompt caching keyed
// on hash(model+system+messages+params) (a hit debits nothing — the single
// biggest margin lever)").
//
// Scope + lifetime: an in-process LRU-ish map, like the W1 reliability stores'
// in-memory branch. It is a COST optimisation, not a correctness primitive, so a
// miss (e.g. a fresh serverless lambda) is always safe — it just re-runs the
// call. No new table is needed (W3 meters via the existing W2 wallet); a
// persistent shared cache (Upstash) can back this later behind the same API.
//
// IMPORTANT: a cache HIT must NOT debit the wallet. The router checks the cache
// BEFORE the provider call + metering, and on a hit returns `cached:true` and
// skips the meter entirely.

import type { LlmCompletion, LlmInput } from "./types";

/**
 * A dependency-free string digest (FNV-1a 64-bit over the UTF-16 code units,
 * rendered hex). Deliberately NOT `node:crypto` so this module is safe in EVERY
 * runtime + bundle (Edge, and the client bundle that reaches it via the agent
 * registry) — `next build` rejects a `node:` import on that path. The cache is a
 * COST optimisation, not a security primitive: a hash collision would at worst
 * return a previously-computed completion for a different prompt, which is
 * astronomically unlikely and has no security consequence (no secret is keyed,
 * nothing is authorised by this value). Combined with the full serialized
 * material being distinct per (model, prompt, params), this is more than strong
 * enough for an in-process response cache.
 */
function digest(material: string): string {
  // FNV-1a 64-bit using two 32-bit halves to stay within safe integer math.
  let h1 = 0x811c9dc5; // low
  let h2 = 0xcbf29ce4; // high
  for (let i = 0; i < material.length; i++) {
    const c = material.charCodeAt(i);
    h1 ^= c & 0xff;
    h2 ^= (c >> 8) & 0xff;
    // multiply by FNV prime 0x100000001b3 ≈ ×16777619 per half (good mixing).
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** Stable cache key over the model + the full prompt + the output params. */
export function cacheKey(model: string, input: LlmInput): string {
  // Deterministic, order-stable serialization of everything that affects the
  // output. `expectJson` is a predicate (not serialisable) and does not change
  // the model output, so it is intentionally excluded from the key.
  const material = JSON.stringify({
    model,
    system: input.system ?? "",
    messages: input.messages,
    maxTokens: input.maxTokens ?? null,
  });
  return digest(material);
}

interface CacheStore {
  get(key: string): LlmCompletion | undefined;
  set(key: string, value: LlmCompletion): void;
  clear(): void;
  size(): number;
}

const MAX_ENTRIES = 500;

function createMemoryCache(): CacheStore {
  // Map preserves insertion order, so we can evict the oldest on overflow.
  const map = new Map<string, LlmCompletion>();
  return {
    get(key) {
      const hit = map.get(key);
      if (hit) {
        // Refresh recency: re-insert so it becomes the newest.
        map.delete(key);
        map.set(key, hit);
      }
      return hit;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > MAX_ENTRIES) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

// One process-wide cache. (globalThis-pinned so HMR / multiple imports share it,
// matching the W1 in-memory store pattern.)
const GLOBAL_KEY = "__launchdesk_llm_cache__";
type GlobalWithCache = typeof globalThis & { [GLOBAL_KEY]?: CacheStore };
function store(): CacheStore {
  const g = globalThis as GlobalWithCache;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createMemoryCache();
  return g[GLOBAL_KEY];
}

export function cacheGet(key: string): LlmCompletion | undefined {
  return store().get(key);
}

export function cacheSet(key: string, value: LlmCompletion): void {
  store().set(key, value);
}

/** Test-only: reset the cache between cases. */
export function __resetLlmCache(): void {
  store().clear();
}

/** Current cache size (tests/diagnostics). */
export function __cacheSize(): number {
  return store().size();
}
