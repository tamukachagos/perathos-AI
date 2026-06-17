// W2 — Metering wallet DB tests (Postgres). Runs only with a real DATABASE_URL
// (the db-tests CI job, as the non-superuser app role). Proves the guarantees
// that the mock impl cannot — concurrency + RLS:
//   1. ATOMIC DEBIT UNDER CONCURRENCY: N concurrent debits with the SAME
//      idempotencyKey result in EXACTLY ONE debit (and one usage row).
//   2. EXACTLY-ONCE on a duplicate key (sequential) is a no-op, never re-debits.
//   3. RLS tenant-isolation: tenant B cannot read tenant A's wallet or usage,
//      and the unscoped base client sees neither.
//   4. The pre-flight credit gate (requireCredits) denies when balance <
//      estimate and allows when funded.

import { beforeEach, describe, expect, it } from "vitest";
import { prisma, withTenant } from "./prisma/client";
import { prismaRepositories } from "./prisma/repositories";
import { resetDb, TENANT_A, TENANT_B } from "./testdb";
import { recordUsage, getBalance } from "@/lib/billing/metering";
import { requireCredits } from "@/integrations/core/actionRouter";

const repos = prismaRepositories;

beforeEach(async () => {
  await resetDb();
});

describe("W2 wallet — atomic debit + exactly-once + RLS", () => {
  it("selects the Postgres impl (sanity: a wallet credit persists across reads)", async () => {
    await repos.wallet.credit(TENANT_A, 1_000_000n);
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(1_000_000n);
  });

  it("ATOMIC under concurrency: N concurrent debits, SAME idempotencyKey → exactly ONE debit", async () => {
    await repos.wallet.credit(TENANT_A, 100_000_000n); // R1000
    const before = await repos.wallet.getBalance(TENANT_A);

    // Fire many concurrent recordUsage calls sharing one idempotencyKey. The
    // record_usage_debit() function inserts the usage row ON CONFLICT DO NOTHING
    // and only debits when a row was actually inserted, so exactly one wins.
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        recordUsage(repos, {
          tenantId: TENANT_A,
          kind: "llm.cheap.copy.generate",
          unitCostMicro: 1_000_000n, // R10 wholesale
          marginMultiplier: 2,
          idempotencyKey: "race-key",
        }),
      ),
    );

    const applied = results.filter((r) => r.applied);
    expect(applied.length).toBe(1);

    // Exactly one R20 (2_000_000 micro) debit total.
    const after = await repos.wallet.getBalance(TENANT_A);
    expect(before - after).toBe(2_000_000n);

    // And exactly ONE usage row for the key.
    const rows = await repos.usage.listRecent(TENANT_A, 50);
    expect(rows.filter((r) => r.idempotencyKey === "race-key").length).toBe(1);
  });

  it("EXACTLY-ONCE on a sequential duplicate key — no second debit", async () => {
    await repos.wallet.credit(TENANT_A, 50_000_000n);
    const first = await recordUsage(repos, {
      tenantId: TENANT_A,
      kind: "domain.register",
      unitCostMicro: 5_000_000n,
      marginMultiplier: 2,
      idempotencyKey: "dup-seq",
    });
    expect(first.applied).toBe(true);
    const mid = await getBalance(repos, TENANT_A);

    const second = await recordUsage(repos, {
      tenantId: TENANT_A,
      kind: "domain.register",
      unitCostMicro: 5_000_000n,
      marginMultiplier: 2,
      idempotencyKey: "dup-seq",
    });
    expect(second.applied).toBe(false);
    expect(second.balanceMicro).toBe(mid);
    expect(await getBalance(repos, TENANT_A)).toBe(mid);
  });

  it("RLS: tenant B cannot read tenant A's wallet or usage; base client sees neither", async () => {
    await repos.wallet.credit(TENANT_A, 7_000_000n);
    await recordUsage(repos, {
      tenantId: TENANT_A,
      kind: "llm.cheap.x",
      unitCostMicro: 1_000n,
      idempotencyKey: "a-usage",
    });

    // B, scoped to itself, sees no wallet + no usage of A's.
    const bWallet = await withTenant(TENANT_B, (tx) =>
      tx.tokenWallet.findMany({}),
    );
    expect(bWallet.length).toBe(0);
    const bUsage = await withTenant(TENANT_B, (tx) =>
      tx.usageRecord.findMany({}),
    );
    expect(bUsage.length).toBe(0);

    // The UNSCOPED base client (FORCE RLS, NULL tenant) also sees neither.
    expect((await prisma.tokenWallet.findMany({})).length).toBe(0);
    expect((await prisma.usageRecord.findMany({})).length).toBe(0);

    // A still sees its own.
    expect((await withTenant(TENANT_A, (tx) => tx.tokenWallet.findMany({}))).length).toBe(1);
    expect((await withTenant(TENANT_A, (tx) => tx.usageRecord.findMany({}))).length).toBe(1);
  });

  it("pre-flight credit gate: denies when balance < estimate, allows when funded", async () => {
    await repos.wallet.credit(TENANT_A, 5_000_000n); // R50
    const tooBig = await requireCredits(repos.wallet, TENANT_A, 24_900_000n); // R249
    expect(tooBig.allowed).toBe(false);

    await repos.wallet.credit(TENANT_A, 30_000_000n); // now R350
    const ok = await requireCredits(repos.wallet, TENANT_A, 24_900_000n);
    expect(ok.allowed).toBe(true);
  });

  it("invoice rolls a period's usage into one (tenant, period) row", async () => {
    await repos.wallet.credit(TENANT_A, 100_000_000n);
    await recordUsage(repos, {
      tenantId: TENANT_A,
      kind: "llm.cheap.x",
      unitCostMicro: 1_000n,
      idempotencyKey: "i-a",
      period: "2026-06",
    });
    await recordUsage(repos, {
      tenantId: TENANT_A,
      kind: "llm.cheap.y",
      unitCostMicro: 2_000n,
      idempotencyKey: "i-b",
      period: "2026-06",
    });
    const list = await repos.usage.listByPeriod(TENANT_A, "2026-06");
    const total = list.reduce((s, r) => s + r.amountMicro, 0n);
    const invoice = await repos.invoices.upsert(TENANT_A, "2026-06", total);
    expect(invoice.totalMicro).toBe(total);
    // Re-rolling the same period upserts (does not duplicate).
    const again = await repos.invoices.upsert(TENANT_A, "2026-06", total);
    expect(again.id).toBe(invoice.id);
  });
});
