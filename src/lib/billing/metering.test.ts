// W2 — Metering unit tests (mock / DB-free). Covers:
//   * margin math (retail = round(cost × multiplier), BigInt-exact);
//   * exactly-once recordUsage (a duplicate idempotencyKey never double-debits);
//   * the requireCredits pre-flight helper denying when balance < estimate.

import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import {
  getBalance,
  recordUsage,
  rollInvoice,
  topUp,
} from "./metering";
import { requireCredits } from "@/integrations/core/actionRouter";
import {
  applyMargin,
  marginMultiplier,
  multiplierForKind,
} from "./meteringConfig";

const repos = memoryRepositories;
const TENANT = "tenant-metering-test";

beforeEach(() => {
  __resetMemoryStore();
});

describe("margin math", () => {
  it("applies the per-tier multiplier with BigInt-exact rounding", () => {
    // CHEAP default 3.0× : 1000 micro cost → 3000 micro retail.
    expect(applyMargin(1_000n, marginMultiplier("CHEAP"))).toBe(3_000n);
    // PREMIUM default 1.4× : 1000 → 1400.
    expect(applyMargin(1_000n, marginMultiplier("PREMIUM"))).toBe(1_400n);
    // Rounding to nearest micro-cent: 333 × 1.6 = 532.8 → 533.
    expect(applyMargin(333n, 1.6)).toBe(533n);
    // 7 × 1.5 = 10.5 → 11 (round half up).
    expect(applyMargin(7n, 1.5)).toBe(11n);
  });

  it("maps a metering kind to the right multiplier", () => {
    expect(multiplierForKind("llm.cheap.profile.extract")).toBe(marginMultiplier("CHEAP"));
    expect(multiplierForKind("llm.premium.reason.plan")).toBe(marginMultiplier("PREMIUM"));
    expect(multiplierForKind("hosting.cpu_hour")).toBeGreaterThan(1);
    expect(multiplierForKind("domain.register")).toBeGreaterThan(1);
  });

  it("recordUsage prices cost × margin × quantity and debits the wallet", async () => {
    await topUp(repos, TENANT, 100_000_000n); // R1000
    const result = await recordUsage(repos, {
      tenantId: TENANT,
      kind: "llm.cheap.copy.generate",
      quantity: 2,
      unitCostMicro: 1_000n, // R0.01 wholesale per unit
      idempotencyKey: "u-1",
    });
    expect(result.applied).toBe(true);
    // CHEAP 3.0× → unitPrice 3000; × 2 = 6000 micro debited.
    expect(result.unitPriceMicro).toBe(3_000n);
    expect(result.amountMicro).toBe(6_000n);
    expect(result.balanceMicro).toBe(100_000_000n - 6_000n);
    expect(await getBalance(repos, TENANT)).toBe(100_000_000n - 6_000n);
  });
});

describe("exactly-once recordUsage", () => {
  it("a duplicate idempotencyKey is a NO-OP — never double-debits", async () => {
    await topUp(repos, TENANT, 10_000_000n);
    const first = await recordUsage(repos, {
      tenantId: TENANT,
      kind: "domain.register",
      unitCostMicro: 5_000_000n,
      marginMultiplier: 2,
      idempotencyKey: "once",
    });
    expect(first.applied).toBe(true);
    const afterFirst = await getBalance(repos, TENANT);

    // Same key again — must not debit a second time.
    const second = await recordUsage(repos, {
      tenantId: TENANT,
      kind: "domain.register",
      unitCostMicro: 5_000_000n,
      marginMultiplier: 2,
      idempotencyKey: "once",
    });
    expect(second.applied).toBe(false);
    expect(second.balanceMicro).toBe(afterFirst);
    expect(await getBalance(repos, TENANT)).toBe(afterFirst);

    // And only ONE usage row exists for the key.
    const rows = await repos.usage.listRecent(TENANT, 50);
    expect(rows.filter((r) => r.idempotencyKey === "once").length).toBe(1);
  });

  it("N sequential duplicate calls debit exactly once", async () => {
    await topUp(repos, TENANT, 10_000_000n);
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(
        await recordUsage(repos, {
          tenantId: TENANT,
          kind: "llm.code.site.codegen",
          unitCostMicro: 100_000n,
          idempotencyKey: "dup",
        }),
      );
    }
    expect(results.filter((r) => r.applied).length).toBe(1);
    const rows = await repos.usage.listRecent(TENANT, 50);
    expect(rows.filter((r) => r.idempotencyKey === "dup").length).toBe(1);
  });
});

describe("requireCredits pre-flight gate", () => {
  it("denies when balance < estimate, allows when balance >= estimate", async () => {
    await topUp(repos, TENANT, 5_000_000n); // R50
    const tooBig = await requireCredits(repos.wallet, TENANT, 24_900_000n); // R249
    expect(tooBig.allowed).toBe(false);

    const affordable = await requireCredits(repos.wallet, TENANT, 1_000_000n); // R10
    expect(affordable.allowed).toBe(true);

    // A zero estimate (a free verb) always passes, even at zero balance.
    const free = await requireCredits(repos.wallet, "broke-tenant", 0n);
    expect(free.allowed).toBe(true);
  });
});

describe("rollInvoice", () => {
  it("sums a period's usage into one invoice", async () => {
    await topUp(repos, TENANT, 100_000_000n);
    await recordUsage(repos, {
      tenantId: TENANT,
      kind: "llm.cheap.x",
      unitCostMicro: 1_000n,
      idempotencyKey: "a",
      period: "2026-06",
    });
    await recordUsage(repos, {
      tenantId: TENANT,
      kind: "llm.cheap.y",
      unitCostMicro: 2_000n,
      idempotencyKey: "b",
      period: "2026-06",
    });
    const invoice = await rollInvoice(repos, TENANT, "2026-06");
    // 1000×3 + 2000×3 = 9000 micro.
    expect(invoice.totalMicro).toBe(9_000n);
    expect(invoice.period).toBe("2026-06");
    expect(invoice.status).toBe("open");
  });
});
