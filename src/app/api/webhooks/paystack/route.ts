// M6 — Paystack billing webhook.
//
// Receives subscription lifecycle events and updates the tenant's subscription
// status. Reuses the M3 patterns:
//   * SIGNATURE VERIFY — Paystack signs the body with HMAC-SHA512 over the raw
//     payload using the secret key, sent as `x-paystack-signature`. We verify it
//     with a constant-time compare (like approvalToken.ts). When no
//     PAYSTACK_SECRET_KEY is set (mock/dev) the check is a STUB that accepts, so
//     the flow is exercisable locally; once the key exists, it is enforced.
//   * IDEMPOTENCY — events are de-duped by event id in a per-process ledger
//     (same shape as the operationStore idempotency map), so a redelivered
//     webhook is a no-op.
//   * AUDIT — every handled/ignored event appends a PII-free audit entry under
//     the owning tenant, mirroring the ActionRouter audit sink.
//
// The owning tenant is resolved from the provider subscription id (NOT a
// session), exactly like the cross-tenant lead ops.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { activatePlan, cancelPlan } from "@/lib/billing/service";
import { topUp } from "@/lib/billing/metering";
import { TOKEN_TOPUP_SKU } from "@/lib/billing/meteringConfig";
import {
  MissingProductionSecretError,
  requireProductionSecret,
} from "@/lib/env";
import { getStores } from "@/integrations/core/stores";

export const dynamic = "force-dynamic";

const PROVIDER = "paystack";

// B8/B1: webhook dedup is now backed by the env-gated reliability store —
// persistent + atomic (exactly-once via the unique (provider, eventId)
// constraint) when DATABASE_URL is set, in-memory in mock mode. Previously this
// was a per-process globalThis Set, which let a redelivered webhook re-apply a
// plan change on a different serverless lambda.

/** Constant-time hex-string compare (no early-exit length leak beyond length). */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify the Paystack signature (B3/S1). FAIL CLOSED: when PAYSTACK_SECRET_KEY
 * is unset, the request is ACCEPTED only in explicit dev/mock mode; in
 * production-non-mock a missing secret REJECTS (requireProductionSecret throws,
 * which the caller maps to 401). With the key set, the HMAC-SHA512 of the raw
 * body must match `x-paystack-signature` (constant-time compare).
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = requireProductionSecret("PAYSTACK_SECRET_KEY");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  return constantTimeEqualHex(expected, signature);
}

interface PaystackEvent {
  /** Paystack event id (used for idempotency); falls back to a body hash. */
  id?: string | number;
  event?: string;
  data?: {
    subscription_code?: string;
    /** Our metadata: the tenant + plan/top-up marker set when checkout starts. */
    metadata?: {
      tenantId?: string;
      plan?: string;
      kind?: string;
      amountMicro?: string;
    };
    plan?: { plan_code?: string };
    status?: string;
    next_payment_date?: string;
  };
}

