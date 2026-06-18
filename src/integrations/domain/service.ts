// W4 — Domain service (SERVER-ONLY orchestration for the multi-domain verbs).
//
// The thin layer that sits between the server actions / ActionRouter and:
//   * the RegistrarRouter (TLD → backend selection, behind the hostname gate),
//   * the domains repo (tenant-owned persistence + lifecycle), and
//   * the metering wallet (recordUsage at the domain markup).
//
// SERVER-ONLY: imports node:crypto (field-crypto) + the registrar backends. It
// is reached only via server actions / the ActionRouter adapter, never by a
// client component. The four verbs:
//   * checkAvailability — ungated, read-only, NO wallet charge.
//   * register / renew  — gated + async + METERED (kind domain.register/renew).
//   * transfer          — gated + async, auth-code based (encrypted at rest).

import type { Repositories, DomainRecord } from "@/lib/db/types";
import { recordUsage } from "@/lib/billing/metering";
import { MICRO_PER_CENT } from "@/lib/billing/meteringConfig";
import { logger } from "@/lib/logger";
import { validateHostname, type HostnameRejection } from "./hostname";
import { selectRegistrar } from "./registrar/router";
import type { AvailabilityQuote } from "./registrar/types";
import { encryptAuthCode } from "./fieldCrypto";

/** A friendly message for each hostname rejection (for the UI / audit detail). */
export const HOSTNAME_REJECTION_MESSAGE: Record<HostnameRejection, string> = {
  empty: "Enter a domain name to check.",
  too_long: "That domain name is too long.",
  bad_format: "That is not a valid domain name.",
  has_scheme_or_path: "Enter just the domain — no http://, slashes, or spaces.",
  internal_or_reserved: "That host is internal or reserved and cannot be registered.",
  tld_not_allowed:
    "We don't support that domain ending yet. Try .co.za or .com.",
};

export interface AvailabilityResult extends AvailabilityQuote {
  /** Retail price formatted in Rand for display, e.g. "R149.00". */
  priceZar: string;
}

