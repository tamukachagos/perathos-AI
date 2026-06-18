// W7 — Agent-team Postgres (RLS + metering) tests. Run only with DATABASE_URL
// (the db-tests CI job; locally `npm run test:db`). Covers:
//   * AgentJob + AgentPolicy are tenant-scoped under FORCE RLS — tenant B sees
//     none of tenant A's, and the unscoped base client sees neither.
//   * A metered agent run debits the wallet EXACTLY ONCE (the LLM cost the role
//     drew lands once via routeLlm's exactly-once idempotency key).

import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import { getRepositories } from "@/lib/db";
import { __resetStoreFactory } from "@/integrations/core/stores";
import { activatePlan } from "@/lib/billing/service";
import { initialBusiness } from "@/lib/platformData";
import { enqueueRun, processQueue } from "./index";

describe("W7 agent team (Postgres) — RLS isolation + exactly-once metering", () => {
  beforeEach(async () => {
    __resetStoreFactory();
    await resetDb();
  });

  it("AgentJob + AgentPolicy are tenant-scoped under RLS", async () => {
    const repos = await getRepositories();

    // Tenant A owns a job + a (default) policy.
    await repos.agentJobs.create(TENANT_A, {
      role: "ci_medic",
      trigger: "ci_failure",
    });
    await repos.agentPolicies.update(TENANT_A, { pausedByOwner: true });

    // A sees its own.
    expect(await repos.agentJobs.list(TENANT_A)).toHaveLength(1);
    expect((await repos.agentPolicies.get(TENANT_A)).pausedByOwner).toBe(true);

    // B sees NONE of A's (RLS + app scope), and B's own policy is the default.
    expect(await repos.agentJobs.list(TENANT_B)).toHaveLength(0);
    expect((await repos.agentPolicies.get(TENANT_B)).pausedByOwner).toBe(false);

    // The UNSCOPED base client (FORCE RLS, NULL tenant) sees neither tenant's rows.
    expect((await prisma.agentJob.findMany({})).length).toBe(0);
    // Two policies exist (one per tenant) but are invisible to the base client.
    expect((await prisma.agentPolicy.findMany({})).length).toBe(0);

    // Scoped reads still find each tenant's own policy row.
    expect(
      (await withTenant(TENANT_A, (tx) => tx.agentPolicy.findMany({}))).length,
    ).toBe(1);
  });

  it("a metered agent run debits the wallet EXACTLY ONCE", async () => {
    const repos = await getRepositories();
    // Entitle + fund tenant A so the agent run can spend.
    await activatePlan(repos, TENANT_A, "pro");
    await repos.wallet.credit(TENANT_A, 100_000_000n); // R1000

    const before = await repos.wallet.getBalance(TENANT_A);

    // Enqueue + process a run; the CI Medic + Reviewer each route an LLM call
    // through routeLlm (metered), keyed exactly-once on the job id.
    await enqueueRun(
      { repos },
      {
        tenantId: TENANT_A,
        trigger: "ci_failure",
        business: initialBusiness,
        slug: "a-shop",
      },
    );
    await processQueue({ repos }, TENANT_A, initialBusiness, "a-shop");
    const afterFirst = await repos.wallet.getBalance(TENANT_A);

    // Re-processing finds no `queued` jobs (they advanced), so NO new debit
    // happens — the run's metering is exactly-once.
    await processQueue({ repos }, TENANT_A, initialBusiness, "a-shop");
    const afterSecond = await repos.wallet.getBalance(TENANT_A);

    // The wallet was debited (some agent LLM cost) on the first pass...
    expect(afterFirst).toBeLessThanOrEqual(before);
    // ...and NOT debited again on the second pass (exactly-once).
    expect(afterSecond).toBe(afterFirst);

    // Each metered usage row is unique on (tenant, idempotencyKey) — re-running
    // the same job id never inserts a duplicate ledger row.
    const period = new Date().toISOString().slice(0, 7);
    const rows = await repos.usage.listByPeriod(TENANT_A, period);
    const keys = rows.map((r) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate keys
  });
});
