// W4 — Dedicated hostname validator + TLD allowlist (ENTERPRISE_REVIEW Part 3.B).
//
// This is the SECURITY boundary in front of EVERY registrar call. It is
// DELIBERATELY DISTINCT from `src/lib/sanitize.ts`'s `sanitizeUrl`: that helper
// decides whether a URL is safe to RENDER as an href on a public page (scheme
// allowlist, collapse to "#"). This one decides whether a string is a real,
// registrable, public hostname we may hand to a registrar API — a much stricter
// question. A value that `sanitizeUrl` would happily render (e.g.
// "http://localhost", "https://10.0.0.1") must be REJECTED here.
//
// Pure + dependency-free: no DB, no secrets, no network. Importable by the
// (server-only) RegistrarRouter, by server actions, and by Vitest unit tests.
// It does NOT import the registry/action plane, so it is also client-safe if a
// client component ever needs a cheap pre-check (the server still re-validates).

/**
 * The public-suffix-style TLD allowlist W4 ships. The RegistrarRouter only knows
 * how to register these, so a hostname under any other suffix is rejected before
 * a backend is even selected (an unknown TLD has no registrar). This is a small
 * curated list, not the full PSL — the platform sells .co.za + common gTLDs, and
 * a closed allowlist is the safer default (deny-by-default for exotic suffixes).
 *
 * Multi-label suffixes (".co.za") are matched longest-first so "shop.co.za" maps
 * to "co.za", not "za".
 */
export const ALLOWED_TLDS = [
  // South African second-level domains (ZACR).
  "co.za",
  "org.za",
  "net.za",
  "web.za",
  // International gTLDs (reseller backend).
  "com",
  "net",
  "org",
  "io",
  "co",
  "shop",
  "africa",
] as const;

export type AllowedTld = (typeof ALLOWED_TLDS)[number];

// Longest-first so a multi-label suffix wins over its trailing single label.
const TLDS_BY_LENGTH = [...ALLOWED_TLDS].sort(
  (a, b) => b.split(".").length - a.split(".").length || b.length - a.length,
);

/**
 * Strict registrable-hostname regex. Each DNS label is 1–63 chars of
 * [a-z0-9-], not starting/ending with a hyphen; the whole name is lower-case
 * ASCII (callers lower-case first). No leading/trailing dot, no empty labels,
 * no scheme, no path, no port, no userinfo, no wildcard.
 */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,}$`);

/** Reasons a hostname is rejected (stable codes for tests + audit). */
export type HostnameRejection =
  | "empty"
  | "too_long"
  | "bad_format"
  | "has_scheme_or_path"
  | "internal_or_reserved"
  | "tld_not_allowed";

export type HostnameResult =
  | { ok: true; hostname: string; tld: AllowedTld; sld: string }
  | { ok: false; reason: HostnameRejection };

/**
 * Hostnames we must NEVER hand to a registrar (and which the outbound-allowlist
 * hook below also blocks): localhost, internal/test TLDs, and anything that is
 * really an IP literal. Registering or resolving these makes no sense and is a
 * classic SSRF/confused-deputy foothold.
 */
const RESERVED_LABELS = new Set([
  "localhost",
  "local",
  "internal",
  "intranet",
  "lan",
  "test",
  "example",
  "invalid",
  "localdomain",
]);

function looksLikeIpLiteral(host: string): boolean {
  // IPv4 dotted-quad, or anything containing ':' (IPv6) or surrounding brackets.
  if (host.includes(":") || host.includes("[") || host.includes("]")) return true;
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Validate + normalise a hostname for registrar use. Returns the lower-cased
 * hostname plus its matched TLD and second-level domain (SLD) on success, or a
 * stable rejection reason. This is the ONLY gate any registrar-facing code path
 * should call before touching a backend.
 */
export function validateHostname(input: string | null | undefined): HostnameResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  const raw = input.trim().toLowerCase();
  if (!raw) return { ok: false, reason: "empty" };
  // A total length over 253 octets is not a valid DNS name.
  if (raw.length > 253) return { ok: false, reason: "too_long" };

  // Reject anything that carries a scheme, path, query, port, userinfo, or
  // whitespace — registrar input is a bare hostname, never a URL.
  if (/[\s/\\?#@]/.test(raw) || raw.includes("://") || /:\d/.test(raw)) {
    return { ok: false, reason: "has_scheme_or_path" };
  }

  if (looksLikeIpLiteral(raw)) {
    return { ok: false, reason: "internal_or_reserved" };
  }

  const labels = raw.split(".");
  // Reject single-label / reserved hosts (localhost, *.test, *.local, etc.)
  // BEFORE the strict format check, so "localhost" reads as reserved rather
  // than a mere format error — these are never registrable regardless of shape.
  if (labels.length < 2) return { ok: false, reason: "internal_or_reserved" };
  if (RESERVED_LABELS.has(labels[labels.length - 1])) {
    return { ok: false, reason: "internal_or_reserved" };
  }

  if (!HOSTNAME_RE.test(raw)) {
    return { ok: false, reason: "bad_format" };
  }

  const tld = TLDS_BY_LENGTH.find(
    (candidate) =>
      raw === candidate || raw.endsWith(`.${candidate}`),
  );
  if (!tld) return { ok: false, reason: "tld_not_allowed" };

  // The SLD is the label immediately left of the matched suffix. The hostname
  // must have at least one label before the suffix (a bare suffix is rejected).
  const suffixLabelCount = tld.split(".").length;
  if (labels.length <= suffixLabelCount) {
    return { ok: false, reason: "bad_format" };
  }
  const sld = labels[labels.length - suffixLabelCount - 1];

  return { ok: true, hostname: raw, tld, sld };
}

/**
 * Convenience: extract just the matched TLD (or null). Used by the
 * RegistrarRouter to pick a backend without re-deriving the full validation.
 */
export function tldOf(input: string | null | undefined): AllowedTld | null {
  const result = validateHostname(input);
  return result.ok ? result.tld : null;
}

/**
 * SSRF / outbound-allowlist hook (Part 3.B "SSRF posture"). Before the (dormant)
 * live registrar adapters make any outbound HTTP call, the destination host MUST
 * pass this. It blocks internal/reserved hosts and link-local / private IP
 * literals so a registrar base URL cannot be coerced into hitting cloud metadata
 * (169.254.169.254), localhost, or an RFC1918 address. The default allowlist is
 * empty (mock mode does no outbound), so a live adapter MUST pass its configured
 * registrar host(s) explicitly.
 */
export function isOutboundHostAllowed(
  host: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  if (!h) return false;
  // Never allow IP literals or reserved/internal names outbound.
  if (looksLikeIpLiteral(h)) {
    // Block link-local, loopback, and RFC1918 ranges explicitly.
    if (
      h.startsWith("169.254.") || // link-local (cloud metadata)
      h.startsWith("127.") || // loopback
      h.startsWith("10.") || // RFC1918
      h.startsWith("192.168.") || // RFC1918
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || // RFC1918 172.16/12
      h.startsWith("0.") // "this" network
    ) {
      return false;
    }
    return false; // default-deny all bare IP literals for registrar calls
  }
  const labels = h.split(".");
  if (RESERVED_LABELS.has(labels[labels.length - 1])) return false;
  // Allow only hosts on (or subdomains of) the configured allowlist.
  return allowlist.some(
    (allowed) => h === allowed || h.endsWith(`.${allowed.toLowerCase()}`),
  );
}
