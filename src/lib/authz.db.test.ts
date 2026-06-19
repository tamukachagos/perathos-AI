import { describe, expect, it, beforeEach } from "vitest";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import { resetDb } from "@/lib/db/testdb";
import {
  provisionTenantForUser,
  resolvePrimaryTenantIdForUser,
} from "@/lib/authz";

describe("authz tenant bootstrap (Postgres)", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@authz.test" } },
    });
  });

  it("resolves and provisions tenants without unscoped membership reads", async () => {
    const user = await prisma.user.create({
      data: { email: "owner@authz.test", name: "Owner" },
    });

    expect(await prisma.membership.findMany({ where: { userId: user.id } })).toEqual(
      [],
    );
    expect(await resolvePrimaryTenantIdForUser(user.id)).toBeNull();

    const tenantId = await provisionTenantForUser(
      user.id,
      user.email,
      user.name,
    );

    expect(await prisma.membership.findMany({ where: { userId: user.id } })).toEqual(
      [],
    );
    expect(await resolvePrimaryTenantIdForUser(user.id)).toBe(tenantId);

    const scopedMemberships = await withTenant(tenantId, (tx) =>
      tx.membership.findMany({ where: { userId: user.id } }),
    );
    expect(scopedMemberships).toHaveLength(1);
    expect(scopedMemberships[0].role).toBe("owner");
  });
});
