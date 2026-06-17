import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { DEV_TENANT_ID } from "@/lib/db/seed";

const SEED_SLUG = "maboneng-mobile-spa";
const SEED_BUSINESS_ID = "seed-business-maboneng";

import { NextRequest } from "next/server";

let ip = 0;
function leadRequest(body: unknown): NextRequest {
  // Unique PLATFORM client IP per request (x-real-ip, which Vercel sets and a
  // client cannot spoof) so the per-process rate limiter does not bleed between
  // independent test cases. Raw x-forwarded-for is intentionally NOT trusted.
  ip += 1;
  return new NextRequest("http://localhost/api/leads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-real-ip": `10.0.0.${ip}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads — POPIA consent + persistence", () => {
  beforeEach(() => {
    __resetMemoryStore();
  });

  it("rejects a lead WITHOUT consent and stores nothing", async () => {
    const res = await POST(
      leadRequest({
        slug: SEED_SLUG,
        name: "Sam",
        contact: "sam@example.com",
        consent: false,
      }),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("consent_required");

    const leads = await memoryRepositories.leads.listByBusiness(
      DEV_TENANT_ID,
      SEED_BUSINESS_ID,
    );
    expect(leads).toHaveLength(0);
  });

  it("persists a lead with consent + consentAt + retention + purpose", async () => {
    const res = await POST(
      leadRequest({
        slug: SEED_SLUG,
        name: "Sam",
        contact: "sam@example.com",
        message: "Booking?",
        consent: true,
        marketingOptIn: true,
      }),
    );
    expect(res.status).toBe(201);

    const leads = await memoryRepositories.leads.listByBusiness(
      DEV_TENANT_ID,
      SEED_BUSINESS_ID,
    );
    expect(leads).toHaveLength(1);
    const lead = leads[0];
    expect(lead.consent).toBe(true);
    expect(lead.consentAt).not.toBeNull();
    expect(lead.retentionUntil).not.toBeNull();
    expect(lead.marketingOptIn).toBe(true);
    expect(lead.purpose).toBe("Respond to this enquiry");
  });

  it("rejects when required fields are missing", async () => {
    const res = await POST(
      leadRequest({ slug: SEED_SLUG, name: "", contact: "", consent: true }),
    );
    expect(res.status).toBe(400);
  });

  it("404s for an unknown site slug (cannot write into another tenant)", async () => {
    const res = await POST(
      leadRequest({
        slug: "does-not-exist",
        name: "Sam",
        contact: "sam@example.com",
        consent: true,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("sanitizes free-text fields before storing", async () => {
    await POST(
      leadRequest({
        slug: SEED_SLUG,
        name: "<script>alert(1)</script>Sam",
        contact: "sam@example.com",
        message: '<img src=x onerror="x()">hi',
        consent: true,
      }),
    );
    const leads = await memoryRepositories.leads.listByBusiness(
      DEV_TENANT_ID,
      SEED_BUSINESS_ID,
    );
    expect(leads[0].name).toBe("Sam");
    expect(leads[0].message).toBe("hi");
  });
});
