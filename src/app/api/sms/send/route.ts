// SMS send API — POST /api/sms/send
//
// Body: { to: string | string[], message: string, from?: string }
// Auth required. Plan check: SMS available on Growth+ plan.
// Meters 1 credit (sms.outbound) per recipient successfully dispatched.
// Rate limit: 100 SMS per hour per tenant (in-process counter; resets hourly).
// POPIA: filters opted-out recipients. Appends "Reply STOP to opt out." if absent.
//
// Returns: { ok: true, sent: number, failed: number }

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { getProvider } from "@/integrations/sms";
import { recordUsage } from "@/lib/billing/metering";
import { isOptedOut, ensureOptOutFooter } from "@/lib/smsOptOut";
import { entitlementsForSubscription } from "@/lib/billing/service";
import { captureError } from "@/lib/observability";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Cost config
// ---------------------------------------------------------------------------

/** Wholesale per-SMS cost in ZAR micro-cents (~R0.20 = 20 cents = 20_000 µc). */
const SMS_COST_MICRO = BigInt(
  process.env.LD_SMS_COST_MICRO?.trim() || "20000",
);

// ---------------------------------------------------------------------------
// Rate limiter — 100 SMS per tenant per rolling hour (in-process)
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  windowStart: number; // epoch ms
}

const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT = 100;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(tenantId: string, desired: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(tenantId);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    rateBuckets.set(tenantId, { count: desired, windowStart: now });
    return true;
  }
  if (bucket.count + desired > RATE_LIMIT) return false;
  bucket.count += desired;
  return true;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const rawTo = body.to;
  const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
  const from = typeof body.from === "string" ? body.from.trim() || undefined : undefined;

  if (!rawMessage) {
    return NextResponse.json({ ok: false, error: "message_required" }, { status: 400 });
  }

  // Normalise recipients
  let recipients: string[];
  if (typeof rawTo === "string") {
    recipients = [rawTo.trim()].filter(Boolean);
  } else if (Array.isArray(rawTo)) {
    recipients = (rawTo as unknown[])
      .filter((r) => typeof r === "string")
      .map((r) => (r as string).trim())
      .filter(Boolean);
  } else {
    return NextResponse.json({ ok: false, error: "to_required" }, { status: 400 });
  }

  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, error: "to_required" }, { status: 400 });
  }

  // Plan check — SMS requires Growth+
  const repos = await getRepositories();
  const sub = await repos.subscriptions.get(ctx.tenantId);
  const entitlements = entitlementsForSubscription(sub);
  if (!entitlements.payments) {
    // SMS is gated behind the same Growth+ plan as payments
    return NextResponse.json(
      { ok: false, error: "plan_required", detail: "SMS messaging requires the Growth plan or higher." },
      { status: 403 },
    );
  }

  // Rate limit
  if (!checkRateLimit(ctx.tenantId, recipients.length)) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", detail: "Maximum 100 SMS per hour. Try again later." },
      { status: 429 },
    );
  }

  // POPIA opt-out filter
  const optOutChecks = await Promise.all(
    recipients.map(async (phone) => ({
      phone,
      blocked: await isOptedOut(ctx.tenantId, phone),
    })),
  );
  const allowed = optOutChecks.filter((r) => !r.blocked).map((r) => r.phone);
  const blockedCount = recipients.length - allowed.length;

  if (allowed.length === 0) {
    logger.info("sms.send.all_opted_out", { tenantId: ctx.tenantId, total: recipients.length });
    return NextResponse.json({ ok: true, sent: 0, failed: blockedCount });
  }

  // Append opt-out footer
  const message = ensureOptOutFooter(rawMessage);

  // Dispatch
  // The `from` sender ID is supported for single-recipient sends via sendSms().
  // For bulk sends the adapter's sendBulk() dispatches all numbers in one API
  // call to Africa's Talking; the sender ID from the AT account settings applies.
  const sms = getProvider();
  let sentCount = 0;
  let failedCount = blockedCount;

  try {
    const result =
      allowed.length === 1
        ? await sms.sendSms(allowed[0], message, from)
        : await sms.sendBulk(allowed, message);
    for (const r of result.recipients) {
      if (r.status === "Success" || r.status === "success") {
        sentCount++;
      } else {
        failedCount++;
      }
    }
  } catch (err) {
    await captureError("sms.send.dispatch_failed", err);
    // All allowed recipients failed
    failedCount += allowed.length;
    return NextResponse.json({ ok: false, error: "dispatch_failed", sent: 0, failed: failedCount }, { status: 502 });
  }

  // Meter usage: 1 credit per successfully sent SMS
  if (sentCount > 0) {
    try {
      const idempotencyKey = `sms.outbound:${ctx.tenantId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      await recordUsage(repos, {
        tenantId: ctx.tenantId,
        kind: "sms.outbound",
        quantity: sentCount,
        unitCostMicro: SMS_COST_MICRO,
        idempotencyKey,
      });
    } catch (err) {
      // Metering failure is non-fatal: message already sent
      await captureError("sms.send.metering_failed", err);
    }
  }

  // Audit
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "sms.send",
    targetType: "sms",
    targetId: null,
    metadata: {
      recipients: allowed.length,
      sent: sentCount,
      failed: failedCount - blockedCount,
      opted_out_blocked: blockedCount,
    },
  });

  return NextResponse.json({ ok: true, sent: sentCount, failed: failedCount });
}
