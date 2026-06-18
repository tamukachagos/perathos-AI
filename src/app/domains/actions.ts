"use server";

// W4 — Multi-domain server actions.
//
// Two surfaces, both tenant-scoped via requireTenant() (the client never
// supplies a tenant):
//   1. checkDomainAvailabilityAction — UNGATED, read-only. Returns .com + .co.za
//      availability + ZAR prices for a typed name. NO wallet charge, no approval,
//      no persistence. Safe to call from the client domain step directly.
//   2. runDomainGatedAction — register/transfer/renew. Mints + redeems a
//      payload-bound approval token through the ActionRouter (the single
//      chokepoint), then on accept persists the tenant-owned Domain row and
//      meters register/renew at the domain markup (exactly-once on the op key).
//
// This module is a SERVER ACTION plane file: it imports the registrar service +
// field-crypto (node:crypto) and is never statically imported by a client
// component — the client calls these actions by reference.

import type { Business } from "@/lib/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import {
  checkAvailabilityOptions,
  meterDomainVerb,
  upsertDomainForRegister,
  upsertDomainForTransfer,
  type AvailabilityResult,
} from "@/integrations/domain/service";

export interface AvailabilityResponse {
  base: string;
  options: AvailabilityResult[];
  detail?: string;
}

/**
 * UNGATED, read-only availability + price check across .com and .co.za. The
 * hostname is validated by the dedicated validator inside the service before any
 * registrar call. No wallet charge.
 */
export async function checkDomainAvailabilityAction(
  input: string,
): Promise<AvailabilityResponse> {
  // Require a tenant so the action is not an open, unauthenticated probe, but
  // perform NO write and NO charge.
  await requireTenant();
  return checkAvailabilityOptions(input);
}

export type DomainGatedVerb =
  | "domain.register"
  | "domain.transfer"
  | "domain.renew";

export interface RunDomainRequest {
  verb: DomainGatedVerb;
  business: Business;
  hostname: string;
  autoRenew?: boolean;
  /** PLAINTEXT auth code (transfer only); encrypted before persistence. */
  authCode?: string;
  /** Step-up confirmation (the owner re-affirms intent). */
  stepUp: boolean;
}

export interface RunDomainResult {
  status: "accepted" | "denied";
  detail: string;
  operationId?: string;
}

/**
 * Approve + run a gated domain verb in one server round-trip. Mirrors the
 * approval-flow split (mint token → redeem through the ActionRouter) but is
 * domain-specific so it can persist the Domain row + meter on accept. All gating
 * (entitlement + credits + single-use token) is enforced by executeAction.
 */
export async function runDomainGatedAction(
  request: RunDomainRequest,
): Promise<RunDomainResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  if (request.stepUp !== true) {
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: request.verb,
      metadata: { verb: request.verb, reason: "step_up_required" },
    });
    return { status: "denied", detail: "Step-up confirmation is required." };
  }

  // Build the exact payload the approval binds to. The auth code is part of the
  // payload for a transfer (so the approval covers it) but is NEVER persisted in
  // plaintext or logged — the service encrypts it at the field boundary.
  const payload: Record<string, unknown> = { domain: request.hostname };
  if (request.verb === "domain.register" && request.autoRenew) {
    payload.autoRenew = true;
  }
  if (request.verb === "domain.transfer") {
    payload.authCode = request.authCode ?? "";
  }

  const idempotencyKey = `${request.verb}:${ctx.tenantId}:${request.hostname}:${Date.now()}`;
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({
    verb: request.verb,
    payloadHash,
    idempotencyKey,
    nonce,
    expiresAt,
  });
  await recordIssued({
    nonce,
    tenantId: ctx.tenantId,
    verb: request.verb,
    payloadHash,
    idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });

  const outcome = await executeAction(
    {
      audit: repos.audit,
      subscriptions: repos.subscriptions,
      wallet: repos.wallet,
    },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: request.verb,
      business: request.business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );

  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }
  // Gated domain verbs are async → executeAction returns "accepted" with an op.
  if (outcome.status !== "accepted") {
    return { status: "accepted", detail: outcome.detail };
  }

  const operationId = outcome.operation.id;

  // Persist the tenant-owned Domain row (bound to tenantId here) + meter. A
  // dispatch that already settled to `failed` (e.g. name taken) skips both.
  if (outcome.operation.status !== "failed") {
    try {
      if (request.verb === "domain.transfer") {
        await upsertDomainForTransfer(repos, {
          tenantId: ctx.tenantId,
          hostname: request.hostname,
          operationId,
          authCode: request.authCode ?? null,
        });
      } else {
        await upsertDomainForRegister(repos, {
          tenantId: ctx.tenantId,
          hostname: request.hostname,
          operationId,
          autoRenew: request.autoRenew,
        });
        // Meter register/renew at the domain markup, exactly-once on the op.
        await meterDomainVerb(repos, {
          tenantId: ctx.tenantId,
          kind: request.verb === "domain.renew" ? "domain.renew" : "domain.register",
          hostname: request.hostname,
          idempotencyKey,
        });
      }
    } catch {
      // Persistence/metering failure must not crash the action; the op already
      // exists and the audit row was written. Surface the accept either way.
    }
  }

  return { status: "accepted", detail: outcome.detail, operationId };
}
