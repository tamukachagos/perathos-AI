import { describe, expect, it } from "vitest";
import { scrubFields } from "./logger";

describe("logger.scrubFields — PII-safety", () => {
  it("redacts PII-ish keys regardless of value", () => {
    const out = scrubFields({
      email: "sam@example.com",
      phone: "+27 82 555 0198",
      name: "Sam Nkosi",
      message: "please call me",
      contact: "sam@example.com",
    });
    expect(out.email).toBe("[redacted]");
    expect(out.phone).toBe("[redacted]");
    expect(out.name).toBe("[redacted]");
    expect(out.message).toBe("[redacted]");
    expect(out.contact).toBe("[redacted]");
  });

  it("masks PII-ish VALUES even under a safe key", () => {
    const out = scrubFields({ note: "reach me at sam@example.com" });
    expect(out.note).toBe("[redacted-email]");
    const out2 = scrubFields({ ref: "0825550198 call back" });
    expect(out2.ref).toBe("[redacted-number]");
  });

  it("does NOT mask ISO timestamps as phone numbers", () => {
    const out = scrubFields({ asOf: "2026-06-17T18:12:34.355Z" });
    expect(out.asOf).toBe("2026-06-17T18:12:34.355Z");
  });

  it("keeps safe operational keys", () => {
    const out = scrubFields({
      tenantId: "dev-tenant",
      leadId: "lead_1",
      interfaceName: "domain",
      marketingOptIn: true,
      count: 3,
    });
    expect(out.tenantId).toBe("dev-tenant");
    expect(out.leadId).toBe("lead_1");
    expect(out.interfaceName).toBe("domain");
    expect(out.marketingOptIn).toBe(true);
    expect(out.count).toBe(3);
  });

  it("scrubs nested objects and arrays", () => {
    const out = scrubFields({
      payload: { email: "a@b.co", slug: "shop" },
      list: ["x@y.co", "plain"],
    });
    expect((out.payload as Record<string, unknown>).email).toBe("[redacted]");
    expect((out.payload as Record<string, unknown>).slug).toBe("shop");
    expect((out.list as unknown[])[0]).toBe("[redacted-email]");
    expect((out.list as unknown[])[1]).toBe("plain");
  });
});
