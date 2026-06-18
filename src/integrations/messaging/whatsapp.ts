// W8 — WhatsApp commerce (B2) service (SERVER-ONLY orchestration).
//
// Goes beyond the existing wa.me click-to-chat (which stays the free default in
// src/integrations/messaging/index.ts). This is the catalog + ordering +
// per-message-metered messaging layer that a real Meta BSP (Clickatell /
// 360dialog / Twilio) will back later — dormant behind the documented
// WHATSAPP_BSP_* env keys (see .env.example).
//
// Verbs it serves (the gating/metering split is enforced by the ActionRouter):
//   * whatsapp.publishCatalog  — gated, sync. Marks products as the published
//     catalog (mock: a no-op confirmation; BSP later uploads to Meta).
//   * whatsapp.sendMessage /
//     whatsapp.sendTemplate    — METERED per message to the W2 wallet. SERVICE
//     replies inside the 24h customer-care window are FREE; marketing/utility/
//     auth TEMPLATE messages are charged (Meta 2025 per-template model). Exactly
//     -once on the caller's idempotency key.
//   * whatsapp.createPaymentLink — gated, sync. Builds a ZAR payment link via
//     the PaymentProvider (mock URL now) and binds it to the order.
//
// SERVER-ONLY: imports the metering service (node:crypto chain via billing) and
// the repos. Never imported by a client component — the catalog/orders UI calls
// the server actions by reference.

import type { Repositories, WhatsappOrderRecord } from "@/lib/db/types";
import { recordUsage } from "@/lib/billing/metering";
import {
  whatsappMessageCostMicro,
  type WhatsappMessageCategory,
} from "@/lib/billing/meteringConfig";
import { normalizeWhatsapp } from "@/lib/format";
import { sanitizeUrl } from "@/lib/sanitize";
import { logger } from "@/lib/logger";

/** Whether a message category is billable (everything but a service reply). */
export function isBillableCategory(category: WhatsappMessageCategory): boolean {
  return category !== "service";
}

export interface SendMessageInput {
  tenantId: string;
  /** Customer WhatsApp contact. */
  to: string;
  /**
   * Message category. "service" = a reply inside the 24h customer-care window
   * (FREE under Meta 2025). "marketing" / "utility" / "authentication" =
   * template messages (charged per message).
   */
  category: WhatsappMessageCategory;
  /** Exactly-once accounting key; a retry re-attaches rather than re-charging. */
  idempotencyKey: string;
}

export interface SendMessageResult {
  /** True when the wallet was charged (false for a free service-window reply). */
  charged: boolean;
  /** Amount debited in ZAR micro-cents (0 for a free reply or a duplicate). */
  amountMicro: bigint;
  /** Wallet balance after the (possible) debit, micro-cents. */
  balanceMicro: bigint;
  detail: string;
}

/**
 * Send a WhatsApp message and METER it to the W2 wallet per Meta's 2025
 * per-template model:
 *   * a SERVICE reply (inside the 24h window) is FREE — no usage row, no debit;
 *   * a marketing/utility/authentication TEMPLATE message is charged at the
 *     category's wholesale cost × the WhatsApp markup (applied by recordUsage
 *     for the "whatsapp.*" kind), exactly-once on the idempotency key.
 *
 * The metering `kind` is `whatsapp.message` so the wallet/usage ledger and audit
 * attribute it correctly and the markup config resolves the right multiplier.
 */
export async function sendWhatsappMessage(
  repos: Repositories,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const unitCostMicro = whatsappMessageCostMicro(input.category);
  // Free service-window reply: no ledger entry, no debit. This is the Meta 2025
  // "service conversations are free" behaviour, modelled in config (cost 0).
  if (unitCostMicro <= 0n) {
    const balanceMicro = await repos.wallet.getBalance(input.tenantId);
    logger.info("whatsapp.message_free", { category: input.category });
    return {
      charged: false,
      amountMicro: 0n,
      balanceMicro,
      detail: "Service reply sent (free inside the 24-hour window).",
    };
  }

  const result = await recordUsage(repos, {
    tenantId: input.tenantId,
    kind: "whatsapp.message",
    quantity: 1,
    unitCostMicro,
    idempotencyKey: input.idempotencyKey,
  });
  return {
    charged: result.applied,
    amountMicro: result.applied ? result.amountMicro : 0n,
    balanceMicro: result.balanceMicro,
    detail: result.applied
      ? `${input.category} message sent and billed.`
      : "Message already sent (no double charge).",
  };
}

export interface PublishCatalogResult {
  productCount: number;
  detail: string;
}

/**
 * Publish the tenant's available products as the WhatsApp catalog. Mock: counts
 * the available products and returns a confirmation (a real BSP uploads them to
 * Meta's catalog API). Gating is enforced upstream by the ActionRouter.
 */
export async function publishCatalog(
  repos: Repositories,
  tenantId: string,
): Promise<PublishCatalogResult> {
  const products = await repos.products.list(tenantId);
  const available = products.filter((p) => p.available);
  return {
    productCount: available.length,
    detail: `Published ${available.length} product${
      available.length === 1 ? "" : "s"
    } to your WhatsApp catalog.`,
  };
}

export interface CreatePaymentLinkInput {
  tenantId: string;
  orderId: string;
  /** Public base URL for the link (server-resolved, never client-supplied). */
  baseUrl: string;
}

export interface CreatePaymentLinkResult {
  ok: boolean;
  url?: string;
  order?: WhatsappOrderRecord;
  detail: string;
}

/**
 * Create a ZAR payment link for an order and bind it to the order. The link is a
 * hosted payment URL (mock: an in-app `/pay/<ref>?amount=<cents>&currency=ZAR`
 * path on the platform's own origin; Paystack/Yoco/PayFast hosted checkout once
 * keyed). The URL is run through the same scheme allowlist (sanitizeUrl) used
 * for every public link, so a malformed base URL cannot inject `javascript:` or
 * a scheme-relative target. Returns the updated order.
 */
export async function createOrderPaymentLink(
  repos: Repositories,
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  const order = await repos.whatsappOrders.get(input.tenantId, input.orderId);
  if (!order) {
    return { ok: false, detail: "Order not found." };
  }
  // Build a ZAR payment link on the platform origin. A unique ref binds the link
  // to this order (the webhook later marks the order paid by ref).
  const ref = `wo_${order.id}`;
  const cents = order.totalCents > 0n ? order.totalCents.toString() : "0";
  const base = input.baseUrl.replace(/\/+$/, "");
  const candidate = `${base}/pay/${encodeURIComponent(
    ref,
  )}?amount=${cents}&currency=ZAR`;
  // SECURITY: the link must pass the public-link scheme allowlist. A bad base
  // URL (non-http(s), scheme-relative) collapses to null and we refuse.
  const safe = sanitizeUrl(candidate);
  if (!safe) {
    return { ok: false, detail: "Could not build a safe payment link." };
  }
  const updated = await repos.whatsappOrders.update(input.tenantId, order.id, {
    status: "sent",
    paymentLinkRef: ref,
  });
  return {
    ok: true,
    url: safe,
    order: updated,
    detail: "ZAR payment link created.",
  };
}

/**
 * Free wa.me click-to-chat link (the platform's free default; unchanged from the
 * prototype). Re-exported here so the commerce UI can offer it alongside the
 * paid BSP send without importing the public site engine. Returns a safe URL.
 */
export function clickToChatLink(
  rawPhone: string | undefined | null,
  text?: string,
): string {
  const number = normalizeWhatsapp(rawPhone);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  const url = `https://wa.me/${number}${query}`;
  return sanitizeUrl(url) ?? "#";
}
