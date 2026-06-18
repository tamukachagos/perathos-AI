import { beforeEach, describe, expect, it } from "vitest";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued, __resetApprovalStore } from "@/integrations/core/approvalStore";
import { __resetOperationStore } from "@/integrations/core/operationStore";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { activatePlan } from "@/lib/billing/service";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import {
  createOrderPaymentLink,
  publishCatalog,
  sendWhatsappMessage,
} from "./whatsapp";

const repos = memoryRepositories;
const TENANT = DEV_TENANT_ID;

async function approve(
  verb: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<string> {
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey: key, nonce, expiresAt });
  await recordIssued({
    nonce,
    tenantId: TENANT,
    verb,
    payloadHash,
    idempotencyKey: key,
    issuedAt: Date.now(),
    expiresAt,
  });
  return token;
}

describe("W8 WhatsApp — per-message metering (Meta 2025 model)", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("a SERVICE reply (inside the 24h window) is FREE — no debit, no usage row", async () => {
    const before = await repos.wallet.getBalance(TENANT);
    const result = await sendWhatsappMessage(repos, {
      tenantId: TENANT,
      to: "27825550198",
      category: "service",
      idempotencyKey: "wa-svc-1",
    });
    expect(result.charged).toBe(false);
    expect(result.amountMicro).toBe(0n);
    const after = await repos.wallet.getBalance(TENANT);
    expect(after).toBe(before); // wallet untouched
    const usage = await repos.usage.listRecent(TENANT, 10);
    expect(usage.some((u) => u.kind === "whatsapp.message")).toBe(false);
  });

  it("a MARKETING template message CHARGES the wallet exactly once (kind whatsapp.message)", async () => {
    await repos.wallet.credit(TENANT, 1_000_000n);
    const before = await repos.wallet.getBalance(TENANT);
    const result = await sendWhatsappMessage(repos, {
      tenantId: TENANT,
      to: "27825550198",
      category: "marketing",
      idempotencyKey: "wa-mkt-1",
    });
    expect(result.charged).toBe(true);
    expect(result.amountMicro).toBeGreaterThan(0n);
    const after = await repos.wallet.getBalance(TENANT);
    expect(after).toBe(before - result.amountMicro);

    // Exactly-once: a retry with the SAME idempotency key does NOT debit again.
    const retry = await sendWhatsappMessage(repos, {
      tenantId: TENANT,
      to: "27825550198",
      category: "marketing",
      idempotencyKey: "wa-mkt-1",
    });
    expect(retry.charged).toBe(false);
    expect(await repos.wallet.getBalance(TENANT)).toBe(after);

    const usage = await repos.usage.listRecent(TENANT, 10);
    const rows = usage.filter((u) => u.kind === "whatsapp.message");
    expect(rows.length).toBe(1); // one ledger row for the one logical message
  });

  it("a UTILITY template message is charged but cheaper than marketing", async () => {
    await repos.wallet.credit(TENANT, 1_000_000n);
    const utility = await sendWhatsappMessage(repos, {
      tenantId: TENANT,
      to: "27825550198",
      category: "utility",
      idempotencyKey: "wa-util-1",
    });
    const marketing = await sendWhatsappMessage(repos, {
      tenantId: TENANT,
      to: "27825550198",
      category: "marketing",
      idempotencyKey: "wa-mkt-2",
    });
    expect(utility.charged).toBe(true);
    expect(marketing.amountMicro).toBeGreaterThan(utility.amountMicro);
  });
});

describe("W8 WhatsApp — publishCatalog gating", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("DENIES whatsapp.publishCatalog for a FREE tenant", async () => {
    const payload = { catalog: "primary" };
    const token = await approve("whatsapp.publishCatalog", payload, "cat-free");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "whatsapp.publishCatalog",
        business: initialBusiness,
        payload,
        idempotencyKey: "cat-free",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") expect(outcome.reason).toBe("entitlement_required");
  });

  it("requires a token (gated) and ALLOWS once entitled + approved", async () => {
    await activatePlan(repos, TENANT, "growth");
    // Missing token → denied.
    const noToken = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "whatsapp.publishCatalog",
        business: initialBusiness,
        payload: { catalog: "primary" },
        idempotencyKey: "cat-1",
      },
    );
    expect(noToken.status).toBe("denied");

    const payload = { catalog: "primary" };
    const token = await approve("whatsapp.publishCatalog", payload, "cat-2");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "whatsapp.publishCatalog",
        business: initialBusiness,
        payload,
        idempotencyKey: "cat-2",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("allowed"); // sync verb
  });

  it("publishCatalog counts the tenant's available products", async () => {
    await repos.products.create(TENANT, { name: "Haircut", priceCents: 15000n });
    await repos.products.create(TENANT, {
      name: "Hidden",
      priceCents: 9900n,
      available: false,
    });
    const result = await publishCatalog(repos, TENANT);
    expect(result.productCount).toBe(1); // only the available one
  });
});

describe("W8 WhatsApp — createPaymentLink builds a valid, safe ZAR link", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
    __resetBillingStore();
  });

  it("builds a ZAR link bound to the order and marks it sent", async () => {
    const product = await repos.products.create(TENANT, {
      name: "Haircut",
      priceCents: 15000n,
    });
    const order = await repos.whatsappOrders.create(TENANT, {
      customerContact: "27825550198",
      items: [{ productId: product.id, name: "Haircut", quantity: 2, priceCents: 15000 }],
      totalCents: 30000n,
    });
    const result = await createOrderPaymentLink(repos, {
      tenantId: TENANT,
      orderId: order.id,
      baseUrl: "https://launchdesk.co.za",
    });
    expect(result.ok).toBe(true);
    expect(result.url).toContain("https://launchdesk.co.za/pay/");
    expect(result.url).toContain("currency=ZAR");
    expect(result.url).toContain("amount=30000");
    expect(result.order?.status).toBe("sent");
    expect(result.order?.paymentLinkRef).toBe(`wo_${order.id}`);
  });

  it("REFUSES a payment link when the base URL is unsafe (scheme allowlist)", async () => {
    const order = await repos.whatsappOrders.create(TENANT, {
      customerContact: "27825550198",
      items: [{ productId: "p1", name: "x", quantity: 1, priceCents: 100 }],
      totalCents: 100n,
    });
    const result = await createOrderPaymentLink(repos, {
      tenantId: TENANT,
      orderId: order.id,
      baseUrl: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
  });

  it("createPaymentLink is gated through the ActionRouter (entitlement)", async () => {
    const payload = { orderId: "ord-1" };
    const token = await approve("whatsapp.createPaymentLink", payload, "pl-free");
    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT,
        actorId: "dev",
        verb: "whatsapp.createPaymentLink",
        business: initialBusiness,
        payload,
        idempotencyKey: "pl-free",
        approvalToken: token,
      },
    );
    expect(outcome.status).toBe("denied"); // free tenant lacks `payments`
    if (outcome.status === "denied") expect(outcome.reason).toBe("entitlement_required");
  });
});
