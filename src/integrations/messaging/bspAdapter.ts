// WhatsApp BSP live adapter (SERVER-ONLY). Activated when
// WHATSAPP_BSP_API_KEY + WHATSAPP_BSP_PHONE_NUMBER_ID are both set.
//
// Implements the Meta Cloud API (graph.facebook.com/v20.0) directly — no BSP
// middleware required when using a Meta-registered WABA phone number.
// Catalog sync additionally requires WHATSAPP_CATALOG_ID.
//
// Metering is upstream in whatsapp.ts (recordUsage). This module is solely
// responsible for the outbound API call AFTER the wallet has been charged.
//
// SSRF: all outbound calls go to graph.facebook.com — a hardcoded constant.

export function isWhatsappBspConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_BSP_API_KEY?.trim() &&
      process.env.WHATSAPP_BSP_PHONE_NUMBER_ID?.trim(),
  );
}

/**
 * Send a plain-text message via the Meta Cloud API. Called only AFTER the
 * wallet has already been charged by `sendWhatsappMessage`.
 */
export async function bspSendText(to: string, body: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_BSP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_BSP_API_KEY!;

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Meta Cloud API send: ${res.status} ${await res.text()}`);
  }
}

export interface CatalogProduct {
  id: string;
  name: string;
  priceCents: bigint;
  available: boolean;
}

/**
 * Batch-sync available products to the Meta Commerce catalog. Requires
 * WHATSAPP_CATALOG_ID (separate from the WABA). When the catalog ID is unset
 * the call is skipped gracefully — catalog sync is optional for messaging.
 */
export async function bspPublishCatalog(products: CatalogProduct[]): Promise<void> {
  const catalogId = process.env.WHATSAPP_CATALOG_ID?.trim();
  if (!catalogId) return; // optional — skip when no catalog configured

  const token = process.env.WHATSAPP_BSP_API_KEY!;
  const available = products.filter((p) => p.available);
  if (available.length === 0) return;

  const requests = available.map((p) => ({
    method: "UPDATE",
    retailer_id: p.id,
    data: {
      id: p.id,
      title: p.name,
      price: Number(p.priceCents),
      currency: "ZAR",
      availability: "in stock",
    },
  }));

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${encodeURIComponent(catalogId)}/items_batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ allow_upsert: true, requests }),
    },
  );
  if (!res.ok) {
    throw new Error(`Meta Catalog API: ${res.status} ${await res.text()}`);
  }
}
