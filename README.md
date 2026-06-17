# Launch Desk

**Launch Desk** is a South Africa-first platform that takes a non-technical business owner from a plain-language
description to a genuinely live, POPIA-compliant online presence — a fast website on a `.co.za` domain, able to take
**ZAR** payments, discoverable on Google, and reachable on WhatsApp — with every risky action gated behind the owner's
approval.

- AI-generated business profile and website content
- Website preview and publish workflow (server-rendered, versioned, with rollback)
- Domain, DNS, email, WhatsApp, payments, GitHub, analytics, and AI-update readiness — as swappable provider adapters
- Approval-first agent actions for risky operations (single chokepoint, signed approval tokens, audit log)
- POPIA-by-default: consent-aware lead capture, retention purge, DSAR, Information Officer + privacy policy
- Subscription billing (Free / Growth / Pro) with plan-gated features

> This started as a Vite front-end prototype and has since been built into a production-architecture application.
> See [`docs/`](docs/) for the full picture: [Charter](docs/PROJECT_CHARTER.md) ·
> [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Definition of Done](docs/DEFINITION_OF_DONE.md).

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** (strict)
- **Prisma** on **Postgres** (Vercel Postgres / Neon) with tenant `tenant_id` + Postgres **RLS**
- **Auth.js v5** (magic-link) with a dev/mock auth path for local use
- **Vitest** (unit) · **Playwright** (golden-path E2E) · **Lighthouse** budgets — all in CI
- Hosted on **Vercel**

## Runs with no configuration (mock mode)

The app is designed to build and run with **no database and no secrets**. In that "mock mode" it uses an in-memory
data store and mock provider adapters, so the entire journey works end-to-end for local development and previews. Real
services activate purely by setting environment variables — **no code changes**.

```bash
npm install
npm run dev        # http://localhost:3000

npm run build      # production build (no DB/secrets required)
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests
npm run e2e        # Playwright golden-path E2E (builds + serves the app)
```

## Key routes

| Route | What it is |
|---|---|
| `/` | The Launch Desk dashboard (profile, live preview, launch checklist, analytics, AI updates) |
| `/s/[slug]` | A published customer site — server-rendered, with `LocalBusiness` JSON-LD, `wa.me` CTA, and a POPIA consent lead form |
| `/pricing` · `/billing` | Subscription plans and account billing |
| `/sign-in` | Magic-link sign-in (dev path in mock mode) |
| `/privacy` | Auto-generated POPIA privacy policy + Information Officer |
| `/api/*` | Auth, leads, approvals, operations, agent, webhooks, cron (purge), DSAR |

## Architecture (summary)

- **Provider-adapter framework** — nine adapters (`DomainProvider`, `DnsProvider`, `HostingProvider`, `GitHubProvider`,
  `EmailProvider`, `MessagingProvider`, `PaymentProvider`, `AnalyticsProvider`, `AgentProvider`), each split into a pure
  **client readiness plane** and a server **action plane**, selected **mock → sandbox → live** per provider by config.
- **Approval-first ActionRouter** — every risky verb (domain register, DNS write, publish, payment config) runs through
  one server-side chokepoint that requires a single-use, payload-bound HMAC approval token and writes an append-only
  **audit log** on allow *and* deny. Slow vendor operations return an `OperationRef` that is polled and reconciled.
- **Multi-tenant** — tenant-scoped access in the app layer with Postgres RLS as a backstop.
- **SA-first** — `wa.me` click-to-chat, `.co.za` async domain ops, ZAR pricing, POPIA tooling, low-bandwidth sites.

## Environment variables

All optional in mock mode; set them to activate real services (e.g. on Vercel):

| Variable | Activates |
|---|---|
| `DATABASE_URL` | Real Postgres persistence (Prisma). Migrations apply on deploy via `npm run vercel-build`. |
| `AUTH_SECRET` | Real Auth.js sessions (magic-link) |
| `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) | Real AI content generation via Claude (`AgentProvider`) |
| `PAYSTACK_SECRET_KEY` (+ `PAYSTACK_PLAN_GROWTH`, `PAYSTACK_PLAN_PRO`) | Real ZAR payments + subscription billing |
| `CRON_SECRET` | Authenticates the POPIA retention-purge cron |
| `SENTRY_DSN` | Error monitoring (no-op when unset) |

See [`.env.example`](.env.example) for the full list.

## Deployment

Deployed on **Vercel** from this repository; every push to `main` auto-deploys. Connecting a Vercel Postgres store
injects `DATABASE_URL`, and `npm run vercel-build` runs `prisma migrate deploy` automatically (it safely no-ops when no
real database URL is present).

## Build status

Foundation, persistence + identity, publish pipeline, approval-gated actions, POPIA/observability/E2E, and subscription
billing are built and verified in CI (lint, typecheck, unit tests, build, Playwright E2E, Lighthouse budgets). Real
vendor integrations (Paystack, domains.co.za, email, hosting, GitHub, analytics) and real AI generation are implemented
behind their environment flags and activate when keys are provided.
