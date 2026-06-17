"use server";

// Server actions the dashboard calls when authenticated. All tenant scoping
// comes from requireTenant() (the session); the client never supplies a tenant.
// In mock mode these run against the in-memory repo; with DATABASE_URL set they
// run against Postgres — same call sites, no change.

import type { Business } from "@/lib/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { buildPublishedSite } from "@/lib/siteEngine";

/** Persist the tenant's primary business profile (the draft). */
export async function saveBusinessAction(business: Business): Promise<void> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  await repos.businesses.upsertPrimary(ctx.tenantId, business);
}

/**
 * Publish the current draft to a versioned site record and return its slug.
 * Builds the PublishedSite snapshot from the saved business + existing sites so
 * slugs stay unique, mirroring the M0 client behaviour.
 */
export async function publishSiteAction(business: Business): Promise<{ slug: string }> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  const record = await repos.businesses.upsertPrimary(ctx.tenantId, business);

  const existing = await repos.sites.listByTenant(ctx.tenantId);
  const existingSites = Object.fromEntries(existing.map((s) => [s.slug, s.site]));
  const site = buildPublishedSite(business, existingSites);

  await repos.sites.publish(ctx.tenantId, record.id, site);
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "site.publish",
    targetType: "site",
    targetId: site.slug,
    metadata: { slug: site.slug },
  });

  return { slug: site.slug };
}
