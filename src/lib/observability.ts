// Optional observability wiring (M5).
//
// Sentry is OPTIONAL. It is enabled ONLY when SENTRY_DSN is set; with it unset
// (the M0/mock default) every function here is a no-op and `@sentry/nextjs` is
// never imported, so mock mode stays clean and `next build` needs no secrets.
//
// `@sentry/nextjs` is loaded LAZILY via dynamic import so the dependency is
// optional at runtime: if SENTRY_DSN is set but the package is not installed,
// captureException degrades to the structured logger rather than throwing.
//
// The error path always routes through the PII-safe logger as well, so failures
// are queryable even when Sentry is off.

import { logger } from "./logger";

/** True only when a Sentry DSN is configured. */
export function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN && process.env.SENTRY_DSN.trim());
}

// Minimal shape we use from Sentry. We do NOT import the package's types: it is
// an OPTIONAL dependency and may be absent at typecheck time, so the lazy import
// target is a runtime variable (TS sees `any`) and the result is narrowed to
// this interface. The real package augments nothing here.
interface SentryLike {
  captureException: (e: unknown, ctx?: unknown) => void;
  captureMessage: (m: string, ctx?: unknown) => void;
}

// The package name as a variable so `import()` is not a static literal — this
// keeps tsc from requiring `@sentry/nextjs` to be installed to typecheck.
const SENTRY_MODULE = "@sentry/nextjs";

// Cache the lazily-imported Sentry module (or `null` when unavailable/off).
let sentryPromise: Promise<SentryLike | null> | undefined;

async function loadSentry(): Promise<SentryLike | null> {
  if (!sentryEnabled()) return null;
  sentryPromise ??= import(/* webpackIgnore: true */ SENTRY_MODULE)
    .then((mod) => mod as SentryLike)
    .catch(() => {
      // Package not installed but DSN set: log once and stay degraded.
      logger.warn("sentry.unavailable", {
        reason: "@sentry/nextjs not installed",
      });
      return null;
    });
  return sentryPromise;
}

/**
 * Report an error. Always logs via the PII-safe logger; ALSO forwards to Sentry
 * when enabled. `fields` must already be PII-safe-able (it is scrubbed by the
 * logger). Never throws.
 */
export async function captureError(
  event: string,
  error: unknown,
  fields?: Record<string, unknown>,
): Promise<void> {
  logger.error(event, {
    ...fields,
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    const sentry = await loadSentry();
    sentry?.captureException(error, { extra: { event, ...fields } });
  } catch {
    // Observability must never break the request path.
  }
}
