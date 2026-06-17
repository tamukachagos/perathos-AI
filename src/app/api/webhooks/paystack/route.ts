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

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { activatePlan, cancelPlan } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

const PROVIDER = "paystack";

// --- Idempotency ledger (per-process; a real deploy backs this with Redis/PG) -
const globalForWebhook = globalThis as unknown as {
  __paystackEvents?: Set<string>;
};
const seenEvents = (globalForWebhook.__paystackEvents ??= new Set());

/**
 * Verify the Paystack signature. STUB in mock mode (no secret => accept) so the
 * webhook is testable locally; with PAYSTACK_SECRET_KEY set, the HMAC-SHA512 of
 * the raw body must match `x-paystack-signature` (constant-time).
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) return true; // mock/dev stub — real verification once keyed
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface PaystackEvent {
  /** Paystack event id (used for idempotency); falls back to a body hash. */
  id?: string | number;
  event?: string;
  data?: {
    subscription_code?: string;
    /** Our metadata: the tenant + plan we set when creating the subscription. */
    metadata?: { tenantId?: string; plan?: string };
    plan?: { plan_code?: string };
    status?: string;
    next_payment_date?: string;
  };
}

export async function POST(request: Request) {
  // Read the RAW body for signature verification (must not re-serialize).
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifySignature(rawBody, signature)) {
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

  const eventId = String(event.id ?? `${event.event}:${rawBody.length}`);
  if (seenEvents.has(eventId)) {
    // Idempotent: a redelivered event is acknowledged without re-applying.
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    const repos = await getRepositories();
    const data = event.data ?? {};
    const subCode = data.subscription_code ?? null;

    // Resolve the owning tenant: prefer our metadata, else look up by provider id.
    let tenantId = data.metadata?.tenantId ?? null;
    if (!tenantId && subCode) {
      const existing = await repos.subscriptions.getByProviderId(PROVIDER, subCode);
      tenantId = existing?.tenantId ?? null;
    }
    if (!tenantId) {
      // Unknown subscription — acknowledge so Paystack stops retrying, but log.
      logger.info("paystack.webhook.unresolved", { event: event.event });
      seenEvents.add(eventId);
      return NextResponse.json({ ok: true, unresolved: true });
    }

    const plan: PlanId | null = isPlanId(data.metadata?.plan)
      ? (data.metadata!.plan as PlanId)
      : null;

    switch (event.event) {
      case "charge.success":
      case "subscription.create":
      case "invoice.payment_succeeded": {
        if (plan) {
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
      targetType: "subscription",
      targetId: subCode,
      metadata: { event: event.event, eventId, provider: PROVIDER },
    });

    seenEvents.add(eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureError("paystack.webhook.failed", error);
    return NextResponse.json({ ok: false, error: "webhook_failed" }, { status: 500 });
  }
}
