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
  hashPayload,
  verifyToken,
  type ApprovalClaims,
} from "./approvalToken";
import { consumeNonce } from "./approvalStore";
import {
  getOperation,
  startOperation,
  type OperationRecord,
} from "./operationStore";

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
  | "entitlement_required";

/** Audit action names — one stream, allow/deny distinguished by suffix. */
const AUDIT_ALLOW = "action.allowed";
const AUDIT_DENY = "action.denied";

interface RouterDeps {
  audit: AuditRepository;
  /**
   * Subscriptions repo, required only to enforce paid-plan entitlements on verbs
   * that carry `requiresEntitlement` (M6). Optional so existing call sites that
   * pass only `audit` keep working; when absent, entitlement checks are skipped.
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
  } = params;

  const spec = GATED_VERBS[verb];
  const payloadHash = hashPayload(payload);

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

  // --- Entitlement gate (M6): a paid-plan verb is rejected for a free tenant
  // BEFORE the approval token is even checked, so an unentitled action can't be
  // approved. Skipped when the subscriptions repo isn't wired (back-compat).
  if (spec?.requiresEntitlement && deps.subscriptions) {
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
    // rejected here.
    const consumed = consumeNonce(claims.nonce, tenantId);
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

  // --- Allowed. Async verbs return 202 + an OperationRef; the rest run inline.
  const adapter = getAdapter(
    spec?.interfaceName ?? inferInterface(verb),
  );

  if (spec?.async) {
    const target = spec.target?.(payload) ?? verb;
    const operation = startOperation({
      tenantId,
      verb,
      target,
      idempotencyKey,
      settleDelayMs: params.now !== undefined ? 0 : undefined,
    });
    await audit(AUDIT_ALLOW, {
      async: true,
      operationId: operation.id,
      target,
    });
    return {
      status: "accepted",
      detail: `${spec.label} accepted — tracking operation ${operation.id}.`,
      operation,
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
): OperationRecord | null {
  return getOperation(id, tenantId);
}

/**
 * Best-effort mapping from an ungated verb to its adapter interface, used only
 * for verbs not in GATED_VERBS (so the router can still dispatch them). Ungated
 * verbs are namespaced `interface.verb` where interface maps below.
 */
function inferInterface(verb: string): ProviderInterface {
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
  return map[ns] ?? "HostingProvider";
}
