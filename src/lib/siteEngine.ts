// Pure site-engine helpers: slug/route/publish logic and the LocalBusiness
// JSON-LD builder. Ported VERBATIM (behaviour-identical) from the prototype's
// src/siteEngine.js. No DOM or localStorage here so it is safe on the server.

import type {
  Business,
  BusinessSchema,
  PublishedSite,
  PublishedSites,
} from "./types";
import { slugify } from "./format";
import { launchAdapters, STATUS } from "@/integrations/core/registry";

export { slugify };

// Guarantee a unique slug so publishing a second "Joe's Shop" never silently
// overwrites the first one.
export function uniqueSlug(baseName: string, takenSlugs: string[] = []): string {
  const base = slugify(baseName);
  const taken = new Set(takenSlugs);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function buildPublishedSite(
  business: Business,
  existingSites: PublishedSites = {},
): PublishedSite {
  const ownSlug = slugify(business.name);
  // Re-publishing the same business keeps its slug; a genuinely new name that
  // collides with an existing site gets a numbered suffix.
  const slug = existingSites[ownSlug]
    ? ownSlug
    : uniqueSlug(business.name, Object.keys(existingSites));
  const publishedAt = new Date().toISOString();
  const services = business.services
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);

  return {
    ...business,
    slug,
    publishedAt,
    servicesList:
      services.length > 0
        ? services
        : ["Consultation", "Bookings", "Customer support"],
    launchRecord: launchAdapters.map((adapter) => {
      const { status } = adapter.evaluate(business);
      return {
        id: adapter.key,
        title: adapter.title,
        provider: adapter.provider,
        status: status === STATUS.REVIEW ? "approval-required" : status,
      };
    }),
  };
}

// Google-friendly structured data emitted on every published site. Helps the
// site appear in the Local Pack / Maps, which for mobile-first SA discovery
// often matters more than the website itself.
export function buildBusinessSchema(site: PublishedSite): BusinessSchema {
  const schema: BusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: site.name,
    description: site.offer,
    areaServed: site.location,
    address: {
      "@type": "PostalAddress",
      addressLocality: site.location,
      addressCountry: "ZA",
    },
  };
  if (site.email) schema.email = site.email;
  if (site.domain) schema.url = `https://${site.domain}`;
  if (site.servicesList?.length) {
    schema.makesOffer = site.servicesList.map((service) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: service },
    }));
  }
  return schema;
}

/**
 * Serialise a JSON-LD schema for SAFE injection via dangerouslySetInnerHTML (S8).
 *
 * `JSON.stringify` does NOT escape `<` or `/`, so a `</script>` sequence in any
 * field would close the surrounding <script> tag and let arbitrary markup run.
 * We escape `<` → < and the `/` in `</` → / (both valid JSON-string
 * escapes that parse back to the identical value), so structured data can never
 * break out of the script tag. Kept here as a pure, unit-testable function.
 */
export function renderJsonLd(schema: unknown): string {
  return JSON.stringify(schema)
    .replace(/</g, "\\u003c")
    .replace(/\//g, "\\u002f");
}
