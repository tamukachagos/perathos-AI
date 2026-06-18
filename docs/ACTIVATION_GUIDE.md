# Launch Desk — Complete Activation Guide

How to take the platform from **mock mode** (fully working today, no keys) to **fully live**. Every variable name here is the exact one the code reads (see [`.env.example`](../.env.example)).

> Companion docs: [GO_LIVE_RUNBOOK.md](GO_LIVE_RUNBOOK.md) (quick 3-step) · [ARCHITECTURE.md](ARCHITECTURE.md) · [ENTERPRISE_REVIEW.md](ENTERPRISE_REVIEW.md).

---

## 0. How activation works (read first)

- **Everything is off by default.** With no env vars set, the app runs end-to-end on mocks. You turn on real services **one at a time** by adding environment variables — no code changes for the "drop-in" group below.
- **Where to set variables:** Vercel → your `perathos-ai` project → **Settings → Environment Variables** (scope: **Production**, and **Preview** if you want previews live too). **Never** put secrets in the repo or in chat.
- **Always redeploy after changing env vars** (Vercel → Deployments → ⋯ → Redeploy, or push any commit). Env changes only take effect on a new deployment.
- **Production fails CLOSED.** In production, any webhook/cron/secret-gated endpoint **rejects** if its secret is missing (this is deliberate, from the Phase 0 hardening). So when you go live you must set the relevant secrets, or those endpoints return 401.
- **Verifying:** the assistant verifies against the **public URL** (`https://perathos-ai.vercel.app`) because the connected Vercel integration can't see this project. After each stage, share the deployment URL and the assistant confirms it live.

### The two activation tiers — know which is which

| Tier | Meaning | Integrations |
|---|---|---|
| **A. Drop-in live** | Setting the key/var makes it **really work** immediately (real code is implemented). | **Postgres, Auth (magic-link), AI (OpenRouter/Anthropic), Paystack billing & payments, Sentry, the cron secrets, pricing/margin tuning** |
| **B. Interface-ready (needs a live adapter build)** | The interface, dormant selection, security controls, metering, UI and approval flow are all built and tested — but the **live vendor call still needs to be coded** behind the existing interface (a contained, per-provider task). Setting the key is step 1 of 2. | **Domain registrars, Google Business Profile, WhatsApp BSP, GitHub App, Vercel deploy API, container/Kubernetes hosting** |

For every Tier-B provider: get the account + sandbox keys, set the vars, then ask the engineering team (me) to implement that one live adapter against the real API — each is ~a single focused workstream behind an interface that already exists, with the security/metering already in place.

---

## 1. Pre-flight — production secrets to set before leaving mock

The moment the app runs in production as a real service (not mock), set these or the corresponding endpoints fail closed:

| Variable | Why | How to generate |
|---|---|---|
| `AUTH_SECRET` | Real Auth.js sessions **and** the approval-token HMAC (the ActionRouter falls back to this). Without it in prod, approvals/sign-in are refused. | `npx auth secret` or `openssl rand -base64 32` |
| `LAUNCH_DESK_APPROVAL_SECRET` *(optional)* | Dedicated HMAC key for approval tokens; falls back to `AUTH_SECRET` if unset. Set a distinct one if you want key separation. | `openssl rand -base64 32` |
| `CRON_SECRET` | Authenticates all Vercel Cron calls (purge, operations, hosting-meter, agent). Vercel sends it automatically. | `openssl rand -hex 32` |
| `DSAR_SECRET` *(optional)* | Bearer for the DSAR endpoint; falls back to `CRON_SECRET`. | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Your live URL (e.g. `https://perathos-ai.vercel.app` or a custom domain) for callbacks + absolute links. | n/a |

You do **not** set `LAUNCH_DESK_ADAPTER_MODE` to anything yet — leave it `mock`; each provider flips itself to live when its own key is present.

---

## 2. Activation sequence — Tier A (drop-in live)

Do these in order; each is independently valuable.