function parsePositiveBigInt(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

export async function POST(request: Request) {
  // Read the RAW body for signature verification (must not re-serialize).
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  let signatureOk: boolean;
  try {
    signatureOk = verifySignature(rawBody, signature);
  } catch (error) {
    // FAIL CLOSED: missing secret in production-non-mock → reject, never accept.
    if (error instanceof MissingProductionSecretError) {
      logger.info("paystack.webhook.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }
  if (!signatureOk) {
    return NextResponse.json(
      { ok: false, error: "bad_signature" },
      { status: 401 },
    );
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody) as PaystackEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // B13: dedup id. Prefer Paystack's own event id; otherwise bind to a SHA-256
  // of the raw body so two distinct same-length events never collide (the old
  // `${event}:${rawBody.length}` fallback did).
  const eventId = String(
    event.id ??
      `${event.event ?? "?"}:${createHash("sha256")
        .update(rawBody)
        .digest("hex")}`,
  );

  const stores = await getStores();
  if (await stores.webhookDedup.hasEvent(PROVIDER, eventId)) {
    // Idempotent: a redelivered event is acknowledged without re-applying.
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    const repos = await getRepositories();
    const data = event.data ?? {};
    const subCode = data.subscription_code ?? null;

    // S1 — OWNERSHIP CHECK. `data.metadata.tenantId` is attacker-controllable
    // body content, so it is NEVER trusted on its own. The owning tenant is the
    // one that ALREADY owns this subscription_code in our store. We only fall
    // back to metadata for the very first event of a brand-new subscription
    // (subscription.create / charge.success) when no row exists yet AND the
    // metadata names a real tenant; even then, if a row exists, the stored owner
    // wins and a mismatching metadata tenant is rejected (no self-upgrade of
    // another tenant by forging metadata).
    const metaTenantId = data.metadata?.tenantId ?? null;
    const isWalletTopUp = data.metadata?.kind === TOKEN_TOPUP_SKU;
    const topUpAmountMicro = isWalletTopUp
      ? parsePositiveBigInt(data.metadata?.amountMicro)
      : null;
    let tenantId: string | null = null;

    if (subCode) {
      const existing = await repos.subscriptions.getByProviderId(
        PROVIDER,
        subCode,
      );
      if (existing) {
        // A subscription with this code is already bound to a tenant — that is
        // the authoritative owner. Reject a body that claims a different one.
        if (metaTenantId && metaTenantId !== existing.tenantId) {
          logger.info("paystack.webhook.tenant_mismatch", {
            event: event.event,
          });
          return NextResponse.json(
            { ok: false, error: "tenant_mismatch" },
            { status: 403 },
          );
        }
        tenantId = existing.tenantId;
      } else {
        // First event for a not-yet-stored subscription: bind to the metadata
        // tenant only if it resolves to an existing tenant we own.
        if (metaTenantId && isWalletTopUp) {
          // One-off wallet top-ups do not have a subscription row. The tenant id
          // was set by our server-side checkout initializer and the body is
          // signed by Paystack, so this is the authoritative correlation.
          tenantId = metaTenantId;
        } else if (metaTenantId) {
          const sub = await repos.subscriptions.get(metaTenantId);
          if (sub) tenantId = metaTenantId;
        }
      }
    } else if (metaTenantId) {
      if (isWalletTopUp) {
        tenantId = metaTenantId;
      } else {
        // No subscription_code at all: only honour the metadata tenant when it
        // maps to an upgrade attempt we already started.
        const sub = await repos.subscriptions.get(metaTenantId);
        if (sub) tenantId = metaTenantId;
      }
    }

    if (!tenantId) {
      // Unknown / unverifiable subscription — acknowledge so Paystack stops
      // retrying, but apply NOTHING and log. Claim so a redelivery is a no-op.
      logger.info("paystack.webhook.unresolved", { event: event.event });
      await stores.webhookDedup.claimEvent(PROVIDER, eventId);
      return NextResponse.json({ ok: true, unresolved: true });
    }

    // B8/B13 — ATOMIC exactly-once claim BEFORE applying the side effect. The
    // unique (provider, eventId) constraint makes this the single arbiter: if a
    // concurrent redelivery already claimed it, claimEvent returns false and we
    // skip re-applying. (The early hasEvent() above is a cheap fast-path; this
    // is the race-free guarantee.)
    const claimed = await stores.webhookDedup.claimEvent(PROVIDER, eventId);
    if (!claimed) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const plan: PlanId | null = isPlanId(data.metadata?.plan)
      ? (data.metadata!.plan as PlanId)
      : null;

    switch (event.event) {
      case "charge.success":
      case "subscription.create":
      case "invoice.payment_succeeded": {
        if (event.event === "charge.success" && isWalletTopUp) {
          if (!topUpAmountMicro) {
            logger.info("paystack.webhook.invalid_topup", { event: event.event });
            break;
          }
          await topUp(repos, tenantId, topUpAmountMicro);
        } else if (plan) {
          await activatePlan(repos, tenantId, plan, {
            provider: PROVIDER,
            providerSubscriptionId: subCode,
            currentPeriodEnd: data.next_payment_date ?? undefined,
          });
        }
        break;
      }
      case "subscription.disable":
      case "subscription.not_renew":
      case "invoice.payment_failed": {
        // Cancel at period end (mirrors the mock cancel semantics).
        await cancelPlan(repos, tenantId, { immediate: false });
        break;
      }
      default:
        logger.info("paystack.webhook.ignored", { event: event.event });
    }

    await repos.audit.append(tenantId, {
      actorId: null,
      action: "billing.webhook",
      targetType: isWalletTopUp ? "wallet" : "subscription",
      targetId: isWalletTopUp ? tenantId : subCode,
      metadata: {
        event: event.event,
        eventId,
        provider: PROVIDER,
        kind: isWalletTopUp ? TOKEN_TOPUP_SKU : "subscription",
      },
    });

    // Already claimed atomically above before applying.
    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureError("paystack.webhook.failed", error);
    return NextResponse.json({ ok: false, error: "webhook_failed" }, { status: 500 });
  }
}
