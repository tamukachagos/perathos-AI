"use client";

import { useEffect, useState } from "react";
import type { PublishedSite } from "@/lib/types";
import { readPublishedSites } from "@/lib/clientStore";
import { MissingSiteView, PublishedSiteView } from "./PublishedSiteView";

// M0 client fallback: when a slug is not in the server-side mock catalog, it may
// be a site the visitor just drafted+published into localStorage. Read it on the
// client and render the same view. (M2 makes all sites server-rendered records.)
export function ClientSiteFallback({ slug }: { slug: string }) {
  const [site, setSite] = useState<PublishedSite | null | undefined>(undefined);

  useEffect(() => {
    const sites = readPublishedSites();
    setSite(sites[slug] ?? null);
    if (sites[slug]) {
      document.title = `${sites[slug].name} — ${sites[slug].location}`;
    }
  }, [slug]);

  // Avoid a hydration flash: render nothing until we've checked the store.
  if (site === undefined) return null;
  if (site === null) return <MissingSiteView />;
  return <PublishedSiteView site={site} />;
}
