import { describe, expect, it } from "vitest";
import {
  sanitizeBusiness,
  sanitizePublishedSite,
  sanitizeText,
  sanitizeUrl,
} from "./sanitize";
import type { Business, PublishedSite } from "./types";

describe("sanitizeText", () => {
  it("strips script tags and their contents", () => {
    expect(sanitizeText("<script>alert('xss')</script>Hello")).toBe("Hello");
  });

  it("strips event-handler-bearing tags entirely", () => {
    const out = sanitizeText('<img src=x onerror="alert(1)">caption');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
    expect(out).toBe("caption");
  });

  it("strips svg onload payloads", () => {
    const out = sanitizeText('<svg onload="alert(1)"></svg>Spa');
    expect(out).not.toContain("onload");
    expect(out).toBe("Spa");
  });

  it("preserves plain text and decodes safe entities", () => {
    expect(sanitizeText("Nails & spa")).toBe("Nails & spa");
  });

  it("handles empty / non-string input", () => {
    expect(sanitizeText("")).toBe("");
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
  });
});

describe("sanitizeUrl — scheme allowlist", () => {
  it("rejects javascript: URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("JaVaScRiPt:alert(1)")).toBeNull();
  });

  it("rejects data: and vbscript: URLs", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects scheme-relative URLs", () => {
    expect(sanitizeUrl("//evil.example")).toBeNull();
  });

  it("allows https, mailto and tel", () => {
    expect(sanitizeUrl("https://wa.me/27825550198")).toContain("https://wa.me/");
    expect(sanitizeUrl("mailto:hello@spa.co.za")).toBe("mailto:hello@spa.co.za");
    expect(sanitizeUrl("tel:+27825550198")).toBe("tel:+27825550198");
  });

  it("accepts a bare domain as https", () => {
    expect(sanitizeUrl("https://mabonengspa.co.za")).toContain(
      "mabonengspa.co.za",
    );
  });
});

describe("sanitizeBusiness / sanitizePublishedSite", () => {
  const dirty: Business = {
    name: "<script>alert(1)</script>Maboneng",
    industry: "Beauty",
    location: "Jozi",
    whatsapp: "+27 82 555 0198",
    domain: "spa.co.za",
    email: "hello@spa.co.za",
    tone: "Friendly",
    offer: '<img src=x onerror="steal()">Best spa',
    services: "massage, nails",
  };

  it("scrubs every business field", () => {
    const clean = sanitizeBusiness(dirty);
    expect(clean.name).toBe("Maboneng");
    expect(clean.offer).toBe("Best spa");
    expect(JSON.stringify(clean)).not.toMatch(/<script|onerror/i);
  });

  it("scrubs derived servicesList and launchRecord on a published site", () => {
    const site: PublishedSite = {
      ...dirty,
      slug: "maboneng",
      publishedAt: "2026-01-01T00:00:00.000Z",
      servicesList: ["<b>massage</b>", "nails"],
      launchRecord: [
        {
          id: "domain",
          title: "<script>x</script>Domain",
          provider: "mock",
          status: "ready",
        },
      ],
    };
    const clean = sanitizePublishedSite(site);
    expect(clean.servicesList).toEqual(["massage", "nails"]);
    expect(clean.launchRecord[0].title).toBe("Domain");
    expect(clean.slug).toBe("maboneng");
    expect(clean.publishedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
