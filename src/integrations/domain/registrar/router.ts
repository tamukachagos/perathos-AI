// W4 — RegistrarRouter (ENTERPRISE_REVIEW §5.1). SERVER-ONLY.
//
// Keeps the single DomainProvider interface; selects ONE RegistrarBackend per
// TLD. Selection is server-side and goes through the dedicated hostname
// validator FIRST — an invalid/internal/disallowed host never reaches a backend.
//
//   *.za (co.za/org.za/…) → ZACR-style SA registrar backend
//   .com & other gTLDs     → international gTLD reseller backend
//
// W4 ships MOCK backends (no keys, no network). The real backends are dormant:
// when the registrar API-key envs are set a later milestone swaps the mock for a
// live adapter behind the SAME RegistrarBackend interface, with the SSRF
// outbound-allowlist (hostname.isOutboundHostAllowed) enforced before any call.
// Registrar keys are operator secrets, read ONLY here in the server action plane.

import { validateHostname, type AllowedTld } from "../hostname";
import { mockGtldBackend, mockZaBackend } from "./mockBackends";
import type { RegistrarBackend, RegistrarKind } from "./types";

export type { RegistrarBackend, RegistrarKind } from "./types";
export type { AvailabilityQuote } from "./types";

/** Map a (validated) TLD to its registrar kind. */
export function registrarKindForTld(tld: AllowedTld): RegistrarKind {
  // Any South African second-level domain routes to the ZACR backend; every
  // other allowed suffix is a gTLD handled by the reseller backend.
  return tld.endsWith("za") ? "za" : "gtld";
}

/**
 * Resolve the registrar backend for a hostname. Returns `null` when the hostname
 * is invalid / disallowed (the caller must reject — NEVER fall through to a
 * backend). This is the single selection chokepoint.
 *
 * In W4 both kinds resolve to their MOCK backend. A live build reads the
 * registrar-key envs here and substitutes a live adapter for the matching kind.
 */
export function selectRegistrar(hostname: string): {
  backend: RegistrarBackend;
  kind: RegistrarKind;
  tld: AllowedTld;
} | null {
  const result = validateHostname(hostname);
  if (!result.ok) return null;
  const kind = registrarKindForTld(result.tld);
  const backend = kind === "za" ? mockZaBackend : mockGtldBackend;
  return { backend, kind, tld: result.tld };
}

/**
 * The configured registrar backend for a kind, irrespective of a specific
 * hostname (used by the live-swap point + tests). W4: always the mock.
 */
export function backendForKind(kind: RegistrarKind): RegistrarBackend {
  return kind === "za" ? mockZaBackend : mockGtldBackend;
}
