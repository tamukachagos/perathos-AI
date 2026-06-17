import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import {
  activatePlan,
  cancelPlan,
  effectivePlan,
  entitlementsForSubscription,
  getEntitlements,
} from "./service";
import { checkEntitlement } from "./entitlements";

const repos = memoryRepositories;

describe("subscription lifecycle — upgrade → active → cancel (mock)", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetBillingStore();
  });

  it("a fresh tenant has no subscription and resolves to Free", async () => {
    const sub = await repos.subscriptions.get(DEV_TENANT_ID);
    expect(sub).toBeNull();
    expect(effectivePlan(sub)).toBe("free");
    expect((await getEntitlements(repos, DEV_TENANT_ID)).customDomain).toBe(false);
  });

  it("activatePlan upgrades the tenant to an active paid plan with a period end", async () => {
    const sub = await activatePlan(repos, DEV_TENANT_ID, "growth", {
      provider: "mock",
      providerSubscriptionId: "mock_sub_abc",
    });
    expect(sub.plan).toBe("growth");
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd).not.toBeNull();
    expect(effectivePlan(sub)).toBe("growth");
    const ent = await getEntitlements(repos, DEV_TENANT_ID);
    expect(ent.customDomain).toBe(true);
    expect(ent.removeBranding).toBe(true);
    expect(ent.payments).toBe(true);
  });

  it("cancelPlan (at period end) keeps the plan usable until the period ends", async () => {
    await activatePlan(repos, DEV_TENANT_ID, "growth", {
      providerSubscriptionId: "mock_sub_abc",
    });
    const canceled = await cancelPlan(repos, DEV_TENANT_ID, { immediate: false });
    expect(canceled?.cancelAtPeriodEnd).toBe(true);
    expect(canceled?.status).toBe("active");
    // Still entitled until period end.
    expect(effectivePlan(canceled)).toBe("growth");
    expect(entitlementsForSubscription(canceled).removeBranding).toBe(true);
  });

  it("cancelPlan (immediate) drops the tenant to Free now", async () => {
    await activatePlan(repos, DEV_TENANT_ID, "pro", {
      providerSubscriptionId: "mock_sub_pro",
    });
    const canceled = await cancelPlan(repos, DEV_TENANT_ID, { immediate: true });
    expect(canceled?.status).toBe("canceled");
    expect(effectivePlan(canceled)).toBe("free");
    expect(entitlementsForSubscription(canceled).customDomain).toBe(false);
  });

  it("a non-active (canceled) status falls back to Free entitlements", () => {
    const sub = {
      id: "s1",
      tenantId: DEV_TENANT_ID,
      plan: "pro" as const,
      status: "canceled" as const,
      currentPeriodEnd: null,
      provider: "mock",
      providerSubscriptionId: null,
      cancelAtPeriodEnd: false,
      createdAt: "",
      updatedAt: "",
    };
    expect(effectivePlan(sub)).toBe("free");
  });

  it("activate is auditable (writes a billing.activated entry)", async () => {
    await activatePlan(repos, DEV_TENANT_ID, "growth");
    const entries = await repos.audit.list(DEV_TENANT_ID);
    expect(entries.some((e) => e.action === "billing.activated")).toBe(true);
  });
});

describe("free-vs-paid branding flag", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetBillingStore();
  });

  it("free tenant shows branding; growth/pro suppress it (removeBranding)", async () => {
    // Free (no subscription) => branding shown.
    const free = await repos.subscriptions.get(DEV_TENANT_ID);
    expect(entitlementsForSubscription(free).removeBranding).toBe(false);

    // Upgrade => branding removed.
    const paid = await activatePlan(repos, DEV_TENANT_ID, "growth");
    expect(entitlementsForSubscription(paid).removeBranding).toBe(true);
  });
});

describe("requireEntitlement / checkEntitlement — allow & deny", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetBillingStore();
  });

  it("denies a paid feature for a free tenant", async () => {
    const res = await checkEntitlement(
      repos.subscriptions,
      DEV_TENANT_ID,
      "customDomain",
    );
    expect(res.allowed).toBe(false);
    expect(res.detail).toMatch(/Growth/i);
  });

  it("allows the feature once the tenant is on a plan that includes it", async () => {
    await activatePlan(repos, DEV_TENANT_ID, "growth");
    const domain = await checkEntitlement(
      repos.subscriptions,
      DEV_TENANT_ID,
      "customDomain",
    );
    const payments = await checkEntitlement(
      repos.subscriptions,
      DEV_TENANT_ID,
      "payments",
    );
    expect(domain.allowed).toBe(true);
    expect(payments.allowed).toBe(true);
  });

  it("priority support stays denied on Growth, allowed on Pro", async () => {
    await activatePlan(repos, DEV_TENANT_ID, "growth");
    expect(
      (await checkEntitlement(repos.subscriptions, DEV_TENANT_ID, "prioritySupport"))
        .allowed,
    ).toBe(false);
    await activatePlan(repos, DEV_TENANT_ID, "pro");
    expect(
      (await checkEntitlement(repos.subscriptions, DEV_TENANT_ID, "prioritySupport"))
        .allowed,
    ).toBe(true);
  });
});
