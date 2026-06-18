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
import { estimateVerbCostMicro } from "@/lib/billing/meteringConfig";
import { planEstimateMicro, resolvePlacement } from "@/integrations/hosting/catalog";
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
  /**
   * W2 — per-verb pre-flight cost estimate (ZAR micro-cents). When > 0 the
   * router checks the wallet can cover it BEFORE doing work (requires `wallet`
   * in RouterDeps), mirroring the entitlement gate. Defaults to the config
   * estimate map (estimateVerbCostMicro) when unset; W3/W5 supply real numbers.
   * A verb whose estimate resolves to 0 costs nothing to gate and is never
   * blocked.
   */
  estimateMicro?: (payload: Record<string, unknown>) => bigint;
}

export const GATED_VERBS: Record<string, GatedVerbSpec> = {
  "domain.register": {
    interfaceName: "DomainProvider",
    async: true,
    label: "Register domain",
    target: (p) => String(p.domain ?? p.hostname ?? ""),
    requiresEntitlement: "customDomain",
  },
  "domain.transfer": {
    // W4 — transfer in a domain via the registrar's auth-info / auth code. Gated
    // + async (ZACR settles in minutes; gTLD is the slow 5-day-ACK path). NOT
    // metered as a per-action charge in W4 (a transfer carries the existing
    // registration; renewal is where the cost lands), so its estimate is 0.
    interfaceName: "DomainProvider",
    async: true,
    label: "Transfer domain",
    target: (p) => String(p.domain ?? p.hostname ?? ""),
    requiresEntitlement: "customDomain",
    estimateMicro: () => 0n,
  },
  "domain.renew": {
    // W4 — renew a domain (auto-renew aware). Gated + async + METERED at the
    // domain markup. The pre-flight credit estimate comes from the config map
    // (estimateVerbCostMicro), like domain.register.
    interfaceName: "DomainProvider",
    async: true,
    label: "Renew domain",
    target: (p) => String(p.domain ?? p.hostname ?? ""),
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
    // W6 — StaticTier (Vercel) deploy. Gated + ASYNC: starts a W1 op and returns
    // 202; the Vercel webhook (mock: reconcile sweep) settles it to live/failed.
    // NOT METERED in W6 — static hosting is plan-included (§8), so the estimate
    // is 0 (the config map's ~R50 estimate is for the future metered tiers; the
    // StaticTier deploy never debits the wallet). Container/K8s are Phase 3.
    interfaceName: "HostingProvider",
    async: true,
    label: "Deploy site",
    target: (p) => String(p.slug ?? ""),
    estimateMicro: () => 0n,
  },
  "hosting.provision": {
    // W5 — provision managed (container/K8s) hosting. Gated + ASYNC under the
    // `managedHosting` entitlement. The wallet pre-flight estimate is the
    // resolved plan's monthly retail/markup cost (resolved from the payload's
    // VETTED region + plan; a free-form/invalid region or plan yields 0 here and
    // is rejected by the service's own enum gate before any work). Provisioning
    // runs in the durable queue, NOT in this request — the adapter just enqueues.
    interfaceName: "HostingProvider",
    async: true,
    label: "Set up managed hosting",
    target: (p) => String(p.slug ?? ""),
    requiresEntitlement: "managedHosting",
    estimateMicro: (p) => {
      const resolved = resolvePlacement(p.region, p.planName);
      return resolved.ok ? planEstimateMicro(resolved.placement.plan) : 0n;
    },
  },
  "hosting.scale": {
    // W5 — scale a running managed deployment. Gated + ASYNC, `managedHosting`.
    // Not a per-action wallet charge (usage is metered by the tick) → estimate 0.
    // The max-scale ceiling is enforced server-side against the plan, not here.
    interfaceName: "HostingProvider",
    async: true,
    label: "Resize managed hosting",
    target: (p) => String(p.slug ?? ""),
    requiresEntitlement: "managedHosting",
    estimateMicro: () => 0n,
  },
  "hosting.teardown": {
    // W5 — tear down a managed deployment (stops the meter). Gated + ASYNC,
    // `managedHosting`. Never a charge → estimate 0. Non-payment / kill-switch
    // tear-downs are driven server-side and also flow through this verb.
    interfaceName: "HostingProvider",
    async: true,
    label: "Stop managed hosting",
    target: (p) => String(p.slug ?? ""),
    requiresEntitlement: "managedHosting",
    estimateMicro: () => 0n,
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
  "gbp.create": {
    // W8 (B1) — list the business on Google. Gated + ASYNC: Google verification
    // is asynchronous, so this returns 202 + an OperationRef and settles to
    // live/failed via the W1 op (mock: reconcile sweep; live: Google webhook).
    // Gated on the Growth+ `payments` entitlement (GBP is a Growth+ feature).
    // NOT metered (no per-action wallet charge) → estimate 0.
    interfaceName: "LocalListingProvider",
    async: true,
    label: "List on Google",
    target: (p) => String(p.name ?? ""),
    requiresEntitlement: "payments",
    estimateMicro: () => 0n,
  },
  "gbp.sync": {
    // W8 (B1) — push NAP/hours/category updates to GBP. Gated + sync. Not
    // metered.
    interfaceName: "LocalListingProvider",
    async: false,
    label: "Update Google listing",
    target: (p) => String(p.name ?? ""),
    requiresEntitlement: "payments",
    estimateMicro: () => 0n,
  },
  "whatsapp.publishCatalog": {
    // W8 (B2) — publish the WhatsApp product catalog. Gated + sync. Not metered
    // (the per-message charge lands on sendMessage/sendTemplate, not publish).
    interfaceName: "MessagingProvider",
    async: false,
    label: "Publish WhatsApp catalog",
    target: () => "catalog",
    requiresEntitlement: "payments",
    estimateMicro: () => 0n,
  },
  "github.mergePR": {
    // W7 — merge a PR the agent team opened, AFTER the Reviewer + CI gates and
    // (for REVIEW/ESCALATE tiers) the owner's approval. Gated + sync, under the
    // `agentTeam` entitlement. The agent NEVER mints the token for this — only
    // the owner-facing approval endpoint does (the never-self-approve invariant).
    // Not a per-action wallet charge (the agent run was metered) → estimate 0.
    interfaceName: "GitHubProvider",
    async: false,
    label: "Merge the team's pull request",
    target: (p) => String(p.prUrl ?? p.branch ?? ""),
    requiresEntitlement: "agentTeam",
    estimateMicro: () => 0n,
  },
  "agent.deployFix": {
    // W7 — deploy a merged agent fix. Gated + ASYNC (like hosting.deploy): starts
    // a W1 op and returns 202; the Vercel webhook settles it, and a failed
    // post-deploy health check rolls back via currentVersionId. Under the
    // `agentTeam` entitlement. Static hosting is plan-included → estimate 0.
    interfaceName: "HostingProvider",
    async: true,
    label: "Deploy the team's fix",
    target: (p) => String(p.slug ?? ""),
    requiresEntitlement: "agentTeam",
    estimateMicro: () => 0n,
  },
  "agent.applyContent": {
    // W7 — apply an AUTO-tier content/copy swap the team produced. Gated + sync,
    // under the `agentTeam` entitlement. For an AUTO-tier change the owner-facing
    // approval is auto-issued (autoApproveContent) but STILL minted by the owner
    // endpoint, never by the agent. Content swaps are plan-included → estimate 0.
    interfaceName: "GitHubProvider",
    async: false,
    label: "Apply a content update",
    target: (p) => String(p.slug ?? ""),
    requiresEntitlement: "agentTeam",
    estimateMicro: () => 0n,
  },
  "whatsapp.createPaymentLink": {
    // W8 (B2) — create a ZAR payment link for an order, via the PaymentProvider.
    // Gated + sync; entitlement-checked (payments). The link creation itself is
    // not a metered wallet charge (the payment is the customer's, not the
    // tenant's cost) → estimate 0.
    interfaceName: "PaymentProvider",
    async: false,
    label: "Create WhatsApp payment link",
    target: (p) => String(p.orderId ?? ""),
    requiresEntitlement: "payments",
    estimateMicro: () => 0n,
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
  | "insufficient_credits"
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
  /**
   * W2 — the wallet repo, REQUIRED to dispatch any verb with a non-zero cost
   * estimate. Like `subscriptions`, it is typed optional only so call sites that
   * exclusively dispatch zero-cost verbs need not pass it; for a cost-bearing
   * verb the credit gate FAILS CLOSED (denies `insufficient_credits`) when it is
   * absent, rather than silently skipping the check.
   */
  wallet?: Repositories["wallet"];
}

/**
 * W2 — Pre-flight credit gate helper. Returns whether the tenant's wallet can
 * cover `estimateMicro` (ZAR micro-cents). An estimate of 0 (a free verb) always
 * passes. This is the wallet analogue of checkEntitlement: deny BEFORE doing
 * cost-bearing work. Exposed so other call sites (W3 LLM router, W5 hosting) can
 * reuse the same pre-flight contract.
 */
export async function requireCredits(
  walletRepo: Repositories["wallet"],
  tenantId: string,
  estimateMicro: bigint,
): Promise<{ allowed: boolean; detail: string }> {
  if (estimateMicro <= 0n) return { allowed: true, detail: "ok" };
  const balance = await walletRepo.getBalance(tenantId);
  if (balance >= estimateMicro) return { allowed: true, detail: "ok" };
  return {
    allowed: false,
    detail:
      "Your credit balance is too low for this action. Top up your credits to continue.",
  };
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

  // --- W2 credit gate: a cost-bearing verb is denied BEFORE any work (and
  // before the token is consumed) when the wallet cannot cover the estimated
  // cost. The estimate comes from the verb's `estimateMicro` hook, or the config
  // map (estimateVerbCostMicro) by default. A zero estimate means the verb is
  // free to gate and is never blocked, so non-cost verbs are unaffected.
  // FAIL CLOSED: if the estimate is > 0 but the wallet repo is not wired, we
  // cannot prove the tenant can pay, so we DENY (never silently skip the gate).
  const estimateMicro = spec?.estimateMicro
    ? spec.estimateMicro(payload)
    : estimateVerbCostMicro(verb);
  if (estimateMicro > 0n) {
    if (!deps.wallet) {
      return deny(
        "insufficient_credits",
        "Credit balance could not be verified for this action.",
      );
    }
    const credit = await requireCredits(deps.wallet, tenantId, estimateMicro);
    if (!credit.allowed) {
      return deny("insufficient_credits", credit.detail);
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
    // W8: WhatsApp commerce verbs (whatsapp.sendMessage / whatsapp.sendTemplate)
    // ride the MessagingProvider. The gated whatsapp.* verbs pin their interface
    // in GATED_VERBS; this default-allow mapping covers the ungated, metered
    // send verbs so a typo'd whatsapp.* verb still resolves to Messaging rather
    // than default-denying (S9 is about UNKNOWN namespaces, not known ones).
    whatsapp: "MessagingProvider",
    payment: "PaymentProvider",
    analytics: "AnalyticsProvider",
    agent: "AgentProvider",
    gbp: "LocalListingProvider",
  };
  return map[ns] ?? null;
}
