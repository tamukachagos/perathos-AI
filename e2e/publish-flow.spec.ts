import { test, expect } from "@playwright/test";

// Golden-path E2E: drive the Launch Studio workspace (set profile -> publish via
// the Preview pane) -> open the published /s/[slug] and assert the business
// renders with LocalBusiness JSON-LD, the wa.me CTA, and the consent-gated lead
// form. Runs entirely in MOCK mode (no DATABASE_URL, no secrets). The default
// anonymous draft is the Maboneng sample; the seeded slug (maboneng-mobile-spa)
// is also the server-rendered site, so JSON-LD is present in the initial HTML.

const SEED_SLUG = "maboneng-mobile-spa";

test("studio -> publish -> live site with JSON-LD, wa.me CTA, consent form", async ({
  page,
}) => {
  // 1) Launch Studio loads at / (the conversational workspace).
  await page.goto("/");
  const rail = page.locator(".studio-menu");
  await expect(page.getByRole("tab", { name: "Assistant" })).toBeVisible();

  // 2) Set the profile in the Profile section (reuses the existing form). The
  // default anonymous draft is already Maboneng; we set name + WhatsApp explicitly.
  await rail.getByRole("button", { name: "Profile" }).click();
  await page.locator("#bp-name").fill("Maboneng Mobile Spa");
  await page.locator("#bp-whatsapp").fill("+27 82 555 0198");

  // 3) Publish from the Preview pane (left-menu "Preview" opens the workspace
  // Preview tab + the publish button).
  await rail.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Publish site|Update site/ }).first().click();

  // 4) Open the published site directly and assert it renders the business.
  await page.goto(`/s/${SEED_SLUG}`);
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
  await expect(submit).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /I consent to .* contacting me/ })
    .check();
  await expect(submit).toBeEnabled();

  // Submitting persists the lead (mock repo) and shows the thank-you state.
  await submit.click();
  await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
});
