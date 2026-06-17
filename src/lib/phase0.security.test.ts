// Phase 0 — assorted hardening proofs (S8 JSON-LD escape, S7 per-tenant slug
// isolation, S5 digestPayload binding). All run in mock mode (no DB).

import { beforeEach, describe, expect, it } from "vitest";
import { renderJsonLd } from "@/lib/siteEngine";
import { digestPayload } from "@/integrations/core/approvalToken";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import type { PublishedSite } from "@/lib/types";

// --- S8: JSON-LD escape ------------------------------------------------------

describe("S8 — renderJsonLd escapes a </script> payload", () => {
  it("neutralises a `</script>` breakout in any field", () => {
    const schema = {
      "@type": "LocalBusiness",
      name: 'Evil </script><script>alert(1)</script>',
    };
    const out = renderJsonLd(schema);
    // No raw `<` or `</` survives — the script tag cannot be closed.
    expect(out).not.toContain("<");
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c"); // `<` was escaped
    expect(out).toContain("\\u002f"); // `/` was escaped
    // Still valid JSON that round-trips to the original value.
    expect(JSON.parse(out)).toEqual(schema);
  });
});

// --- S7: per-tenant slug isolation ------------------------------------------

function siteFor(slug: string, offer: string): PublishedSite {
  // Minimal PublishedSite-shaped snapshot; only slug/offer matter to the repo.
  return {
    slug,
    offer,
    name: "Shop",
    industry: "Retail",
    location: "Jozi",
    whatsapp: "27000000000",
    domain: "",
    email: "a@b.co.za",
    tone: "Friendly",
    services: "x",
    servicesList: ["x"],
    publishedAt: new Date().toISOString(),
    launchRecord: [],
  } as unknown as PublishedSite;
}

describe("S7 — slug uniqueness is scoped per tenant", () => {
  beforeEach(() => __resetMemoryStore());

  it("two tenants can publish the SAME slug with no collision or overwrite", async () => {
    const sites = memoryRepositories.sites;
    const a = await sites.publish("tenant-a", "biz-a", siteFor("joes-shop", "A's offer"));
    const b = await sites.publish("tenant-b", "biz-b", siteFor("joes-shop", "B's offer"));

    // Distinct records, distinct ids, no overwrite.
    expect(a.id).not.toBe(b.id);
    expect(a.tenantId).toBe("tenant-a");
    expect(b.tenantId).toBe("tenant-b");

    // Each tenant still sees ONLY its own site under that slug.
    const aSites = await sites.listByTenant("tenant-a");
    const bSites = await sites.listByTenant("tenant-b");
    expect(aSites).toHaveLength(1);
    expect(bSites).toHaveLength(1);
    expect(aSites[0].site.offer).toBe("A's offer");
    expect(bSites[0].site.offer).toBe("B's offer");

    // Re-publishing tenant-a's slug versions tenant-a's site only (not b's).
    const a2 = await sites.publish("tenant-a", "biz-a", siteFor("joes-shop", "A v2"));
    expect(a2.id).toBe(a.id);
    expect(a2.version).toBe(2);
    const bAfter = await sites.listByTenant("tenant-b");
    expect(bAfter[0].site.offer).toBe("B's offer"); // untouched
    expect(bAfter[0].version).toBe(1);
  });
});

// --- S5: digestPayload binding unchanged ------------------------------------

describe("S5 — digestPayload is a stable, canonical SHA-256 binding digest", () => {
  it("is order-independent (canonicalised) and deterministic", () => {
    const h1 = digestPayload({ a: 1, b: 2 });
    const h2 = digestPayload({ b: 2, a: 1 });
    expect(h1).toBe(h2); // canonical key ordering → same digest
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // plain SHA-256 hex
  });

  it("differs for different payloads (binding still distinguishes)", () => {
    expect(digestPayload({ domain: "example.co.za" })).not.toBe(
      digestPayload({ domain: "attacker.co.za" }),
    );
  });

  it("treats null/undefined/empty payloads identically (unchanged behaviour)", () => {
    expect(digestPayload(undefined)).toBe(digestPayload({}));
    expect(digestPayload(null)).toBe(digestPayload({}));
  });
});
