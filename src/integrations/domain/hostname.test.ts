// W4 — Hostname validator + outbound-allowlist (Part 3.B). Mock / DB-free.

import { describe, expect, it } from "vitest";
import {
  validateHostname,
  tldOf,
  isOutboundHostAllowed,
} from "./hostname";

describe("validateHostname — accepts good public hostnames", () => {
  it("accepts a .co.za hostname and reports the TLD + SLD", () => {
    const r = validateHostname("joes-plumbing.co.za");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tld).toBe("co.za");
      expect(r.sld).toBe("joes-plumbing");
      expect(r.hostname).toBe("joes-plumbing.co.za");
    }
  });

  it("accepts a .com hostname", () => {
    const r = validateHostname("Example.COM");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tld).toBe("com");
      expect(r.hostname).toBe("example.com"); // lower-cased
    }
  });

  it("matches the multi-label suffix longest-first (co.za, not za)", () => {
    const r = validateHostname("shop.co.za");
    expect(r.ok && r.tld).toBe("co.za");
  });
});

describe("validateHostname — rejects bad + internal hosts", () => {
  it.each([
    ["", "empty"],
    ["localhost", "internal_or_reserved"],
    ["server.local", "internal_or_reserved"],
    ["foo.test", "internal_or_reserved"],
    ["127.0.0.1", "internal_or_reserved"],
    ["10.0.0.5", "internal_or_reserved"],
    ["http://evil.com", "has_scheme_or_path"],
    ["evil.com/path", "has_scheme_or_path"],
    ["evil.com:8080", "has_scheme_or_path"],
    ["-bad.com", "bad_format"],
    ["bad-.com", "bad_format"],
    ["space name.com", "has_scheme_or_path"],
    ["foo.xyz", "tld_not_allowed"],
    ["co.za", "bad_format"], // bare suffix, no SLD
  ])("rejects %s as %s", (input, reason) => {
    const r = validateHostname(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it("tldOf returns null for an internal host", () => {
    expect(tldOf("localhost")).toBeNull();
    expect(tldOf("good.co.za")).toBe("co.za");
  });
});

describe("isOutboundHostAllowed — SSRF posture", () => {
  const allow = ["api.za-registrar.co.za", "gtld-reseller.com"];

  it("allows a configured registrar host + its subdomains", () => {
    expect(isOutboundHostAllowed("api.za-registrar.co.za", allow)).toBe(true);
    expect(isOutboundHostAllowed("eu.gtld-reseller.com", allow)).toBe(true);
  });

  it("blocks cloud-metadata, loopback, RFC1918, and reserved names", () => {
    expect(isOutboundHostAllowed("169.254.169.254", allow)).toBe(false);
    expect(isOutboundHostAllowed("127.0.0.1", allow)).toBe(false);
    expect(isOutboundHostAllowed("10.1.2.3", allow)).toBe(false);
    expect(isOutboundHostAllowed("192.168.0.1", allow)).toBe(false);
    expect(isOutboundHostAllowed("172.16.0.1", allow)).toBe(false);
    expect(isOutboundHostAllowed("localhost", allow)).toBe(false);
  });

  it("blocks a host not on the allowlist (default-deny)", () => {
    expect(isOutboundHostAllowed("evil.com", allow)).toBe(false);
    expect(isOutboundHostAllowed("evil.com", [])).toBe(false);
  });
});
