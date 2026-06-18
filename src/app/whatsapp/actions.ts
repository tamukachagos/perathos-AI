"use server";

// W8 — WhatsApp commerce (B2) server actions.
//
// Tenant-scoped via requireTenant() (the client never supplies a tenant). The
// catalog manager + orders UI call these by reference. The gating/metering
// split is enforced by the ActionRouter + the messaging/whatsapp service:
//   * addProductAction / listCatalogAction / listOrdersAction / createOrderAction
//       — ungated CRUD on the tenant's own catalog/orders. No approval, no charge.
//   * publishCatalogAction        — gated (whatsapp.publishCatalog).
//   * createPaymentLinkAction      — gated (whatsapp.createPaymentLink); builds a
//       ZAR link via the PaymentProvider path and binds it to the order.
//   * sendWhatsappMessageAction    — METERED per message (whatsapp.message);
//       service replies in the 24h window are free, templates are charged.
//
// SERVER ACTION plane file: imports the messaging/whatsapp service (metering,
// node:crypto chain) + the ActionRouter, never statically imported by a client.

import type { Business } from "@/lib/types";
import type {
  ProductRecord,
  WhatsappOrderItem,
  WhatsappOrderRecord,
} from "@/lib/db/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { env } from "@/lib/env";
import { sanitizeText } from "@/lib/sanitize";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import {
  createOrderPaymentLink,
  sendWhatsappMessage,
  type SendMessageResult,
} from "@/integrations/messaging/whatsapp";
import type { WhatsappMessageCategory } from "@/lib/billing/meteringConfig";

// --- Ungated catalog/order CRUD ---------------------------------------------

export async function listCatalogAction(): Promise<ProductRecord[]> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  return repos.products.list(ctx.tenantId);
}

export async function listOrdersAction(): Promise<WhatsappOrderRecord[]> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  return repos.whatsappOrders.list(ctx.tenantId);
}

export interface AddProductRequest {
  name: string;
  description?: string;
  /** ZAR cents (integer; the UI collects Rand and converts). */
  priceCents: number;
  imageUrl?: string;
}

export async function addProductAction(
  request: AddProductRequest,
): Promise<ProductRecord> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const name = sanitizeText(request.name);
  if (!name) throw new Error("Product name is required.");
  const priceCents = Math.max(0, Math.round(request.priceCents || 0));
  const product = await repos.products.create(ctx.tenantId, {
    name,
    description: sanitizeText(request.description),
    priceCents: BigInt(priceCents),
    imageUrl: request.imageUrl ? request.imageUrl.trim() : null,
    available: true,
  });
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "whatsapp.product_added",
    targetType: "product",
    targetId: product.id,
    metadata: { priceCents },
  });
  return product;
}

export interface CreateOrderRequest {
  customerContact: string;
  /** Each item references a product id + quantity; the price is snapshotted. */
  items: { productId: string; quantity: number }[];
}

/**
 * Capture an order from a customer contact + product references. The total is
 * computed SERVER-SIDE from the tenant's own product prices (the client never
 * supplies prices), so a tampered client cannot under-charge.
 */
export async function createOrderAction(
  request: CreateOrderRequest,
): Promise<WhatsappOrderRecord> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const products = await repos.products.list(ctx.tenantId);
  const byId = new Map(products.map((p) => [p.id, p]));

  const items: WhatsappOrderItem[] = [];
  let totalCents = 0n;
  for (const line of request.items ?? []) {
    const product = byId.get(line.productId);
    if (!product) continue; // tenant-scoped: ignore ids not in this catalog
    const quantity = Math.max(1, Math.round(line.quantity || 1));
    const priceCents = Number(product.priceCents);
    items.push({ productId: product.id, name: product.name, quantity, priceCents });
    totalCents += product.priceCents * BigInt(quantity);
  }
  if (items.length === 0) throw new Error("An order needs at least one item.");

  const order = await repos.whatsappOrders.create(ctx.tenantId, {
    customerContact: sanitizeText(request.customerContact),
    items,
    totalCents,
    status: "draft",
  });
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "whatsapp.order_created",
    targetType: "order",
    targetId: order.id,
    metadata: { totalCents: totalCents.toString(), itemCount: items.length },
  });
  return order;
}

// --- Gated verbs (publishCatalog / createPaymentLink) -----------------------

interface MintedToken {
  token: string;
  idempotencyKey: string;
}

/** Mint + record a single-use approval token bound to verb + payload. */
async function mintApproval(
  tenantId: string,
  verb: string,
  payload: Record<string, unknown>,
): Promise<MintedToken> {
  const idempotencyKey = `${verb}:${tenantId}:${Date.now()}`;
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey, nonce, expiresAt });
  await recordIssued({
    nonce,
    tenantId,
    verb,
    payloadHash,
    idempotencyKey,
    issuedAt: Date.now(),
    expiresAt,
  });
  return { token, idempotencyKey };
}

export interface GatedResult {
  status: "allowed" | "accepted" | "denied";
  detail: string;
}

export async function publishCatalogAction(
  business: Business,
  stepUp: boolean,
): Promise<GatedResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  if (stepUp !== true) {
    return { status: "denied", detail: "Step-up confirmation is required." };
  }
  const payload = { catalog: "primary" };
  const { token, idempotencyKey } = await mintApproval(
    ctx.tenantId,
    "whatsapp.publishCatalog",
    payload,
  );
  const outcome = await executeAction(
    { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: "whatsapp.publishCatalog",
      business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );
  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }
  return { status: "allowed", detail: outcome.detail };
}

export interface PaymentLinkResult extends GatedResult {
  url?: string;
  order?: WhatsappOrderRecord;
}

export async function createPaymentLinkAction(
  business: Business,
  orderId: string,
  stepUp: boolean,
): Promise<PaymentLinkResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  if (stepUp !== true) {
    return { status: "denied", detail: "Step-up confirmation is required." };
  }
  const payload = { orderId };
  const { token, idempotencyKey } = await mintApproval(
    ctx.tenantId,
    "whatsapp.createPaymentLink",
    payload,
  );
  const outcome = await executeAction(
    { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
    {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: "whatsapp.createPaymentLink",
      business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );
  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }
  // On accept, build the ZAR link + bind it to the order (server origin only).
  const link = await createOrderPaymentLink(repos, {
    tenantId: ctx.tenantId,
    orderId,
    baseUrl: env.appUrl,
  });
  if (!link.ok) {
    return { status: "denied", detail: link.detail };
  }
  return {
    status: "allowed",
    detail: link.detail,
    url: link.url,
    order: link.order,
  };
}

// --- Metered verb (sendMessage / sendTemplate) ------------------------------

export interface SendMessageRequest {
  to: string;
  category: WhatsappMessageCategory;
}

/**
 * Send a WhatsApp message, METERED per Meta's 2025 per-template model. NOT
 * approval-gated (it is a high-frequency operation); the wallet is the ceiling.
 * The idempotency key is derived server-side so a retried send re-attaches
 * rather than double-charging. The router dispatch is the audited side-effect;
 * the metering happens in the service. Returns the (free/charged) result.
 */
export async function sendWhatsappMessageAction(
  request: SendMessageRequest,
): Promise<SendMessageResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const idempotencyKey = `whatsapp.message:${ctx.tenantId}:${sanitizeText(
    request.to,
  )}:${request.category}:${Date.now()}`;
  return sendWhatsappMessage(repos, {
    tenantId: ctx.tenantId,
    to: request.to,
    category: request.category,
    idempotencyKey,
  });
}
