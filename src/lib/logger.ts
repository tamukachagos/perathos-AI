// Structured, PII-safe logger (M5 observability).
//
// One JSON line per event so logs are queryable in any aggregator (Vercel,
// Datadog, etc.) without a parser. The logger NEVER logs PII: callers pass a
// flat fields object whose values are scrubbed — any key that looks like a
// person's identifier (email, phone, name, contact, message, address, token,
// secret) is redacted, and any string VALUE that looks like an email or a long
// digit run (a phone number) is masked regardless of its key. This is a
// belt-and-braces backstop so an accidental PII field can never leak.
//
// It has no external dependency and is safe in every runtime (Node + Edge). It
// writes to console.* which Vercel/most platforms capture as structured logs.
// When Sentry is configured (src/lib/observability.ts) errors are also forwarded
// there; the logger itself stays dependency-free.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

// Keys whose value is dropped entirely (replaced with "[redacted]"). Matched
// case-insensitively as a substring so e.g. "userEmail" or "phone_number" hit.
const REDACT_KEY_PATTERNS = [
  "email",
  "phone",
  "contact",
  "name", // catches name/firstname/lastname; "tenantname" is fine to redact too
  "message",
  "address",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "ssn",
  "idnumber",
];

// Allow-list of keys that contain "name"/"id" but are NOT PII and are useful in
// logs (so we don't over-redact operational metadata).
const SAFE_KEYS = new Set([
  "actionName",
  "interfaceName",
  "eventName",
  "fieldName",
  "tenantId",
  "businessId",
  "siteId",
  "leadId",
  "userId",
  "actorId",
  "requestId",
]);

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// A likely phone number: 8+ contiguous digits, OR a + / (...) / spaced-dashed
// grouping of 9+ digits. Deliberately does NOT match ISO-8601 timestamps
// (which embed letters `T`/`Z` and `:` separators) so operational values like
// `asOf` are not masked.
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T/;
const PHONE_RE =
  /(?:\+\d[\d\s().-]{7,}\d)|(?:\(\d{2,}\)[\d\s().-]{5,}\d)|(?:\b\d{8,}\b)/;

function looksLikePhone(value: string): boolean {
  if (ISO_TS_RE.test(value)) return false; // timestamps are not phone numbers
  return PHONE_RE.test(value);
}

function shouldRedactKey(key: string): boolean {
  if (SAFE_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  return REDACT_KEY_PATTERNS.some((p) => lower.includes(p));
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (EMAIL_RE.test(value)) return "[redacted-email]";
    if (looksLikePhone(value)) return "[redacted-number]";
    // Cap stray long strings so free-text never lands in logs verbatim.
    return value.length > 256 ? `${value.slice(0, 256)}…` : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrubValue);
  return scrubFields(value as LogFields);
}

/** Recursively scrub a fields object: redact PII-ish keys, mask PII-ish values. */
export function scrubFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = shouldRedactKey(key) ? "[redacted]" : scrubValue(value);
  }
  return out;
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const line = {
    level,
    event,
    ts: new Date().toISOString(),
    ...(fields ? scrubFields(fields) : {}),
  };
  // One JSON line per event. console.error for error/warn so platforms route
  // them to the error stream; console.log otherwise.
  const serialized = JSON.stringify(line);
  if (level === "error" || level === "warn") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
} as const;
