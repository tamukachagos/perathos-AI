// Tenant authorization — the SINGLE app-layer scoping point.
//
// Every server-side read/write derives its `tenantId` from here (which derives
// it from the Auth.js session), so no route invents its own scoping. The
// Postgres RLS policies are the DB-layer backstop behind this.
//
// In mock mode (no DATABASE_URL) the active session maps to the seeded dev
// tenant, so the whole authenticated flow is exercisable with no database.

import { auth } from "@/lib/auth";
import { hasDatabase } from "@/lib/env";
import { DEV_TENANT_ID, DEV_USER_ID } from "@/lib/db/seed";

export interface TenantContext {
  tenantId: string;
  userId: string;
  email: string | null;
}

/**
 * Resolve the current tenant context from the session, or `null` if there is no
 * authenticated user (anonymous). Does not throw.
 */
export async function getCurrentTenant(): Promise<TenantContext | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  if (!hasDatabase()) {
    // Mock mode: a single seeded tenant owned by the dev user.
    return {
      tenantId: DEV_TENANT_ID,
      userId: user.id ?? DEV_USER_ID,
      email: user.email ?? null,
    };
  }

  // Postgres mode: resolve the tenant from the user's membership. A user with no
  // membership yet (just signed in) gets a tenant provisioned lazily below.
  const userId = user.id;
  if (!userId) return null;

  const { prisma } = await import("@/lib/db/prisma/client");
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (membership) {
    return { tenantId: membership.tenantId, userId, email: user.email ?? null };
  }

  // First sign-in: create the user's own tenant + owner membership.
  const tenant = await provisionTenant(userId, user.email ?? null, user.name ?? null);
  return { tenantId: tenant, userId, email: user.email ?? null };
}

/**
 * Like getCurrentTenant() but throws when there is no authenticated tenant.
 * Use this to guard tenant-owned mutations.
 */
export async function requireTenant(): Promise<TenantContext> {
  const ctx = await getCurrentTenant();
  if (!ctx) throw new Error("Unauthorized: no authenticated tenant");
  return ctx;
}

/** Provision a fresh tenant + owner membership for a newly-signed-in user. */
async function provisionTenant(
  userId: string,
  email: string | null,
  name: string | null,
): Promise<string> {
  const { prisma } = await import("@/lib/db/prisma/client");
  const base = (name ?? email ?? "tenant")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "tenant";
  const slug = `${base}-${userId.slice(0, 6)}`;

  const tenant = await prisma.tenant.create({
    data: {
      name: name ?? email ?? "My business",
      slug,
      memberships: { create: { userId, role: "owner" } },
    },
  });
  return tenant.id;
}
