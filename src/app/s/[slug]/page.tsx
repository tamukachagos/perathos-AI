import type { Metadata } from "next";
import { getMockSite, mockSiteSlugs } from "@/lib/mockSites";
import { ClientSiteFallback } from "@/components/site/ClientSiteFallback";
import { PublishedSiteView } from "@/components/site/PublishedSiteView";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Pre-render the known mock sites; other slugs render on demand.
export function generateStaticParams() {
  return mockSiteSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const site = getMockSite(slug);
  if (!site) return { title: "Launch Desk" };
  return {
    title: `${site.name} — ${site.location}`,
    description: site.offer,
  };
}

export const dynamicParams = true;

export default async function PublishedSitePage({ params }: PageProps) {
  const { slug } = await params;
  const site = getMockSite(slug);

  // Server-rendered (with JSON-LD) for the known mock catalog; client fallback
  // reads a just-published localStorage draft for any other slug (M0 only).
  if (site) {
    return <PublishedSiteView site={site} />;
  }
  return <ClientSiteFallback slug={slug} />;
}
