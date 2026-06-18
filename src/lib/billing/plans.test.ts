import { describe, expect, it } from "vitest";
import {
  allPlans,
  DEFAULT_PLAN,
  entitlementsFor,
  formatZar,
  isPlanId,
  planFor,
} from "./plans";

describe("entitlementsFor — per-plan capability resolution", () => {
  it("Free: 1 site, no custom domain, branding kept, no payments", () => {
    const e = entitlementsFor("free");
    expect(e.maxSites).toBe(1);
    expect(e.customDomain).toBe(false);
    expect(e.removeBranding).toBe(false);
    expect(e.payments).toBe(false);
    expect(e.prioritySupport).toBe(false);
    expect(e.agentTeam).toBe(false);
  });

  it("Growth: custom domain, branding removed, payments — single site, no agent team", () => {
    const e = entitlementsFor("growth");
    expect(e.maxSites).toBe(1);
    expect(e.customDomain).toBe(true);
    expect(e.removeBranding).toBe(true);
    expect(e.payments).toBe(true);
    expect(e.prioritySupport).toBe(false);
    // W7: the agent team is Pro-only — Growth does NOT include it.
    expect(e.agentTeam).toBe(false);
  });

  it("Pro: multi-site + priority + agent team + everything Growth has", () => {
    const e = entitlementsFor("pro");
    expect(e.maxSites).toBeGreaterThan(1);
    expect(e.customDomain).toBe(true);
    expect(e.removeBranding).toBe(true);
    expect(e.payments).toBe(true);
    expect(e.prioritySupport).toBe(true);
    // W7: the always-on agent team is bundled on Pro (and Managed later).
    expect(e.agentTeam).toBe(true);
  });

  it("unknown / null / undefined resolves to the default (Free) entitlements", () => {
    expect(entitlementsFor("enterprise")).toEqual(entitlementsFor(DEFAULT_PLAN));
    expect(entitlementsFor(null)).toEqual(entitlementsFor("free"));
    expect(entitlementsFor(undefined)).toEqual(entitlementsFor("free"));
  });
});

describe("plan catalog helpers", () => {
  it("isPlanId only accepts known plan ids", () => {
    expect(isPlanId("free")).toBe(true);
    expect(isPlanId("growth")).toBe(true);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("enterprise")).toBe(false);
    expect(isPlanId(null)).toBe(false);
    expect(isPlanId(42)).toBe(false);
  });

  it("planFor falls back to Free for unknowns", () => {
    expect(planFor("nope").id).toBe("free");
    expect(planFor("pro").id).toBe("pro");
  });

  it("allPlans returns the three tiers cheapest first", () => {
    const plans = allPlans();
    expect(plans.map((p) => p.id)).toEqual(["free", "growth", "pro"]);
    expect(plans[0].priceCents).toBe(0);
    expect(plans[1].priceCents).toBeLessThan(plans[2].priceCents);
  });

  it("formatZar renders ZAR amounts", () => {
    expect(formatZar(0)).toBe("R0");
    expect(formatZar(14900)).toBe("R149");
    expect(formatZar(34900)).toBe("R349");
    expect(formatZar(15050)).toBe("R150.50");
  });
});