### Stage 1 — Postgres (real persistence) ✅ drop-in
- **Account:** Vercel → **Storage → Create Database → Postgres** (Neon, free Hobby tier). Click **Connect** to the `perathos-ai` project.
- **Vars:** `DATABASE_URL` is injected automatically by Vercel.
- **What happens:** the next deploy runs `prisma migrate deploy` (via `npm run vercel-build`) and the app switches from in-memory to Postgres — zero code change.
- **Verify:** publish a site, redeploy, confirm it persists (it wouldn't have before).

### Stage 2 — Auth (real magic-link sign-in) ✅ drop-in
- **Account:** any SMTP provider (e.g. Postmark, Resend SMTP, SES, Zoho).
- **Vars:** `AUTH_SECRET` (from §1), `EMAIL_SERVER="smtp://user:pass@host:587"`, `EMAIL_FROM="Launch Desk <no-reply@yourdomain>"`, `NEXT_PUBLIC_APP_URL`.
- **Verify:** sign in at `/sign-in`, receive the magic-link email, land authenticated; the local draft migrates into the account.
- **Note:** without `EMAIL_SERVER` the dev/mock auth path is used — fine for testing, not for production users.

### Stage 3 — AI generation (real Claude / OpenRouter) ✅ drop-in
- **Account (recommended):** OpenRouter (one billing relationship for cheap OSS **and** premium models). Or Anthropic directly.
- **Vars:** `OPENROUTER_API_KEY` **(preferred)** *or* `ANTHROPIC_API_KEY`. Optional tuning: `LLM_MODEL_CHEAP/CODE/PREMIUM/IMAGE`, `LLM_FX_ZAR_PER_USD` (default 18.5).
- **What happens:** the onboarding wizard's profile generation (and all future agent LLM work) routes through the real model, **metered into the wallet** at the per-tier markup. On any API error it falls back to the mock.
- **Verify:** "Describe your business" in the dashboard produces genuinely tailored copy; the `/credits` balance moves.
- **Cost lever:** caching means a repeated identical call debits nothing; cheap OSS handles extraction/copy, premium only the hard calls.

### Stage 4 — Payments + subscription billing (Paystack) ✅ drop-in
- **Account:** Paystack (start with **test** keys). Create two recurring **Plans** in ZAR (Growth, Pro) and copy their `PLN_...` codes.
- **Vars:** `PAYSTACK_SECRET_KEY` (`sk_test_…` first), `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_PLAN_GROWTH`, `PAYSTACK_PLAN_PRO`.
- **Webhook:** Paystack dashboard → Webhooks → `https://<your-domain>/api/webhooks/paystack` (HMAC-SHA512 verification activates automatically with the key).
- **Verify:** upgrade at `/pricing` with Paystack **test cards** → webhook marks the subscription active → paid entitlements unlock; a credit top-up adds wallet balance.
- **Go production:** swap `sk_test_…` → `sk_live_…` once the test flow is confirmed; complete a payout bank account in Paystack.

### Stage 5 — Observability (Sentry) ✅ drop-in
- **Vars:** `SENTRY_DSN`. Unset = no-op (the PII-safe structured logger runs regardless).

---

## 3. Activation sequence — Tier B (set keys, then build the live adapter)

For each of these: create the account, set the vars, then have me implement the one live adapter behind the existing interface. The dormant wiring, security controls, metering, UI, and approval flow are already built and CI-tested.

### Stage 6 — GitHub + Vercel per-customer (the deploy substrate)
- **GitHub App:** create an operator-owned GitHub App (repo + contents + pull-requests perms) installed on an org (default `launchdesk-sites`). Vars: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_ORG`, `GITHUB_WEBHOOK_SECRET`. Webhook → `/api/webhooks/github`.
- **Vercel API:** `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_PREFIX`, `VERCEL_WEBHOOK_SECRET`. Deploy webhook → `/api/webhooks/vercel`.
- **Live-adapter build:** real GitHub App repo/commit/PR calls + real Vercel project/deploy-hook calls behind `GitHubProvider`/`HostingProvider`. *Do this stage early — Phases below build on per-customer repos.*

### Stage 7 — Domains (.com + .co.za)
- **Accounts:** a ZACR-accredited SA registrar for `.co.za` (Domains.co.za / Diamatrix) **and** an international gTLD reseller for `.com` (Namecheap / Gandi / OpenSRS / Cloudflare).
- **Vars:** `REGISTRAR_ZA_API_KEY/URL`, `REGISTRAR_GTLD_API_KEY/URL`, `DOMAIN_AUTHCODE_KEY` (`openssl rand -hex 32`). Optional pricing: `LD_DOMAIN_ZA_PRICE_CENTS` etc.
- **Live-adapter build:** real EPP/auth-info (ZACR) + reseller REST calls behind `RegistrarBackend`, with `isOutboundHostAllowed` enforced and a registrar webhook to settle transfers.

### Stage 8 — Google Business Profile
- **Account:** Google Cloud project + Business Profile API access (OAuth). Vars: `GOOGLE_GBP_CLIENT_ID`, `GOOGLE_GBP_CLIENT_SECRET`, `GOOGLE_GBP_REFRESH_TOKEN`, `GOOGLE_GBP_ACCOUNT_ID`.
- **Live-adapter build:** real create/verify/patch behind `LocalListingProvider`; settle the listing op from a Google verification callback.

### Stage 9 — WhatsApp commerce (Meta BSP)
- **Account:** a BSP — Clickatell (Cape Town), 360dialog, or Twilio — plus a Meta WhatsApp Business Account. Vars: `WHATSAPP_BSP_PROVIDER`, `WHATSAPP_BSP_API_KEY`, `WHATSAPP_BSP_API_URL`, `WHATSAPP_BSP_PHONE_NUMBER_ID`, `WHATSAPP_BSP_WEBHOOK_SECRET`. Optional cost overrides: `LD_WA_COST_*`, `LD_MARKUP_WHATSAPP`.
- **Live-adapter build:** real send + catalog upload behind `MessagingProvider`, swap the mock payment URL for Paystack hosted checkout, add the delivery/status webhook. (`wa.me` click-to-chat is already live and needs none of this.)

### Stage 10 — Managed hosting (containers + K8s)
- **Accounts:** Fly.io / Railway / Hetzner for containers; operator-owned GKE/EKS/AKS clusters per region for K8s. Vars: `FLY_API_TOKEN`, `RAILWAY_API_TOKEN`, `HETZNER_API_TOKEN`, `K8S_OPERATOR_KUBECONFIG`, `HOSTING_OUTBOUND_ALLOWLIST` (comma-separated allowed hosts). Optional pricing: `LD_HOSTING_*`.
- **Live-adapter build:** real provisioning behind `HostingTierBackend` — apply the catalog-rendered manifest (namespace, scoped SA, default-deny egress NetworkPolicy, PodSecurity restricted, ResourceQuota/LimitRange), enforce `isOutboundHostAllowed` on every call, swap the queue driver to QStash/Inngest, wire a real cpu/storage metering source. **Highest-risk stage — do the W9 security pass (below) alongside it.**

---

## 4. Webhooks to register (once their keys are set)

| Provider | URL | Signing secret | Status |
|---|---|---|---|
| Paystack | `/api/webhooks/paystack` | `PAYSTACK_SECRET_KEY` (HMAC-SHA512) | live code ✅ |
| Vercel | `/api/webhooks/vercel` | `VERCEL_WEBHOOK_SECRET` (HMAC-SHA1) | live code ✅ (settles deploys) |
| GitHub App | `/api/webhooks/github` | `GITHUB_WEBHOOK_SECRET` (HMAC-SHA256) | fail-closed stub — `workflow_run` → agent team needs the live wiring |

All three **fail closed in production** without their secret.

## 5. Cron jobs (already scheduled in `vercel.json`)

| Path | Schedule | Purpose | Needs |
|---|---|---|---|
| `/api/cron/purge` | daily 03:00 | POPIA lead retention purge | `CRON_SECRET` |
| `/api/cron/operations` | every 5 min | settle async ops (domains, deploys, provisioning queue) | `CRON_SECRET` |
| `/api/cron/hosting-meter` | hourly | meter cpu/storage usage to wallets | `CRON_SECRET` |

> The agent-team backstop cron `/api/cron/agent` exists but is **not** scheduled in `vercel.json` — add it to the `crons` array when you enable the autonomous agent team (otherwise agent jobs run inline on trigger/owner action only).

## 6. Pricing & margin tuning (optional, no deploy logic — just numbers)

All ZAR, env-overridable: `LD_MARGIN_CHEAP/CODE/IMAGE/PREMIUM` (LLM markups), `LD_MARKUP_HOSTING` (1.5×), `LD_MARKUP_DOMAIN` (1.6×), `LD_MARKUP_WHATSAPP` (2.0×), and the `LD_*_PRICE_CENTS`/`LD_*_COST_CENTS` catalogs for domains and hosting. Re-price credit packs/plans quarterly as FX and vendor rates move.

## 7. Before enabling the autonomous agent team in production — W9 hardening

The agent team is built, gated, and safe by design (PR-only, can't self-approve, spend-capped, kill-switch). Two items are deliberately deferred to **W9** and should be done **before** real autonomous execution:
- **Real step-up auth** on the owner approval endpoint (replace the mock confirm-boolean with WebAuthn / re-magic-link).
- **SAST + secret-scanning + dependency-review** as required checks on agent-authored PRs, and the sandboxed ephemeral worker (read-only checkout, egress allowlist, no secrets mounted).

These are a focused build pass — flag me when you're ready and I'll do W9.

## 8. Recommended order (smoothest path to a first real customer)

1. **Pre-flight secrets** (§1) → 2. **Postgres** → 3. **Auth** → 4. **AI** → 5. **Paystack** (the four "drop-in" wins; you now have a live, paying, AI-building product).
6. **GitHub+Vercel** live adapter → 7. **Domains** → 8. **GBP** → 9. **WhatsApp** → 10. **Managed hosting** (+ **W9** hardening) — the Tier-B build-and-activate stages, in dependency order.
11. Add a **custom production domain** to the Vercel project; tag a release.

At each step the platform stays fully usable on mocks for everything you haven't turned on yet — there's no "big bang."
