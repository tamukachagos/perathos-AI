// Africa's Talking inbound webhook — POST /api/webhooks/africas-talking
//
// Receives TWO kinds of payloads from Africa's Talking:
//
//  1. Delivery reports — sent to the "Delivery Report URL" configured in the
//     Africa's Talking dashboard.  We log these but take no action beyond 200.
//
//  2. Incoming SMS (keyword replies) — sent to the "Incoming Message URL".
//     When the body contains "STOP" (case-insensitive) we call addOptOut() to
//     honour the opt-out request immediately.  For HELP / START / other
//     recognised keywords we log; everything else is silently acknowledged.
//
// Africa's Talking sends application/x-www-form-urlencoded for both delivery
// reports and incoming messages.
//
// IMPORTANT: Africa's Talking does NOT sign these webhooks with an HMAC by
// default (unlike Paystack / GitHub).  The AT sandbox/production payloads are
// distinguished by the `username` field being "sandbox" vs your real account
// username.  Until AT adds webhook signing, we trust the payload if the
// `username` field matches AFRICAS_TALKING_USERNAME (or if that env is unset,
// in mock/dev mode we accept all).  IP-allowlisting in your hosting provider
// is the recommended production complement.
//
// Returns 200 for everything so AT stops retrying.

import { NextResponse, type NextRequest } from "next/server";
import { addOptOut } from "@/lib/smsOptOut";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Delivery-report field names (AT sends these as form fields)
// ---------------------------------------------------------------------------

interface DeliveryReport {
  id?: string;
  status?: string;
  phoneNumber?: string;
  networkCode?: string;
  failureReason?: string;
  retryCount?: string;
}

// ---------------------------------------------------------------------------
// Incoming-message field names
// ---------------------------------------------------------------------------

interface IncomingMessage {
  date?: string;
  from?: string;
  id?: string;
  linkId?: string;
  text?: string;
  to?: string;
  networkCode?: string;
}

// ---------------------------------------------------------------------------
// Tenant resolution — best-effort from `to` shortcode / long code.
// AT does not carry a tenantId in the webhook; we look up by SMS number
// or fall back to a platform-wide best effort (the first matching tenant).
// When we cannot resolve, we still honour the STOP and log it.
// ---------------------------------------------------------------------------

async function resolveTenantId(to: string | undefined): Promise<string | null> {
  // In a multi-tenant deployment you would keep a (shortcode → tenantId) map
  // in the DB.  For now: if there is exactly one tenant configured to use this
  // number (LD_SMS_SENDER_ID or AFRICAS_TALKING_SHORTCODE), resolve to the dev
  // tenant; otherwise leave null and the addOptOut will use a platform key.
  const configured = process.env.AFRICAS_TALKING_SHORTCODE?.trim() ||
    process.env.LD_SMS_SENDER_ID?.trim();
  if (to && configured && to === configured) {
    // Single-tenant: use env-supplied tenant id as fallback.
    return process.env.LD_DEFAULT_TENANT_ID?.trim() ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let formText: string;
  try {
    formText = await request.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const params = new URLSearchParams(formText);
  const username = params.get("username") ?? undefined;

  // Soft username check (not cryptographic — supplement with IP allowlist)
  const expectedUsername = process.env.AFRICAS_TALKING_USERNAME?.trim();
  if (expectedUsername && username && username !== expectedUsername) {
    logger.info("africas_talking.webhook.username_mismatch", { got: username });
    // Still return 200 so AT does not retry; log and discard.
    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Incoming message — fields: from, to, text, id, date, linkId, networkCode
  // ---------------------------------------------------------------------------
  const text = params.get("text") ?? params.get("Text") ?? "";
  const from = params.get("from") ?? params.get("phoneNumber") ?? "";

  if (from && text) {
    // This is an incoming message
    const incoming: IncomingMessage = {
      from: from || undefined,
      to: params.get("to") ?? undefined,
      text: text || undefined,
      id: params.get("id") ?? undefined,
      date: params.get("date") ?? undefined,
      networkCode: params.get("networkCode") ?? undefined,
    };

    const normalised = incoming.text?.trim().toUpperCase() ?? "";

    if (normalised === "STOP" || normalised.startsWith("STOP ")) {
      // POPIA / industry opt-out — honour immediately
      try {
        const tenantId = await resolveTenantId(incoming.to);
        const phone = incoming.from ?? "";
        if (phone) {
          // Use tenantId when resolved; fall back to a platform-wide sentinel
          await addOptOut(tenantId ?? "platform", phone);
          logger.info("sms.optout.received", { phone: phone.slice(-4), tenantId });

          // Audit
          const repos = await getRepositories();
          if (tenantId) {
            await repos.audit.append(tenantId, {
              actorId: null,
              action: "sms.optout",
              targetType: "contact",
              targetId: phone,
              metadata: { source: "africas_talking_incoming", messageId: incoming.id },
            });
          }
        }
      } catch (err) {
        await captureError("sms.optout.failed", err);
      }
    } else if (normalised === "START" || normalised === "HELP") {
      logger.info("africas_talking.webhook.keyword", { keyword: normalised });
    } else {
      logger.info("africas_talking.webhook.incoming_sms", {
        from: incoming.from?.slice(-4),
        textLen: (incoming.text ?? "").length,
      });
    }

    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------------------
  // Delivery report — fields: id, status, phoneNumber, networkCode, etc.
  // ---------------------------------------------------------------------------
  const msgId = params.get("id") ?? undefined;
  const status = params.get("status") ?? undefined;

  if (msgId || status) {
    const report: DeliveryReport = {
      id: msgId,
      status,
      phoneNumber: params.get("phoneNumber") ?? undefined,
      networkCode: params.get("networkCode") ?? undefined,
      failureReason: params.get("failureReason") ?? undefined,
      retryCount: params.get("retryCount") ?? undefined,
    };
    logger.info("africas_talking.delivery_report", {
      id: report.id,
      status: report.status,
      phone: report.phoneNumber?.slice(-4),
    });
    // Delivery failures could be used to decrement sent counts in a future
    // enhancement; for now we acknowledge and continue.
    return NextResponse.json({ ok: true });
  }

  // Unknown payload shape — acknowledge to prevent AT retries
  logger.info("africas_talking.webhook.unknown_payload", {});
  return NextResponse.json({ ok: true });
}
