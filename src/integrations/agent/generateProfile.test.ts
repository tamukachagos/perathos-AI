import { describe, expect, it } from "vitest";
import { deriveProfile } from "./generateProfile";

describe("mock AgentProvider — deriveProfile", () => {
  it("extracts a quoted name, industry, location and offer", () => {
    const { profile } = deriveProfile(
      'We run a mobile spa called "Maboneng Mobile Spa" in Johannesburg. We offer massages, facials and nail care.',
    );
    expect(profile.name).toBe("Maboneng Mobile Spa");
    expect(profile.industry).toBe("Beauty & Wellness");
    expect(profile.location).toBe("Johannesburg");
    expect(profile.offer.length).toBeGreaterThan(0);
    expect(profile.services).toContain("massages");
  });

  it("flags low-confidence fields when it cannot extract them", () => {
    const { profile, lowConfidence } = deriveProfile(
      "Just some words about nothing in particular here today.",
    );
    expect(lowConfidence).toContain("location");
    // Fields the owner must supply are left blank for the review step.
    expect(profile.whatsapp).toBe("");
    expect(profile.domain).toBe("");
    expect(profile.email).toBe("");
  });

  it("is deterministic for the same input", () => {
    const a = deriveProfile("A cleaning business in Cape Town offering home cleaning.");
    const b = deriveProfile("A cleaning business in Cape Town offering home cleaning.");
    expect(a.profile).toEqual(b.profile);
    expect(a.profile.industry).toBe("Cleaning Services");
    expect(a.profile.location).toBe("Cape Town");
  });
});
