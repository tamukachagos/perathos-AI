// RLS SMOKE TEST (W1 / Part 3 cross-cutting).
//
// Asserts the Postgres tenant-isolation backstop is ACTUALLY on — a wrong DB
// role silently disables all isolation, so green app tests would not catch it:
//   1. the app DB role is NOT superuser and does NOT have BYPASSRLS;
//   2. current_setting('app.current_tenant_id', true) is NULL OUTSIDE withTenant;
//   3. a cross-tenant read returns 0 rows (tenant B cannot see tenant A's data);
//   4. the B5 public-read policy DOES expose a published site with no tenant.
//
// Runs only with a real DATABASE_URL (the db-tests CI job).

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, withTenant } from "./prisma/client";
import { resetDb, TENANT_A, TENANT_B } from "./testdb";

describe("RLS smoke — tenant isolation is real", () => {
  beforeAll(async () => {
    // A clean schema with the policies applied is a prerequisite.
    await resetDb();
  });
  beforeEach(async () => {
    await resetDb();
  });

  it("the app DB role is NOT superuser and NOT BYPASSRLS", async () => {
    const rows = await prisma.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows.length).toBe(1);
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
  });

  it("current_setting('app.current_tenant_id', true) is NULL outside withTenant", async () => {
    const rows = await prisma.$queryRaw<{ tid: string | null }[]>`
      SELECT current_setting('app.current_tenant_id', true) AS tid`;
    // Unset transaction-local setting reads back as NULL (or empty string).
    expect(rows[0].tid === null || rows[0].tid === "").toBe(true);
  });

  it("a cross-tenant read returns 0 rows", async () => {
    // Tenant A writes a business inside its own scope.
    await withTenant(TENANT_A, (tx) =>
      tx.business.create({
        data: { tenantId: TENANT_A, name: "A's secret business" },
      }),
    );

    // Tenant B, scoped to itself, must see NONE of A's rows.
    const seenByB = await withTenant(TENANT_B, (tx) =>
      tx.business.findMany({}),
    );
    expect(seenByB.length).toBe(0);

    // Tenant A sees its own.
    const seenByA = await withTenant(TENANT_A, (tx) => tx.business.findMany({}));
    expect(seenByA.length).toBe(1);

    // The UNSCOPED base client also sees none (FORCE RLS, NULL tenant).
    const unscoped = await prisma.business.findMany({});
    expect(unscoped.length).toBe(0);
  });

  it("B5: a PUBLISHED site is readable with NO tenant in context", async () => {
    // Tenant A creates a business + a published site + its current version.
    const { siteId } = await withTenant(TENANT_A, async (tx) => {
      const biz = await tx.business.create({
        data: { tenantId: TENANT_A, name: "Public Co" },
      });
      const site = await tx.generatedSite.create({
        data: {
          tenantId: TENANT_A,
          businessId: biz.id,
          slug: "public-co",
          status: "published",
          publishedAt: new Date(),
        },
      });
      const version = await tx.siteVersion.create({
        data: {
          tenantId: TENANT_A,
          siteId: site.id,
          version: 1,
          snapshot: { slug: "public-co", hero: "hi" },
        },
      });
      await tx.generatedSite.update({
        where: { id: site.id },
        data: { currentVersionId: version.id },
      });
      return { siteId: site.id };
    });
    expect(siteId).toBeTruthy();

    // The UNSCOPED base client (the public /s/[slug] path) sees the published
    // site AND its current version snapshot.
    const publicRow = await prisma.generatedSite.findFirst({
      where: { slug: "public-co", status: "published" },
      include: { currentVersion: true },
    });
    expect(publicRow).not.toBeNull();
    expect(publicRow?.currentVersion).not.toBeNull();
    expect((publicRow?.currentVersion?.snapshot as { slug?: string })?.slug).toBe(
      "public-co",
    );
  });

  it("B5: a DRAFT site is NOT readable with no tenant in context", async () => {
    await withTenant(TENANT_A, async (tx) => {
      const biz = await tx.business.create({
        data: { tenantId: TENANT_A, name: "Draft Co" },
      });
      await tx.generatedSite.create({
        data: {
          tenantId: TENANT_A,
          businessId: biz.id,
          slug: "draft-co",
          status: "draft",
        },
      });
    });

    const unscoped = await prisma.generatedSite.findMany({
      where: { slug: "draft-co" },
    });
    expect(unscoped.length).toBe(0); // draft is NOT public
  });
});
