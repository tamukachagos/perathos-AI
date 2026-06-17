# Launch Desk — Go-Live Runbook

How to take the deployed app from **mock mode** to a **fully real, revenue-capable** product. Each step is
independent and safe to do in any order, but the recommended order is **Postgres → Anthropic → Paystack** (smallest
blast radius first). Everything is already built and tested; these steps only add environment variables.

- **Live app:** https://perathos-ai.vercel.app
- **Vercel project:** `perathos-ai` (team `tamukachagos-projects`)
- **Repo:** https://github.com/tamukachagos/perathos-AI (every push to `main` auto-deploys)

> **Security:** add all keys as **Vercel → Project → Settings → Environment Variables** (Production scope). Never paste
> secrets into chat or commit them. After adding a variable, **redeploy** (Vercel → Deployments → ⋯ → Redeploy, or push
> any commit) so it takes effect.
>
> **How verification works:** the Vercel integration connected to the assistant can't see this project, so the
> assistant verifies against the **public URL** (page loads, generated content, test transactions) rather than the
> Vercel dashboard. Share the deployment URL after each redeploy.

---

## Step 1 — Postgres (real persistence)

Today published sites and leads live in an in-memory store and reset on each redeploy. This makes them permanent.

1. Vercel → `perathos-ai` → **Storage** → **Create Database** → **Postgres** (Neon, free Hobby tier).
2. **Connect** it to the `perathos-ai` project (Production). Vercel injects `DATABASE_URL` automatically.
3. **Redeploy.** On build, `npm run vercel-build` runs `prisma migrate deploy`, which applies the schema (it safely
   no-ops when there's no real DB, so this is the moment it actually runs).

**Verify:** publish a site in the dashboard, then redeploy — it should still be there (it would have vanished before).
The assistant will confirm migrations applied and a published record persists across a deploy.

**Rollback:** disconnect the database; the app falls back to in-memory mode (no code change).

---

## Step 2 — Anthropic key (real AI generation)

Flips the onboarding "describe your business" wizard from the mock heuristic to genuine Claude-authored content.

1. Get a key from the Anthropic Console (`sk-ant-...`).
2. Vercel env vars → add **`ANTHROPIC_API_KEY`** = your key. (Optional **`ANTHROPIC_MODEL`** — defaults to
   `claude-sonnet-4-6`; other valid ids: `claude-opus-4-8`, `claude-haiku-4-5-20251001`.)
3. **Redeploy.**

**Verify:** in the dashboard, use "Describe your business" with a free-text prompt — the generated profile should be
genuinely tailored (not the templated mock). On any API error it automatically falls back to the mock, so the wizard
never breaks.

**Cost note:** generation is one short Messages API call per use (`max_tokens` 1024). Set usage limits in the Anthropic
Console if desired.

---

## Step 3 — Paystack (real ZAR payments + live billing)

Turns on subscription charging for the Free/Growth/Pro plans.

1. In the **Paystack dashboard**, create two recurring **Plans** priced in ZAR (Growth and Pro) and copy their **plan
   codes** (`PLN_...`).
2. Vercel env vars → add:
   - **`PAYSTACK_SECRET_KEY`** (use a **test** `sk_test_...` key first)
   - **`PAYSTACK_PLAN_GROWTH`** = the Growth plan code
   - **`PAYSTACK_PLAN_PRO`** = the Pro plan code
3. **Paystack → Settings → Webhooks**, set the URL to `https://<your-domain>/api/webhooks/paystack`. HMAC-SHA512
   verification activates automatically once the secret key is present.
4. **Redeploy.**

**Verify:** go to `/pricing` → upgrade to Growth → complete checkout on **Paystack test cards** → the webhook marks the
subscription active and the paid entitlements unlock (custom domain, "Powered by Launch Desk" badge removed). The
assistant can walk the test-card flow and confirm the subscription state.

**Go to production:** swap the test key for the live `sk_live_...` key once you've confirmed the test flow.

---

## After the three inputs: remaining vendor adapters (M4)

Same pattern — each is coded behind an interface and activates with the relevant credentials. Tackle as you obtain each
provider's account:

| Provider | Adds | Needs |
|---|---|---|
| domains.co.za | Real `.co.za` registration + DNS | API credentials |
| Email (Zoho/Google) | Mailbox provisioning, SPF/DKIM/DMARC | Provider API + domain |
| Hosting (Vercel API) | Deploy customer sites to custom domains | Vercel token + Domains API |
| GitHub App | Real per-customer version history | GitHub App credentials |
| Analytics (PostHog/GA4) | Real visit/lead/payment analytics | Project keys |
| WhatsApp Business API (BSP) | Automated messaging beyond click-to-chat | BSP account (Clickatell/360dialog/Twilio) |

`wa.me` click-to-chat is already real on every published site, so WhatsApp works on day one without the API.

---

## Pre-launch checklist (beyond integrations)

- [ ] Custom production domain on the app (e.g. `launchdesk.africa`) + SSL
- [ ] `AUTH_SECRET` set (real magic-link sessions) + an email provider for sign-in
- [ ] `CRON_SECRET` set (authenticates the POPIA retention-purge cron)
- [ ] `SENTRY_DSN` set (error monitoring) — optional
- [ ] POPIA: register the Information Officer; finalise the `/privacy` policy content and Terms of Service
- [ ] Confirm Paystack live keys + payout bank account
