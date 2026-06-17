"use server";

// Approval-flow server actions (M3).
//
// Two halves:
//   1. requestApprovalAction — the OWNER signs off on a specific verb+payload.
//      It runs a step-up check, mints a payload-bound, single-use, expiring
//      token (issuer records the nonce), and audits the issuance. The token is
//      returned to the client to be redeemed once.
//   2. runGatedAction — redeems the token through the ActionRouter, the single
//      chokepoint. The router re-derives the payload hash, so a client cannot
//      swap the payload between approval and execution.
//
// All tenant scoping comes from requireTenant(); the client never supplies a
// tenant. Runs in mock mode (in-memory repo + dev session) unchanged.

import type { Business } from "@/lib/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import {
  executeAction,
  isGatedVerb,
  GATED_VERBS,
  type ExecuteOutcome,
} from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";

export interface ApprovalRequest {
  verb: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  /**
   * Step-up confirmation: the owner re-affirms intent (mock mode treats an
   * explicit `true` as the step-up factor; M4 can require WebAuthn / re-auth).
   */
  stepUp: boolean;
}

export interface ApprovalGrant {
  token: string;
  verb: string;
  expiresAt: number;
}

/**
 * Issue an approval token for a specific verb + payload. Requires the verb to be
 * gated and the owner to pass the step-up check. The token is bound to the
 * payload hash + idempotency key (see approvalToken.ts).
 */
export async function requestApprovalAction(
  request: ApprovalRequest,
): Promise<ApprovalGrant> {
  const ctx = await requireTenant();

  if (!isGatedVerb(request.verb)) {
    throw new Error(`"${request.verb}" is not an approval-gated verb.`);
  }
  // Step-up: the owner must explicitly confirm. Without it, no token is minted
  // and the attempt is audited as a denied issuance.
  if (request.stepUp !== true) {
    const repos = await getRepositories();
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: request.verb,
      metadata: { verb: request.verb, reason: "step_up_required" },
    });
    throw new Error("Step-up confirmation is required to approve this action.");
  }

  const payload = request.payload ?? {};
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;

  const token = issueToken({
    verb: request.verb,
    payloadHash,
    idempotencyKey: request.idempotencyKey,
    nonce,
    expiresAt,
  });

  // Record the nonce so the token is single-use, scoped to this tenant.
  await recordIssued({
    nonce,
    tenantId: ctx.tenantId,
    verb: request.verb,
    payloadHash,
    idempotencyKey: request.idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });

  const repos = await getRepositories();
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "approval.issued",
    targetType: "approval",
    targetId: request.verb,
    metadata: { verb: request.verb, payloadHash, idempotencyKey: request.idempotencyKey },
  });

  return { token, verb: request.verb, expiresAt };
}

export interface RunGatedRequest {
  verb: string;
  business: Business;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  approvalToken: string;
}

/**
 * Redeem an approval token to run a gated verb through the ActionRouter. Returns
 * the router's structured outcome (allowed / accepted-202 / denied). Never
 * throws on a denial so the UI can show the reason.
 */
export async function runGatedAction(
  request: RunGatedRequest,
): Promise<ExecuteOutcome> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  return executeAction(
    { audit: repos.audit, subscriptions: repos.subscriptions },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: request.verb,
      business: request.business,
      payload: request.payload,
      idempotencyKey: request.idempotencyKey,
      approvalToken: request.approvalToken,
    },
  );
}

/** Expose the gated-verb catalogue to the UI (labels for the approval prompt). */
export async function listGatedVerbsAction(): Promise<
  Array<{ verb: string; label: string; async: boolean }>
> {
  return Object.entries(GATED_VERBS).map(([verb, spec]) => ({
    verb,
    label: spec.label,
    async: spec.async,
  }));
}
