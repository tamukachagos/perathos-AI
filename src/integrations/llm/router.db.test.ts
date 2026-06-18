// W3 — LLM router DB test (Postgres). Runs only with a real DATABASE_URL (the
// db-tests CI job, as the non-superuser app role). Proves the guarantee the mock
// cannot: an `llm.<task>` usage event debits the Postgres wallet EXACTLY ONCE
// (and re-attaches on a duplicate idempotencyKey), through the same
// record_usage_debit() path W2 uses. Reuses the W2 db-tests harness.
//
// No real model call: the router uses the deterministic MOCK provider (no key),
// so this exercises the routing → meter → wallet path against real Postgres.

import { beforeEach, describe, expect, it } from "vitest";
import { prismaRepositories } from "@/lib/db/prisma/repositories";
import { withTenant, prisma } from "@/lib/db/prisma/client";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { routeLlm, __resetLlmCache } from "./index";

const repos = prismaRepositories;

function deps() {
  return { wallet: repos.wallet, audit: repos.audit, repos };
}

beforeEach(async () => {
  await resetDb();
  __resetLlmCache();
});

describe("W3 router — llm.<task> usage debits the Postgres wallet exactly once", () => {
  it("a routed copy.generate debits the wallet and writes ONE usage row", async () => {
    await repos.wallet.credit(TENANT_A, 100_000_000n); // R1000
    const before = await repos.wallet.getBalance(TENANT_A);

    const outcome = await routeLlm(deps(), {
      tenantId: TENANT_A,
      task: "copy.generate",
      idempotencyKey: "db-once",
      input: { messages: [{ role: "user", content: "tagline please" }] },
    });
    expect(outcome.status).toBe("ok");

    const after = await repos.wallet.getBalance(TENANT_A);
    expect(after).toBeLessThan(before);

    // Exactly one usage row, kind llm.cheap.copy.generate, retail = cost × 3.0×.
    const rows = await repos.usage.listRecent(TENANT_A, 50);
    const mine = rows.filter((r) => r.idempotencyKey === "db-once");
    expect(mine.length).toBe(1);
    expect(mine[0].kind).toBe("llm.cheap.copy.generate");
    expect(mine[0].unitPriceMicro).toBe(mine[0].unitCostMicro * 3n);
    // The wallet decremented by exactly the recorded amount.
    expect(before - after).toBe(mine[0].amountMicro);
  });

  it("a duplicate idempotencyKey re-attaches — NO second debit", async () => {
    await repos.wallet.credit(TENANT_A, 100_000_000n);
    // First call: distinct prompt avoids the cache so a real debit happens.
    const first = await routeLlm(deps(), {
      tenantId: TENANT_A,
      task: "copy.generate",
      idempotencyKey: "db-dup",
      input: { messages: [{ role: "user", content: "first prompt" }] },
    });
    expect(first.status).toBe("ok");
    const mid = await repos.wallet.getBalance(TENANT_A);

    // Re-run with the SAME idempotencyKey but a DIFFERENT prompt (cache miss),
    // so the debit path runs again — the wallet's exactly-once keying must make
    // it a no-op (no second debit) even though a fresh completion was produced.
    const second = await routeLlm(deps(), {
      tenantId: TENANT_A,
      task: "copy.generate",
      idempotencyKey: "db-dup",
      input: { messages: [{ role: "user", content: "second different prompt" }] },
    });
    expect(second.status).toBe("ok");
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(mid);

    const rows = await repos.usage.listRecent(TENANT_A, 50);
    expect(rows.filter((r) => r.idempotencyKey === "db-dup").length).toBe(1);
  });

  it("a cache hit on a second identical call debits NOTHING", async () => {
    await repos.wallet.credit(TENANT_A, 100_000_000n);
    const input = { messages: [{ role: "user" as const, content: "cache me" }] };
    await routeLlm(deps(), {
      tenantId: TENANT_A,
      task: "copy.generate",
      idempotencyKey: "db-cache-a",
      input,
    });
    const afterFirst = await repos.wallet.getBalance(TENANT_A);

    const second = await routeLlm(deps(), {
      tenantId: TENANT_A,
      task: "copy.generate",
      idempotencyKey: "db-cache-b",
      input,
    });
    expect(second.status).toBe("ok");
    if (second.status === "ok") expect(second.result.cached).toBe(true);
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(afterFirst);
  });

  it("the pre-flight gate denies insufficient_credits before any debit (and is tenant-scoped)", async () => {
    // TENANT_B has no balance → a PREMIUM task (positive estimate) is denied.
    const outcome = await routeLlm(deps(), {
      tenantId: TENANT_B,
      task: "reason.plan",
      idempotencyKey: "db-deny",
      input: { messages: [{ role: "user", content: "plan it" }] },
    });
    expect(outcome.status).toBe("insufficient_credits");
    // No usage row for B; and the unscoped base client sees none either.
    const bRows = await repos.usage.listRecent(TENANT_B, 50);
    expect(bRows.length).toBe(0);
    expect((await prisma.usageRecord.findMany({})).length).toBe(0);
    // Sanity: B is genuinely empty under its own scope.
    expect(
      (await withTenant(TENANT_B, (tx) => tx.usageRecord.findMany({}))).length,
    ).toBe(0);
  });
});
