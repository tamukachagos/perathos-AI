import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "./memory";
import { DEV_TENANT_ID } from "./seed";
import { initialBusiness } from "@/lib/platformData";

const OTHER_TENANT = "other-tenant";

describe("in-memory repository", () => {
  beforeEach(() => {
    __resetMemoryStore();
  });

  it("is seeded with the Maboneng sample for the dev tenant", async () => {
    const primary = await memoryRepositories.businesses.getPrimary(DEV_TENANT_ID);
    expect(primary?.name).toBe(initialBusiness.name);

    const site = await memoryRepositories.sites.getBySlug("maboneng-mobile-spa");
    expect(site?.site.name).toBe(initialBusiness.name);
  });

  it("scopes businesses by tenant", async () => {
    const seeded = await memoryRepositories.businesses.list(DEV_TENANT_ID);
    expect(seeded.length).toBe(1);

    // Another tenant sees nothing from the dev tenant.
    expect(await memoryRepositories.businesses.list(OTHER_TENANT)).toEqual([]);
    expect(await memoryRepositories.businesses.getPrimary(OTHER_TENANT)).toBeNull();
  });

  it("upserts the primary business in place", async () => {
    const updated = await memoryRepositories.businesses.upsertPrimary(
      DEV_TENANT_ID,
      { ...initialBusiness, offer: "Updated offer" },
    );
    expect(updated.offer).toBe("Updated offer");

    // Still one business (upsert updated, did not create a second).
    const all = await memoryRepositories.businesses.list(DEV_TENANT_ID);
    expect(all.length).toBe(1);
  });

  it("publishes and versions sites, scoped by tenant", async () => {
    const biz = await memoryRepositories.businesses.create(OTHER_TENANT, {
      ...initialBusiness,
      name: "Joe's Shop",
    });
    const built = {
      ...initialBusiness,
      name: "Joe's Shop",
      slug: "joes-shop",
      publishedAt: new Date().toISOString(),
      servicesList: ["A"],
      launchRecord: [],
    };

    const first = await memoryRepositories.sites.publish(OTHER_TENANT, biz.id, built);
    expect(first.version).toBe(1);

    const second = await memoryRepositories.sites.publish(OTHER_TENANT, biz.id, built);
    expect(second.version).toBe(2);

    // The dev tenant cannot see another tenant's site by listing.
    const devSites = await memoryRepositories.sites.listByTenant(DEV_TENANT_ID);
    expect(devSites.find((s) => s.slug === "joes-shop")).toBeUndefined();
  });

  it("captures POPIA consent fields on leads", async () => {
    const lead = await memoryRepositories.leads.create(DEV_TENANT_ID, {
      businessId: "seed-business-maboneng",
      name: "Sam",
      contact: "sam@example.com",
      consent: true,
      marketingOptIn: false,
    });
    expect(lead.consent).toBe(true);
    expect(lead.consentAt).not.toBeNull();
    expect(lead.marketingOptIn).toBe(false);
    expect(lead.purpose).toBe("Respond to this enquiry");
  });

  it("keeps the audit log append-only and tenant-scoped", async () => {
    await memoryRepositories.audit.append(DEV_TENANT_ID, { action: "site.publish" });
    await memoryRepositories.audit.append(OTHER_TENANT, { action: "site.publish" });

    const devLog = await memoryRepositories.audit.list(DEV_TENANT_ID);
    expect(devLog.length).toBe(1);
    expect(devLog[0].action).toBe("site.publish");
  });
});