function centsToZar(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * `domain.checkAvailability` — UNGATED, read-only. Validates the hostname,
 * selects the right registrar by TLD, and returns availability + ZAR price. NO
 * wallet charge. Returns a rejection reason for an invalid/disallowed host so
 * the caller can show a friendly message rather than calling a backend.
 */
export async function checkAvailability(
  hostname: string,
): Promise<
  | { ok: true; quote: AvailabilityResult }
  | { ok: false; reason: HostnameRejection; detail: string }
> {
  const validated = validateHostname(hostname);
  if (!validated.ok) {
    return {
      ok: false,
      reason: validated.reason,
      detail: HOSTNAME_REJECTION_MESSAGE[validated.reason],
    };
  }
  const selected = selectRegistrar(validated.hostname);
  if (!selected) {
    return {
      ok: false,
      reason: "tld_not_allowed",
      detail: HOSTNAME_REJECTION_MESSAGE.tld_not_allowed,
    };
  }
  const quote = await selected.backend.checkAvailability(validated.hostname);
  return {
    ok: true,
    quote: { ...quote, priceZar: centsToZar(quote.priceCents) },
  };
}

/**
 * Build the ungated availability options for BOTH the .com and .co.za variants
 * of a bare second-level name (the UI shows both with prices + a tick). A name
 * that already carries a supported suffix is checked as-is for that suffix only.
 */
export async function checkAvailabilityOptions(
  input: string,
): Promise<{
  base: string;
  options: AvailabilityResult[];
  detail?: string;
}> {
  const raw = (input ?? "").trim().toLowerCase();
  // Derive the bare label (strip a trailing supported suffix if present).
  const validatedAsIs = validateHostname(raw);
  let base = raw;
  if (validatedAsIs.ok) {
    base = validatedAsIs.sld;
  } else {
    // Keep only the leading label of a dotted input, else the whole token.
    base = raw.split(".")[0] ?? raw;
  }
  // Sanitise the base label to valid DNS chars so we can compose candidates.
  base = base.replace(/[^a-z0-9-]/g, "");
  if (!base) {
    return { base: "", options: [], detail: HOSTNAME_REJECTION_MESSAGE.empty };
  }
  const candidates = [`${base}.co.za`, `${base}.com`];
  const options: AvailabilityResult[] = [];
  for (const candidate of candidates) {
    const result = await checkAvailability(candidate);
    if (result.ok) options.push(result.quote);
  }
  return { base, options };
}

export interface DispatchInput {
  tenantId: string;
  hostname: string;
  /** The W1 operation id this domain is bound to (set after startOperation). */
  operationId?: string | null;
  businessId?: string | null;
  autoRenew?: boolean;
  /** PLAINTEXT auth code for a transfer; encrypted here before persistence. */
  authCode?: string | null;
}

/**
 * Persist a domain row at REGISTER request time (bound to tenantId here, per the
 * security note "bind every domain to tenantId at request time"). Idempotent on
 * (tenant, hostname): a retry updates the existing row rather than duplicating.
 */
export async function upsertDomainForRegister(
  repos: Repositories,
  input: DispatchInput,
): Promise<DomainRecord> {
  const validated = validateHostname(input.hostname);
  if (!validated.ok) throw new Error("Invalid hostname for registration.");
  const selected = selectRegistrar(validated.hostname);
  if (!selected) throw new Error("No registrar backend for this hostname.");
  const quote = await selected.backend.checkAvailability(validated.hostname);

  const existing = await repos.domains.getByHostname(
    input.tenantId,
    validated.hostname,
  );
  if (existing) {
    return repos.domains.update(input.tenantId, existing.id, {
      status: "pending_registration",
      operationId: input.operationId ?? existing.operationId,
      autoRenew: input.autoRenew ?? existing.autoRenew,
    });
  }
  return repos.domains.create(input.tenantId, {
    businessId: input.businessId ?? null,
    hostname: validated.hostname,
    status: "pending_registration",
    tld: validated.tld,
    registrar: selected.kind,
    registrarRef: null,
    autoRenew: input.autoRenew ?? false,
    costCents: quote.costCents,
    priceCents: quote.priceCents,
    operationId: input.operationId ?? null,
  });
}

/**
 * Persist a domain row for a TRANSFER request. The auth code is ENCRYPTED here
 * (AES-256-GCM) before it ever reaches the repo — the DB never sees plaintext.
 */
export async function upsertDomainForTransfer(
  repos: Repositories,
  input: DispatchInput,
): Promise<DomainRecord> {
  const validated = validateHostname(input.hostname);
  if (!validated.ok) throw new Error("Invalid hostname for transfer.");
  const selected = selectRegistrar(validated.hostname);
  if (!selected) throw new Error("No registrar backend for this hostname.");
  const encrypted = input.authCode ? encryptAuthCode(input.authCode) : null;

  const existing = await repos.domains.getByHostname(
    input.tenantId,
    validated.hostname,
  );
  if (existing) {
    return repos.domains.update(input.tenantId, existing.id, {
      status: "transfer_pending",
      authCode: encrypted ?? existing.authCode,
      operationId: input.operationId ?? existing.operationId,
    });
  }
  return repos.domains.create(input.tenantId, {
    businessId: input.businessId ?? null,
    hostname: validated.hostname,
    status: "transfer_pending",
    tld: validated.tld,
    registrar: selected.kind,
    authCode: encrypted,
    operationId: input.operationId ?? null,
  });
}

/**
 * METER a register/renew at the DOMAIN markup. The retail price is the wholesale
 * cost × the domain markup (applied inside recordUsage via multiplierForKind for
 * a "domain.*" kind). Exactly-once keyed on the operation's idempotency key, so a
 * retry of the same op never double-debits. The wallet was already pre-flight
 * gated by the ActionRouter; this performs the actual debit on accept.
 */
export async function meterDomainVerb(
  repos: Repositories,
  params: {
    tenantId: string;
    kind: "domain.register" | "domain.renew";
    hostname: string;
    idempotencyKey: string;
  },
): Promise<void> {
  const selected = selectRegistrar(params.hostname);
  if (!selected) return; // already validated upstream; defensive no-op
  const quote = await selected.backend.checkAvailability(params.hostname);
  // Wholesale cost in micro-cents (cents → micro). recordUsage applies the
  // domain markup multiplier for the "domain.*" kind to get the retail price.
  const unitCostMicro = BigInt(quote.costCents) * MICRO_PER_CENT;
  const result = await recordUsage(repos, {
    tenantId: params.tenantId,
    kind: params.kind,
    quantity: 1,
    unitCostMicro,
    idempotencyKey: params.idempotencyKey,
  });
  logger.info("domain.metered", {
    kind: params.kind,
    applied: result.applied,
    registrar: selected.kind,
  });
}
