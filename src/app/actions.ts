"use server";

// Server actions the dashboard calls when authenticated. All tenant scoping
// comes from requireTenant() (the session); the client never supplies a tenant.
// In mock mode these run against the in-memory repo; with DATABASE_URL set they
// run against Postgres — same call sites, no change.

import { revalidatePath } from "next/cache";
import type { Business } from "@/lib/types";
import type { SiteVersionRecord } from "@/lib/db/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { buildPublishedSite } from "@/lib/siteEngine";
import { sanitizeBusiness, sanitizePublishedSite } from "@/lib/sanitize";
import { runPublishChain } from "@/lib/publishPipeline";

/** Persist the tenant's primary business profile (the draft). */
export async function saveBusinessAction(business: Business): Promise<void> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  // Sanitize the draft on the way in so stored data is never raw markup.
  await repos.businesses.upsertPrimary(ctx.tenantId, sanitizeBusiness(business));
}

/**
 * Publish the current draft to a versioned site record and return its slug.
 *
 * Data flow: Business draft -> sanitizeBusiness -> buildPublishedSite (derives
 * slug/servicesList/launchRecord) -> sanitizePublishedSite (defence in depth on
 * the derived fields) -> sites.publish() appends a NEW site_versions row and
 * re-points the GeneratedSite's currentVersion. An audit_log entry is written.
 * Re-publishing the same business reuses the slug and increments the version.
 *
 * Mock mode (no DATABASE_URL): the whole flow runs against the in-memory repo,
 * so it is exercisable with no DB. DB mode: identical call sites, Prisma impl.
 */
export async function publishSiteAction(
  business: Business,
): Promise<{ slug: string; version: number }> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  const clean = sanitizeBusiness(business);
  const record = await repos.businesses.upsertPrimary(ctx.tenantId, clean);

  const existing = await repos.sites.listByTenant(ctx.tenantId);
  const existingSites = Object.fromEntries(existing.map((s) => [s.slug, s.site]));
  const site = sanitizePublishedSite(buildPublishedSite(clean, existingSites));

  const published = await repos.sites.publish(ctx.tenantId, record.id, site);
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "site.publish",
    targetType: "site",
    targetId: site.slug,
    metadata: { slug: site.slug, version: published.version },
  });

  // W6 — publish -> commit -> deploy. The site_version is already written above;
  // this commits it to the per-customer GitHub repo and triggers a gated+async
  // Vercel deploy. It is best-effort (a failure never fails the publish) and the
  // deploy settles to live via the Vercel webhook / reconcile cron.
  await runPublishChain(repos, {
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    business: clean,
    slug: site.slug,
    version: published.version,
  });

  // Refresh the ISR cache for the public page so the new version is served.
  revalidatePath(`/s/${site.slug}`);
  return { slug: site.slug, version: published.version };
}

/** List a published site's version history (newest first), tenant-scoped. */
export async function listSiteVersionsAction(
  slug: string,
): Promise<SiteVersionRecord[]> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const sites = await repos.sites.listByTenant(ctx.tenantId);
  const site = sites.find((s) => s.slug === slug);
  if (!site) return [];
  return repos.sites.listVersions(ctx.tenantId, site.id);
}

/**
 * Roll back a published site to a prior version. Appends a NEW version copying
 * the target snapshot (forward-only history) and records an audit entry.
 */
export async function rollbackSiteAction(
  slug: string,
  version: number,
): Promise<{ slug: string; version: number }> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  const sites = await repos.sites.listByTenant(ctx.tenantId);
  const site = sites.find((s) => s.slug === slug);
  if (!site) throw new Error(`Site ${slug} not found for tenant`);

  const restored = await repos.sites.restoreVersion(
    ctx.tenantId,
    site.id,
    version,
  );
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: "site.rollback",
    targetType: "site",
    targetId: slug,
    metadata: { slug, restoredFrom: version, newVersion: restored.version },
  });

  revalidatePath(`/s/${slug}`);
  return { slug, version: restored.version };
}
