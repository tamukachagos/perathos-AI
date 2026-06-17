// The ActionRouter — the single server-side chokepoint for every risky adapter
// verb (M3). Nothing in the action plane runs except through `executeAction`.
//
// For each call it:
//   (a) classifies the verb (gated? async?);
//   (b) for GATED verbs, requires a payload-bound, single-use, unexpired
//       approval token (verb + payloadHash + idempotencyKey all bound — see
//       approvalToken.ts) and consumes its nonce exactly once;
//   (c) writes an APPEND-ONLY audit_log entry on EVERY attempt — allowed OR
//       denied — with a PII-free metadata summary (no payload, no token);
//   (d) for slow (async) verbs, starts an operation and returns 202 + an
//       OperationRef the client polls; the mock reconciliation settles it.
//
// The router is repository- and store-aware but adapter-agnostic: it looks the
// adapter up in the registry and invokes its `action()`. Adapters therefore do
// NOT each re-implement gating — they route through here (see actions.ts).

import type { Business } from "@/lib/types";
import type { AuditRepository, Repositories } from "@/lib/db/types";
import type { FeatureKey } from "@/lib/billing/entitlements";
import { checkEntitlement } from "@/lib/billing/entitlements";
import { getAdapter } from "./registry";
import type { ProviderInterface } from "./types";
import {
  digestPayload,
  verifyToken,
  type ApprovalClaims,
} from "./approvalToken";
import { consumeNonce } from "./approvalStore";
import {
  getOperation,
  settleOperation,
  startOperation,
  type OperationRecord,
} from "./operationStore";
import { logger } from "@/lib/logger";

/**
 * The risky verbs that flow through approval gating. Keyed by `verb`; the value
 * pins the owning adapter interface and whether the verb is async (slow vendor
 * → 202 + OperationRef). This is the per-verb gating table the architecture
 * mandates (gating is per-verb, NOT a per-adapter boolean).
 */
export interface GatedVerbSpec {
  interfaceName: ProviderInterface;
  async: boolean;
  /** Human label for audit/UI. */
  label: string;
  /** Pull the operation `target` out of the payload (for async verbs). */
  target?: (payload: Record<string, unknown>) => string;
  /**
   * Paid-plan entitlement this verb requires (M6). When set, the router checks
   * the tenant's plan BEFORE the approval token, so a free tenant cannot even
   * approve a paid action. Requires `subscriptions` in RouterDeps.
   */
  requiresEntitlement?: FeatureKey;
}

export const GATED_VERBS: Record<string, GatedVerbSpec> = {
  "domain.register": {
    interfaceName: "DomainProvider",
    async: true,
    label: "Register domain",
    target: (p) => String(p.domain ?? ""),
    requiresEntitlement: "customDomain",
  },
  "dns.write": {
    interfaceName: "DnsProvider",
    async: false,
    label: "Write DNS records",
    target: (p) => String(p.domain ?? ""),
    requiresEntitlement: "customDomain",
  },
  "hosting.publish": {
    interfaceName: "HostingProvider",
    async: false,
    label: "Publish site",
    target: (p) => String(p.slug ?? ""),
  },
  "hosting.deploy": {
    interfaceName: "HostingProvider",
    async: true,
    label: "Deploy site",
    target: (p) => String(p.slug ?? ""),
  },
  "payment.configure": {
    interfaceName: "PaymentProvider",
    async: false,
    label: "Configure payments",
    target: (p) => String(p.account ?? ""),
    requiresEntitlement: "payments",
  },
  "email.provision": {
    interfaceName: "EmailProvider",
    async: true,
    label: "Provision mailboxes",
    target: (p) => String(p.domain ?? ""),
  },
};

export function isGatedVerb(verb: string): boolean {
  return verb in GATED_VERBS;
}

export interface ExecuteParams {
  tenantId: string;
  actorId: string | null;
  verb: string;
  business: Business;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  /** Required for gated verbs; ignored for ungated ones. */
  approvalToken?: string;
  /** Tests pass a fixed clock; defaults to Date.now(). */
  now?: number;
  /**
   * B17: settlement delay for async ops, DECOUPLED from `now`. A real clock
   * keeps a real delay; tests pass 0 to settle immediately. Injecting `now` no
   * longer collapses the delay to 0 (which defeated the pending→poll contract).
   * Defaults to the store's MOCK_SETTLE_MS when unset.
   */
  settleDelayMs?: number;
}

export type ExecuteOutcome =
  | {
      status: "allowed";
      detail: string;
      operation?: OperationRecord;
    }
  | {
      status: "accepted"; // 202 — async op started
      detail: string;
      operation: OperationRecord;
    }
  | {
      status: "denied";
      reason: DenyReason;
      detail: string;
    };

