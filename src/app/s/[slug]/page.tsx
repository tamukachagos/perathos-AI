import type { Metadata } from "next";
import type { PublishedSite } from "@/lib/types";
import { getMockSite, mockSiteSlugs } from "@/lib/mockSites";
import { getRepositories } from "@/lib/db";
import { sanitizePublishedSite } from "@/lib/sanitize";
import { entitlementsForSubscription } from "@/lib/billing/service";
import { ClientSiteFallback } from "@/components/site/ClientSiteFallback";
import { PublishedSiteView } from "@/components/site/PublishedSiteView";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Resolve a published site: repository first (Postgres when DATABASE_URL is set,
// otherwise the in-memory repo seeded with the Maboneng sample), falling back to
// the M0 static mock catalog. No DB call happens at build with no DATABASE_URL —
// the in-memory repo serves the seed.
async function resolveSite(slug: string): Promise<PublishedSite | null> {
  let site: PublishedSite | null = null;
  try {
    const repos = await getRepositories();
    const record = await repos.sites.getBySlug(slug);
    if (record) site = record.site;
  } catch {
    // Repository unavailable (e.g. transient DB error): fall back to the mock.
  }
  site ??= getMockSite(slug);
  // Defence in depth: re-sanitize whatever source served the snapshot before it
  // is rendered, so older/mock content can never carry live markup.
  return site ? sanitizePublishedSite(site) : null;
}

// Resolve whether a published site shows the "Powered by Launch Desk" badge:
// free-plan tenants do (default true); paid tenants whose plan removes branding
// don't. Resolved from the owning tenant's subscription. Defaults to true for
// mock/unknown sites and any error — branding-on is the safe default.
async function resolveShowBranding(slug: string): Promise<boolean> {
  try {
    const repos = await getRepositories();
    const record = await repos.sites.getBySlug(slug);
    if (!record) return true;
    const sub = await repos.subscriptions.get(record.tenantId);
    return !entitlementsForSubscription(sub).removeBranding;
  } catch {
    return true;
  }
}

// Pre-render the known mock sites; other slugs render on demand.
export function generateStaticParams() {
  return mockSiteSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const site = await resolveSite(slug);
  if (!site) return { title: "Launch Desk" };
  return {
    title: `${site.name} — ${site.location}`,
    description: site.offer,
  };
}

export const dynamicParams = true;

// ISR: published sites are CDN-cached and regenerated at most every 60s; a
// publish/rollback also calls revalidatePath("/s/<slug>") for instant freshness.
export const revalidate = 60;

export default async function PublishedSitePage({ params }: PageProps) {
  const { slug } = await params;
  const site = await resolveSite(slug);

  // Server-rendered (with JSON-LD) for any persisted/seeded site; client
  // fallback reads a just-published localStorage draft for anonymous use.
  if (site) {
    const showBranding = await resolveShowBranding(slug);
    return <PublishedSiteView site={site} showBranding={showBranding} />;
  }
  return <ClientSiteFallback slug={slug} />;
}
