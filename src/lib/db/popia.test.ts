import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "./memory";
import { DEV_TENANT_ID } from "./seed";

// POPIA retention purge + DSAR against the in-memory repository (mock mode).
const BIZ = "seed-business-maboneng";

async function seedLead(contact: string, retentionUntil: string | null) {
  return memoryRepositories.leads.create(DEV_TENANT_ID, {
    businessId: BIZ,
    name: "Visitor",
    contact,
    consent: true,
    retentionUntil,
  });
}

describe("LeadRepository — retention purge", () => {
  beforeEach(() => __resetMemoryStore());

  it("deletes only leads past their retention date", async () => {
    await seedLead("a@example.com", "2020-01-01T00:00:00.000Z"); // expired
    await seedLead("b@example.com", "2999-01-01T00:00:00.000Z"); // future
    await seedLead("c@example.com", null); // no expiry -> kept

    const deleted = await memoryRepositories.leads.purgeExpired(new Date());
    expect(deleted).toBe(1);

    const remaining = await memoryRepositories.leads.listByBusiness(
      DEV_TENANT_ID,
      BIZ,
    );
    expect(remaining.map((l) => l.contact).sort()).toEqual([
      "b@example.com",
      "c@example.com",
    ]);
  });
});

describe("LeadRepository — DSAR (find + delete by contact)", () => {
  beforeEach(() => __resetMemoryStore());

  it("finds all records for a contact, case-insensitively", async () => {
    await seedLead("Sam@Example.com", "2999-01-01T00:00:00.000Z");
    await seedLead("sam@example.com", "2999-01-01T00:00:00.000Z");
    await seedLead("other@example.com", "2999-01-01T00:00:00.000Z");

    const found = await memoryRepositories.leads.findByContact("sam@example.com");
    expect(found).toHaveLength(2);
  });

  it("deletes all records for a contact and returns the count", async () => {
    await seedLead("sam@example.com", "2999-01-01T00:00:00.000Z");
    await seedLead("sam@example.com", "2999-01-01T00:00:00.000Z");
    await seedLead("keep@example.com", "2999-01-01T00:00:00.000Z");

    const deleted = await memoryRepositories.leads.deleteByContact(
      "SAM@example.com",
    );
    expect(deleted).toBe(2);

    const remaining = await memoryRepositories.leads.listByBusiness(
      DEV_TENANT_ID,
      BIZ,
    );
    expect(remaining.map((l) => l.contact)).toEqual(["keep@example.com"]);
  });
});