export type DenyReason =
  | "missing_token"
  | "bad_token"
  | "expired_token"
  | "payload_mismatch"
  | "verb_mismatch"
  | "idempotency_mismatch"
  | "replayed_token"
  | "tenant_mismatch"
  | "entitlement_required"
  | "unknown_verb";

/** Audit action names — one stream, allow/deny distinguished by suffix. */
const AUDIT_ALLOW = "action.allowed";
const AUDIT_DENY = "action.denied";

interface RouterDeps {
  audit: AuditRepository;
  /**
   * Subscriptions repo, REQUIRED to dispatch any verb that carries
   * `requiresEntitlement` (M6/B9). It is typed optional only so call sites that
   * exclusively dispatch non-entitlement verbs need not pass it; for an
   * entitlement-bearing verb the gate FAILS CLOSED (denies) when it is absent,
   * rather than silently skipping the check.
   */
  subscriptions?: Repositories["subscriptions"];
}

/**
 * The single entry point. Validates gating + token, ALWAYS audits, then invokes
 * the adapter's action plane (mock no-op in M3). Never throws on a denied or
 * failed action — it returns a structured outcome so callers (server actions /
 * route handlers) can map it to an HTTP status.
 */
export async function executeAction(
  deps: RouterDeps,
  params: ExecuteParams,
): Promise<ExecuteOutcome> {
  const {
    tenantId,
    actorId,
    verb,
    business,
    payload = {},
    idempotencyKey,
    approvalToken,
    now = Date.now(),
    settleDelayMs,
  } = params;

  const spec = GATED_VERBS[verb];
  const payloadHash = digestPayload(payload);

  // Helper: append-only audit on every path, with a PII-free summary. The raw
  // payload and token are NEVER written — only the bound hash + idempotency key.
  const audit = (
    action: string,
    extra: Record<string, unknown>,
  ): Promise<unknown> =>
    deps.audit.append(tenantId, {
      actorId,
      action,
      targetType: "action",
      targetId: verb,
      metadata: { verb, payloadHash, idempotencyKey, ...extra },
    });

  const deny = async (
    reason: DenyReason,
    detail: string,
  ): Promise<ExecuteOutcome> => {
    await audit(AUDIT_DENY, { reason });
    return { status: "denied", reason, detail };
  };

  // --- Entitlement gate (M6/B9): a paid-plan verb is rejected for a free tenant
  // BEFORE the approval token is even checked, so an unentitled action can't be
  // approved. FAIL CLOSED: if a verb declares `requiresEntitlement` but the
  // subscriptions repo is not wired, we cannot prove entitlement, so we DENY
  // (never silently skip the gate). Callers MUST pass `subscriptions` for any
  // entitlement-bearing verb (see RouterDeps).
  if (spec?.requiresEntitlement) {
    if (!deps.subscriptions) {
      return deny(
        "entitlement_required",
        "Entitlement could not be verified for this action.",
      );
    }
    const check = await checkEntitlement(
      deps.subscriptions,
      tenantId,
      spec.requiresEntitlement,
    );
    if (!check.allowed) {
      return deny("entitlement_required", check.detail);
    }
  }

  // --- Gating: gated verbs require a valid, payload-bound, single-use token ---
  if (spec) {
    if (!approvalToken) {
      return deny("missing_token", `"${verb}" requires owner approval.`);
    }

    const verified = verifyToken(approvalToken, now);
    if (!verified.ok) {
      const map: Record<typeof verified.reason, DenyReason> = {
        malformed: "bad_token",
        bad_signature: "bad_token",
        expired: "expired_token",
      };
      return deny(
        map[verified.reason],
        verified.reason === "expired"
          ? "Approval has expired — request a new one."
          : "Approval token is invalid.",
      );
    }

    const claims: ApprovalClaims = verified.claims;
    // Binding checks: the token must have been minted for THIS verb, THIS
    // payload, and THIS idempotency key — a swap of any of them is rejected even
    // though the HMAC over the (different) original claims is valid.
    if (claims.verb !== verb) {
      return deny("verb_mismatch", "Approval was issued for a different action.");
    }
    if (claims.payloadHash !== payloadHash) {
      return deny(
        "payload_mismatch",
        "The action's details changed since approval — re-approve to continue.",
      );
    }
    if (claims.idempotencyKey !== idempotencyKey) {
      return deny(
        "idempotency_mismatch",
        "Approval does not match this attempt.",
      );
    }

    // Single-use: consume the nonce. A replay of an otherwise-valid token is
    // rejected here. The consume is atomic in the persistent store (UPDATE …
    // WHERE consumed_at IS NULL), so a concurrent double-spend cannot win twice.
    const consumed = await consumeNonce(claims.nonce, tenantId);
    if (!consumed.ok) {
      const reason: DenyReason =
        consumed.reason === "tenant_mismatch"
          ? "tenant_mismatch"
          : "replayed_token";
      return deny(
        reason,
        consumed.reason === "already_consumed"
          ? "This approval has already been used."
          : "Approval could not be verified for this account.",
      );
    }
  }

  // --- Allowed. Resolve the target adapter interface. S9: DEFAULT-DENY — an
  // ungated verb whose namespace does not map to a known provider interface is
  // rejected rather than silently routed to a real action plane. A typo'd or
  // attacker-supplied verb therefore cannot reach an adapter ungated.
  const interfaceName = spec?.interfaceName ?? inferInterface(verb);
  if (!interfaceName) {
    return deny("unknown_verb", `"${verb}" is not a recognised action.`);
  }
  const adapter = getAdapter(interfaceName);

  if (spec?.async) {
    const target = spec.target?.(payload) ?? verb;
    // B7: idempotency is folded into (tenantId, idempotencyKey) by the store, so
    // a retry re-attaches to the same op rather than starting a duplicate.
    const operation = await startOperation({
      tenantId,
      verb,
      target,
      idempotencyKey,
      // B17: the settlement delay is explicit, NOT inferred from an injected
      // clock. Tests pass settleDelayMs:0 for instant settlement.
      settleDelayMs,
    });

    // B2: actually CALL the adapter's action plane. The async verbs previously
    // returned 202 without ever invoking the adapter and reconcile() then
    // marked them `succeeded` unconditionally — so the owner was told a domain
    // registered when nothing happened, and real failures reported success.
    // Now: a failed dispatch settles the op to `failed`; a successful dispatch
    // leaves it `pending` to be driven terminal by the vendor webhook/cron
    // (mock: the reconcile sweep). Re-attached (idempotent) ops are NOT
    // re-dispatched.
    let settled = operation;
    if (operation.status === "pending") {
      try {
        const result = await adapter.action({ verb, business, payload });
        if (!result.ok) {
          settled =
            (await settleOperation(
              operation.id,
              "failed",
              result.detail,
              { dispatch: "adapter_rejected" },
              tenantId,
            )) ?? operation;
        }
        // result.ok === true: stay pending; webhook/cron settles to succeeded.
      } catch (error) {
        // A thrown adapter (e.g. unimplemented live mode / network) is a real
        // failure — settle to `failed`, never silent success. Log the error
        // CLASS only (no payload/PII).
        logger.warn("action.async_dispatch_failed", {
          verb,
          errorClass: error instanceof Error ? error.name : "unknown",
        });
        settled =
          (await settleOperation(
            operation.id,
            "failed",
            "The provider could not start this action.",
            { dispatch: "adapter_threw" },
            tenantId,
          )) ?? operation;
      }
    }

    await audit(AUDIT_ALLOW, {
      async: true,
      operationId: settled.id,
      target,
      opStatus: settled.status,
    });
    return {
      status: "accepted",
      detail: `${spec.label} accepted — tracking operation ${settled.id}.`,
      operation: settled,
    };
  }

  // Synchronous side-effecting verb: invoke the adapter action plane.
  const result = await adapter.action({ verb, business, payload });
  await audit(AUDIT_ALLOW, { async: false, ok: result.ok });
  return {
    status: "allowed",
    detail: result.detail,
  };
}

/** Re-read an operation through the router's store (tenant-scoped). */
export function readOperation(
  id: string,
  tenantId: string,
): Promise<OperationRecord | null> {
  return getOperation(id, tenantId);
}

/**
 * Map an ungated verb to its adapter interface, used only for verbs not in
 * GATED_VERBS (so the router can still dispatch known read-only/ungated verbs).
 * Ungated verbs are namespaced `interface.verb` where the interface maps below.
 *
 * S9 — DEFAULT-DENY: an unknown namespace returns `null` so the caller refuses
 * the verb. We never fall back to a real action plane (previously HostingProvider),
 * which would route a typo'd/attacker-supplied verb to a live adapter ungated.
 */
function inferInterface(verb: string): ProviderInterface | null {
  const ns = verb.split(".")[0];
  const map: Record<string, ProviderInterface> = {
    domain: "DomainProvider",
    dns: "DnsProvider",
    hosting: "HostingProvider",
    github: "GitHubProvider",
    email: "EmailProvider",
    messaging: "MessagingProvider",
    payment: "PaymentProvider",
    analytics: "AnalyticsProvider",
    agent: "AgentProvider",
  };
  return map[ns] ?? null;
}
