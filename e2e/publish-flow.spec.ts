import { test, expect } from "@playwright/test";

// Golden-path E2E (M5): onboarding (describe -> profile) -> publish -> open the
// published /s/[slug] and assert the business renders with LocalBusiness JSON-LD,
// the wa.me CTA, and the consent-gated lead form.
//
// Runs entirely in MOCK mode (no DATABASE_URL, no secrets). The wizard's "Use an
// example" seeds the Maboneng description; the mock Agent leaves contact fields
// blank by design (the owner supplies them), so the dashboard profile step sets
// a clean name + WhatsApp before publishing. The resulting slug
// (maboneng-mobile-spa) is also the seeded server-rendered site, so the page is
// server-rendered with JSON-LD in the initial HTML.

const SEED_SLUG = "maboneng-mobile-spa";

test("onboarding -> publish -> live site with JSON-LD, wa.me CTA, consent form", async ({
  page,
}) => {
  // 1) Onboarding: describe the business in plain language.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Launch Desk", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Describe your business" }).click();
  const wizard = page.getByRole("dialog", { name: "Onboarding wizard" });
  await expect(wizard).toBeVisible();

  // Use the built-in example, then generate a structured profile (mock Agent).
  await wizard.getByRole("button", { name: "Use an example" }).click();
  await wizard.getByRole("button", { name: /Generate profile/ }).click();

  // 2) Review phase: the generated profile is shown for review; apply it.
  await expect(wizard.getByLabel("Business name")).toHaveValue(
    /Maboneng Mobile Spa/,
  );
  await wizard.getByRole("button", { name: "Apply to dashboard" }).click();
  await expect(wizard).toBeHidden();

  // 2b) Refine on the dashboard: set a clean name + the WhatsApp number the
  // mock Agent leaves blank (it never invents contact details).
  await page.locator("#bp-name").fill("Maboneng Mobile Spa");
  await page.locator("#bp-whatsapp").fill("+27 82 555 0198");

  // 3) Publish the draft. Anonymous publish routes to /s/<slug>.
  await page.getByRole("button", { name: /Publish (draft|update)/ }).click();
  await page.waitForURL(`**/s/${SEED_SLUG}`);

  // 4) The published site renders the business.
  await expect(
    page.getByRole("heading", { name: "Maboneng Mobile Spa", level: 1 }),
  ).toBeVisible();

  // LocalBusiness JSON-LD is emitted server-side.
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .first()
    .textContent();
  expect(jsonLd).toBeTruthy();
  const schema = JSON.parse(jsonLd as string);
  expect(schema["@type"]).toBe("LocalBusiness");
  expect(schema.name).toBe("Maboneng Mobile Spa");
  expect(schema.address.addressCountry).toBe("ZA");

  // wa.me CTA is present and points at the WhatsApp deep link.
  const waCta = page.getByRole("link", { name: "WhatsApp us" });
  await expect(waCta).toBeVisible();
  await expect(waCta).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+/);

  // POPIA consent banner is present; dismiss it ("Essential only") so it cannot
  // overlay the lead form, then exercise the form.
  const banner = page.getByRole("dialog", { name: "Privacy consent" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Essential only" }).click();
  await expect(banner).toBeHidden();

  // The consent-gated lead form: submit is disabled until consent is ticked.
  const submit = page.getByRole("button", { name: /Send enquiry/ });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Your name").fill("Test Visitor");
  await page.getByLabel("Phone or email").fill("visitor@example.com");
  // Still disabled without consent.
  await expect(submit).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I consent to .* contacting me/ })
    .check();
  await expect(submit).toBeEnabled();

  // Submitting persists the lead (mock repo) and shows the thank-you state.
  await submit.click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
});
