# Launch Desk — Delivery Roadmap

> Companion: [PROJECT_CHARTER.md](PROJECT_CHARTER.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
> Milestones are strictly ordered; each milestone's workstreams have disjoint file boundaries so engineers
> build in parallel isolated worktrees. The Engagement Lead integrates and verifies between milestones.

## Team roster

| Codename | Role | Owns |
|---|---|---|
| **Sipho** | TPM / Principal Architect | Architecture, sequencing, **shared contracts (lands first)**, merges. |
| **Thabo** | Staff Backend / Platform | Next.js topology, Route Handlers, webhooks, Edge, SSG/ISR publish, Cron. |
| **Lerato** | Staff Data | Prisma schema, migrations, repositories, RLS, versioning, POPIA purge. |
| **Naledi** | Staff Integrations | Adapter registry, nine provider modules, `ActionRouter` + tokens + audit sink. |
| **Anele** | Staff Security / Identity | Auth.js, `requireTenant`, RLS, secrets lint, sanitization, CSP, POPIA consent. |
| **Mandla** | Staff Frontend | Dashboard decomposition, UI primitives, TanStack Query, wizard, approval UI, site template. |
| **Zinhle** | Staff QA / DevEx | Tests, CI, gitleaks, Sentry, Lighthouse budgets, Definition of Done. |

## Milestones

### M0 — Foundation: skeleton, TS, contracts, CI · _owner: Sipho_
**Goal:** Deployable Next.js + TS app on Vercel; pure-layer ported; shared type/env/OpenAPI contracts; CI gate;
nine **mock** adapters; UI primitives. _Sipho lands shared contracts first so downstream tracks import, not edit, them._
Key boundaries: `src/lib/types.ts`, `src/lib/format.ts`, `src/integrations/core/registry.ts`, `.github/workflows/ci.yml`.

### M1 — Persistence, identity, isolation · _owner: Lerato_ · depends: M0
**Goal:** Postgres replaces localStorage; magic-link auth; tenant-scoped access + RLS; the local draft migrates to the
account on sign-in. Key boundaries: `prisma/schema.prisma`, `src/lib/authz.ts`.

### M2 — Publish pipeline & live sites · _owner: Thabo_ · depends: M1
**Goal:** Live, crawlable `/s/:slug` with sanitized user content, JSON-LD, `wa.me` CTA, POPIA consent lead form,
versioning + rollback. Key boundaries: `src/app/s/[slug]/page.tsx`, `src/app/api/leads/route.ts`.

### M3 — Approval-gated actions & async ops · _owner: Naledi_ · depends: M2
**Goal:** Risky actions via one `ActionRouter` with payload-bound tokens + audit; async vendor ops via `OperationRef`
polling; onboarding wizard ("from text" via mock Agent). Key boundaries: `src/integrations/core/actionRouter.ts`,
`src/app/api/approvals/route.ts`.

### M4 — Real vendor integrations · _owner: Naledi_ · depends: M3
**Goal:** Swap mocks for real adapters behind the unchanged interface — Paystack, Vercel, Cloudflare, domains.co.za,
Zoho, GitHub, PostHog/GA4, Claude, Meta BSP — with signature-verified webhooks + reconciliation Cron. _Gated on your
real/sandbox keys._ Key boundaries: `src/integrations/*/real.ts`, `src/app/api/webhooks/*`.

### M5 — POPIA, observability, hardening & launch · _owner: Zinhle_ · depends: M4
**Goal:** POPIA purge + DSAR + Information Officer; Sentry + logging; Playwright golden-path E2E (onboarding → live);
Lighthouse budgets; Definition of Done green. Key boundaries: `src/app/api/cron/purge/route.ts`, `e2e/publish-flow.spec.ts`.

## Top risks

| Risk | Mitigation |
|---|---|
| Migration becomes a stalled rewrite | M0 skeleton + **verbatim** pure-layer ports; milestones ship in mock mode; prototype kept until the replacement is green. |
| Stored XSS / cross-tenant leakage | Sanitize at publish + scheme allowlist + nonce CSP; `tenant_id` from session + RLS backstop. |
| Async `.co.za`/KYC + secret leakage | `OperationRef` + `202` + reconciliation Cron + `Idempotency-Key`; secrets only in server `execute`; gitleaks. |
| Approval bypass / site bloat / POPIA gaps | `ActionRouter` payload-bound HMAC + step-up; static/ISR zero-React island; consent-with-lead, Info Officer gate, purge + DSAR. |
