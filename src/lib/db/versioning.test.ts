import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "./memory";
import { DEV_TENANT_ID } from "./seed";
import { initialBusiness } from "@/lib/platformData";
import { buildPublishedSite } from "@/lib/siteEngine";
import type { PublishedSite } from "@/lib/types";

const sites = memoryRepositories.sites;

// Build a snapshot with a fixed name (stable slug) and a distinguishing offer.
function snapshotFor(name: string, offer: string): PublishedSite {
  return buildPublishedSite({ ...initialBusiness, name, offer });
}

describe("publish pipeline — versioning & rollback (mock repo)", () => {
  beforeEach(() => {
    __resetMemoryStore();
  });

  it("publish creates a version (v1 for a new site)", async () => {
    const biz = await memoryRepositories.businesses.create(DEV_TENANT_ID, {
      ...initialBusiness,
      name: "Joe's Shop",
    });
    const rec = await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "v1 offer"),
    );
    expect(rec.version).toBe(1);

    const history = await sites.listVersions(DEV_TENANT_ID, rec.id);
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].isCurrent).toBe(true);
  });

  it("re-publish increments the version and re-points current", async () => {
    const biz = await memoryRepositories.businesses.create(DEV_TENANT_ID, {
      ...initialBusiness,
      name: "Joe's Shop",
    });
    const first = await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "v1"),
    );
    const second = await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "v2"),
    );
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);

    const history = await sites.listVersions(DEV_TENANT_ID, second.id);
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    expect(history.find((v) => v.isCurrent)?.version).toBe(2);
  });

  it("rollback restores a prior snapshot as a new forward version", async () => {
    const biz = await memoryRepositories.businesses.create(DEV_TENANT_ID, {
      ...initialBusiness,
      name: "Joe's Shop",
    });
    const v1 = await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "original offer"),
    );
    await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "changed offer"),
    );

    // Roll back to v1's content.
    const restored = await sites.restoreVersion(DEV_TENANT_ID, v1.id, 1);
    expect(restored.version).toBe(3); // forward-only
    expect(restored.site.offer).toBe("original offer");

    // The publicly-served record now matches the rolled-back content.
    const current = await sites.getBySlug("joe-s-shop");
    expect(current?.site.offer).toBe("original offer");
    expect(current?.version).toBe(3);
  });

  it("rejects rolling back a non-existent version", async () => {
    const biz = await memoryRepositories.businesses.create(DEV_TENANT_ID, {
      ...initialBusiness,
      name: "Joe's Shop",
    });
    const rec = await sites.publish(
      DEV_TENANT_ID,
      biz.id,
      snapshotFor("Joe's Shop", "x"),
    );
    await expect(
      sites.restoreVersion(DEV_TENANT_ID, rec.id, 99),
    ).rejects.toThrow();
  });
});
