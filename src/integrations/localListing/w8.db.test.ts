// W8 — DB-backed (Postgres + RLS) tests for the GBP + WhatsApp commerce tables.
//
// Runs ONLY under `npm run test:db` (VITEST_DB=1) with a real DATABASE_URL +
// applied migrations (the `db-tests` CI job). Asserts:
//   * local_listings / products / whatsapp_orders are tenant-scoped under RLS
//     (tenant B cannot read tenant A's rows; the base client sees neither);
//   * a whatsapp.message debits the wallet EXACTLY ONCE (the W2 ledger guarantee
//     carries the W8 message metering).

import { beforeEach, describe, expect, it } from "vitest";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import { prismaRepositories } from "@/lib/db/prisma/repositories";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { sendWhatsappMessage } from "@/integrations/messaging/whatsapp";

const repos = prismaRepositories;

beforeEach(async () => {
  await resetDb();
});

describe("W8 — RLS isolation for the new tenant-owned tables", () => {
  it("LocalListing: tenant B cannot read tenant A's listing; base client sees neither", async () => {
    await repos.localListings.create(TENANT_A, {
      name: "Joe's Plumbing",
      area: "Soweto",
      phone: "27825550198",
      categories: ["Plumber"],
    });

    // A sees its own.
    expect((await repos.localListings.list(TENANT_A)).length).toBe(1);
    // B (scoped) sees nothing.
    const bScoped = await withTenant(TENANT_B, (tx) => tx.localListing.findMany({}));
    expect(bScoped.length).toBe(0);
    // Unscoped base client (FORCE RLS, non-bypass role) sees nothing.
    expect((await prisma.localListing.findMany({})).length).toBe(0);
  });

  it("Product: tenant-scoped under RLS", async () => {
    await repos.products.create(TENANT_A, { name: "Haircut", priceCents: 15000n });
    expect((await repos.products.list(TENANT_A)).length).toBe(1);
    expect((await repos.products.list(TENANT_B)).length).toBe(0);
    const bScoped = await withTenant(TENANT_B, (tx) => tx.product.findMany({}));
    expect(bScoped.length).toBe(0);
    expect((await prisma.product.findMany({})).length).toBe(0);
  });

  it("WhatsappOrder: tenant-scoped under RLS; items + bigint round-trip", async () => {
    const order = await repos.whatsappOrders.create(TENANT_A, {
      customerContact: "27825550198",
      items: [{ productId: "p1", name: "Haircut", quantity: 2, priceCents: 15000 }],
      totalCents: 30000n,
    });
    expect(order.totalCents).toBe(30000n);
    expect(order.items[0]?.quantity).toBe(2);

    expect((await repos.whatsappOrders.list(TENANT_A)).length).toBe(1);
    expect((await repos.whatsappOrders.list(TENANT_B)).length).toBe(0);
    const bScoped = await withTenant(TENANT_B, (tx) => tx.whatsappOrder.findMany({}));
    expect(bScoped.length).toBe(0);
    expect((await prisma.whatsappOrder.findMany({})).length).toBe(0);
  });
});

describe("W8 — a whatsapp.message debits the wallet exactly once", () => {
  it("charges a marketing message once; a retry on the same key does not re-debit", async () => {
    await repos.wallet.credit(TENANT_A, 1_000_000n);
    const before = await repos.wallet.getBalance(TENANT_A);

    const first = await sendWhatsappMessage(repos, {
      tenantId: TENANT_A,
      to: "27825550198",
      category: "marketing",
      idempotencyKey: "wa-db-1",
    });
    expect(first.charged).toBe(true);
    const after = await repos.wallet.getBalance(TENANT_A);
    expect(after).toBe(before - first.amountMicro);

    const retry = await sendWhatsappMessage(repos, {
      tenantId: TENANT_A,
      to: "27825550198",
      category: "marketing",
      idempotencyKey: "wa-db-1",
    });
    expect(retry.charged).toBe(false);
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(after); // no second debit

    // Exactly one usage row for the message.
    const usage = await repos.usage.listRecent(TENANT_A, 10);
    expect(usage.filter((u) => u.kind === "whatsapp.message").length).toBe(1);
  });

  it("a SERVICE reply writes no usage row and leaves the wallet untouched", async () => {
    await repos.wallet.credit(TENANT_A, 1_000_000n);
    const before = await repos.wallet.getBalance(TENANT_A);
    const result = await sendWhatsappMessage(repos, {
      tenantId: TENANT_A,
      to: "27825550198",
      category: "service",
      idempotencyKey: "wa-db-svc",
    });
    expect(result.charged).toBe(false);
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(before);
    const usage = await repos.usage.listRecent(TENANT_A, 10);
    expect(usage.filter((u) => u.kind === "whatsapp.message").length).toBe(0);
  });
});
