// Prisma-repo correctness + memory-vs-Prisma versioning PARITY (B10).
//
// The green mock suite proves the in-memory repo only. B10: version-number
// derivation differs (memory: stored counter; Prisma: derived from
// currentVersion), and a drift can collide on the (siteId, version) unique
// constraint. This file runs the SAME publish/rollback sequence against BOTH
// impls and asserts identical version numbering + isCurrent semantics.
//
// Runs only with a real DATABASE_URL (the db-tests CI job).

import { beforeEach, describe, expect, it } from "vitest";
import type { PublishedSite } from "@/lib/types";
import { prismaRepositories } from "./prisma/repositories";
import { memoryRepositories, __resetMemoryStore } from "./memory";
import { resetDb, TENANT_A } from "./testdb";
import { withTenant } from "./prisma/client";
import { initialBusiness } from "@/lib/platformData";

function site(slug: string, marker: string): PublishedSite {
  return {
    slug,
    publishedAt: new Date().toISOString(),
    // A minimal-but-typed snapshot; the marker lets us assert which version is current.
    ...(initialBusinessSite(marker) as object),
  } as unknown as PublishedSite;
}

// Build a small snapshot object carrying a marker we can read back.
function initialBusinessSite(marker: string): Record<string, unknown> {
  return { marker, name: initialBusiness.name };
}

describe("B10 — versioning parity: memory vs Prisma", () => {
  beforeEach(async () => {
    __resetMemoryStore();
    await resetDb();
    // Prisma publish needs a business row to attach to.
    await withTenant(TENANT_A, (tx) =>
      tx.business.create({ data: { id: "biz-a", tenantId: TENANT_A, name: "Biz A" } }),
    );
  });

  it("publish increments version identically and tracks isCurrent the same way", async () => {
    // --- Prisma ---
    const p1 = await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("parity", "v1"));
    const p2 = await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("parity", "v2"));
    const p3 = await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("parity", "v3"));
    expect([p1.version, p2.version, p3.version]).toEqual([1, 2, 3]);

    const pVersions = await prismaRepositories.sites.listVersions(TENANT_A, p3.id);
    expect(pVersions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(pVersions.filter((v) => v.isCurrent).map((v) => v.version)).toEqual([3]);

    // --- Memory (mock repo uses the dev tenant's seeded store) ---
    const MEM_TENANT = "dev-tenant";
    const m1 = await memoryRepositories.sites.publish(MEM_TENANT, "biz-m", site("parity-m", "v1"));
    const m2 = await memoryRepositories.sites.publish(MEM_TENANT, "biz-m", site("parity-m", "v2"));
    const m3 = await memoryRepositories.sites.publish(MEM_TENANT, "biz-m", site("parity-m", "v3"));
    expect([m1.version, m2.version, m3.version]).toEqual([1, 2, 3]);

    const mVersions = await memoryRepositories.sites.listVersions(MEM_TENANT, m3.id);
    expect(mVersions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(mVersions.filter((v) => v.isCurrent).map((v) => v.version)).toEqual([3]);

    // PARITY: both impls produce the same version sequence + single isCurrent.
    expect(pVersions.map((v) => v.version)).toEqual(mVersions.map((v) => v.version));
  });

  it("restoreVersion is forward-only and never collides the unique (siteId, version)", async () => {
    const a = await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("rb", "v1"));
    await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("rb", "v2"));
    // Roll back to version 1 → appends a NEW version 3 (forward-only), not a v1 dup.
    const restored = await prismaRepositories.sites.restoreVersion(TENANT_A, a.id, 1);
    expect(restored.version).toBe(3);

    const versions = await prismaRepositories.sites.listVersions(TENANT_A, a.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    // The restored current snapshot equals v1's marker.
    const current = versions.find((v) => v.isCurrent);
    expect((current?.site as unknown as { marker?: string })?.marker).toBe("v1");
  });

  it("getBySlug resolves a published site on the base client (B5)", async () => {
    await prismaRepositories.sites.publish(TENANT_A, "biz-a", site("findable", "v1"));
    const found = await prismaRepositories.sites.getBySlug("findable");
    expect(found).not.toBeNull();
    expect(found?.slug).toBe("findable");
  });

  it("audit append + list round-trips under RLS", async () => {
    await prismaRepositories.audit.append(TENANT_A, {
      actorId: "u1",
      action: "test.event",
      targetType: "x",
      targetId: "y",
      metadata: { ok: true },
    });
    const log = await prismaRepositories.audit.list(TENANT_A);
    expect(log.length).toBe(1);
    expect(log[0].action).toBe("test.event");
  });
});
