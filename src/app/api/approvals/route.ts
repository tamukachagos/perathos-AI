// Approvals API (M3): the REST surface for the approval flow.
//
//   POST /api/approvals    — issue a payload-bound, single-use approval token
//                            for a gated verb (owner sign-off + step-up).
//   PUT  /api/approvals    — redeem a token to run the gated verb through the
//                            ActionRouter; returns 200 (allowed), 202 (async op
//                            started), or 403 (denied, with a reason).
//
// Tenant scoping comes from the session via requireTenant(); the body never
// carries a tenant. Mirrors the server actions in src/app/approvals/actions.ts
// for clients that prefer fetch() over a server action. Runs in mock mode.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import {
  executeAction,
  isGatedVerb,
} from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  hashPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

interface IssueBody {
  verb?: unknown;
  payload?: unknown;
  idempotencyKey?: unknown;
  stepUp?: unknown;
}

interface RedeemBody {
  verb?: unknown;
  business?: unknown;
  payload?: unknown;
  idempotencyKey?: unknown;
  approvalToken?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Issue a token. */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: IssueBody;
  try {
    body = (await request.json()) as IssueBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const verb = typeof body.verb === "string" ? body.verb : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!verb || !idempotencyKey) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }
  if (!isGatedVerb(verb)) {
    return NextResponse.json(
      { ok: false, error: "not_gated" },
      { status: 400 },
    );
  }

  const repos = await getRepositories();

  // Step-up gate (mock: explicit boolean; M4 can require WebAuthn/re-auth).
  if (body.stepUp !== true) {
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: verb,
      metadata: { verb, reason: "step_up_required" },
    });
    return NextResponse.json(
      { ok: false, error: "step_up_required" },
      { status: 403 },
    );
  }

  const payload = asRecord(body.payload);
  const payloadHash = hashPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey, nonce, expiresAt });

  recordIssued({
    nonce,
    tenantId: ctx.tenantId,
    verb,
    payloadHash,
    idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "approval.issued",
    targetType: "approval",
    targetId: verb,
    metadata: { verb, payloadHash, idempotencyKey },
  });

  return NextResponse.json({ ok: true, token, verb, expiresAt }, { status: 201 });
}

/** Redeem a token to run the gated verb. */
export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: RedeemBody;
  try {
    body = (await request.json()) as RedeemBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const verb = typeof body.verb === "string" ? body.verb : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const approvalToken =
    typeof body.approvalToken === "string" ? body.approvalToken : "";
  if (!verb || !idempotencyKey || !approvalToken) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  const repos = await getRepositories();
  const outcome = await executeAction(
    { audit: repos.audit, subscriptions: repos.subscriptions },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb,
      business: asRecord(body.business) as unknown as Business,
      payload: asRecord(body.payload),
      idempotencyKey,
      approvalToken,
    },
  );

  if (outcome.status === "denied") {
    return NextResponse.json(
      { ok: false, error: outcome.reason, detail: outcome.detail },
      { status: 403 },
    );
  }
  if (outcome.status === "accepted") {
    return NextResponse.json(
      {
        ok: true,
        detail: outcome.detail,
        operation: { id: outcome.operation.id, status: outcome.operation.status },
      },
      { status: 202 },
    );
  }
  return NextResponse.json({ ok: true, detail: outcome.detail }, { status: 200 });
}
