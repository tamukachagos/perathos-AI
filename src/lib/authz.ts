// Tenant authorization: the single app-layer scoping point.
//
// Every server-side read/write derives its tenantId from here (which derives it
// from the Auth.js session), so no route invents its own scoping. The Postgres
// RLS policies are the DB-layer backstop behind this.

import { randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { hasDatabase } from "@/lib/env";
import { DEV_TENANT_ID, DEV_USER_ID } from "@/lib/db/seed";

export interface TenantContext {
  tenantId: string;
  userId: string;
  email: string | null;
}

/**
 * Resolve the current tenant context from the session, or null if there is no
 * authenticated user. Does not throw.
 */
export async function getCurrentTenant(): Promise<TenantContext | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  if (!hasDatabase()) {
    return {
      tenantId: DEV_TENANT_ID,
      userId: user.id ?? DEV_USER_ID,
      email: user.email ?? null,
    };
  }

  const userId = user.id;
  if (!userId) return null;

  const membershipTenantId = await resolvePrimaryTenantIdForUser(userId);
  if (membershipTenantId) {
    return { tenantId: membershipTenantId, userId, email: user.email ?? null };
  }

  const tenantId = await provisionTenantForUser(
    userId,
    user.email ?? null,
    user.name ?? null,
  );
  return { tenantId, userId, email: user.email ?? null };
}

/**
 * Like getCurrentTenant(), but throws when there is no authenticated tenant.
 * Use this to guard tenant-owned mutations.
 */
export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getCurrentTenant();
  if (!ctx) throw new Error("Unauthorized: no authenticated tenant");
  return ctx;
}

/**
 * Resolve the first tenant for a user through a narrow SECURITY DEFINER helper.
 * A base Prisma membership query cannot work here under FORCE RLS because there
 * is no tenant context yet.
 */
export async function resolvePrimaryTenantIdForUser(
  userId: string,
): Promise<string | null> {
  const { prisma } = await import("@/lib/db/prisma/client");
  const rows = await prisma.$queryRaw<{ tenantId: string }[]>`
    SELECT "tenantId" FROM primary_tenant_for_user(${userId})
  `;
  return rows[0]?.tenantId ?? null;
}

/** Provision a fresh tenant plus owner membership for a newly-signed-in user. */
export async function provisionTenantForUser(
  userId: string,
  email: string | null,
  name: string | null,
): Promise<string> {
  const { prisma } = await import("@/lib/db/prisma/client");
  const base =
    (name ?? email ?? "tenant")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tenant";
  const tenantId = `ten_${randomBytes(12).toString("hex")}`;
  const slug = `${base}-${userId.slice(0, 6)}-${tenantId.slice(-6)}`;

  const rows = await prisma.$queryRaw<{ tenantId: string }[]>`
    SELECT provision_owner_tenant(
      ${tenantId},
      ${name ?? email ?? "My business"},
      ${slug},
      ${userId}
    ) AS "tenantId"
  `;
  return rows[0]?.tenantId ?? tenantId;
}
