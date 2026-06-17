# Launch Desk — Target Architecture

> Produced by the architecture team (7 engineers) on 2026-06-17 and ratified by the Engagement Lead.
> Companion: [PROJECT_CHARTER.md](PROJECT_CHARTER.md) · [ROADMAP.md](ROADMAP.md)

## Stack

**Next.js 15 (App Router) + React 19 + TypeScript** on Vercel · **Prisma** on **Vercel Postgres (Neon)** ·
**TanStack Query** for client server-state · **Auth.js v5** magic-link with DB sessions · **Vitest + Playwright + MSW**
for testing · Vercel Node 22 runtime + Edge Middleware.

The existing pure layer is **ported verbatim**, not rewritten: `format.js` → `src/lib/format.ts`, the adapter
`evaluate(business)` readiness contract, and the `LocalBusiness` JSON-LD builder. The Vite hash router, `localStorage`
data layer, and the monolithic `App.jsx` are **replaced**.

## Key decisions

| Decision | Rationale |
|---|---|
| **Next.js App Router over Vite SPA** | Crawlable, server-rendered customer sites (with JSON-LD) and an async webhook/approval lifecycle *are the product* — both impossible on a hash SPA. |
| **Prisma over Drizzle** | Reviewable migration history; mature tooling on Neon. |
| **Adapters split: client readiness plane + server action plane** | Keeps secrets off the browser; the pure `evaluate()` readiness stays client-safe while real actions run server-only. |
| **Per-provider mock / sandbox / live by config** | App runs end-to-end today on mocks; real keys drop in per-provider with **zero UI change**. |
| **One `ActionRouter`, per-verb gating** (not per-adapter flags) | Single chokepoint for every risky action; uniform approval + audit. |
| **Payload-bound single-use HMAC approval tokens** | Token is bound to `verb + payload-hash + idempotency-key`, so an approved action can't be swapped for a different payload. |
| **`tenant_id` + Postgres RLS** | Tenant scoping from the session, with RLS as a backstop that closes IDOR/cross-tenant leakage. |
| **Auth.js v5 magic-link + DB sessions** | Low-friction email auth; DB sessions give instant revocation. |
| **Static / ISR near-zero-JS customer sites** | SA mobile bandwidth is expensive; published sites ship minimal JS, Lighthouse-budget-gated. |

## Topology (Vercel)

- **Customer sites** served static/ISR at `/s/:slug`, CDN-cached. Custom `.co.za` domains map host→slug in **Edge Middleware** via the Vercel Domains API.
- **API + webhooks** as Route Handlers (regions `cdg1`/`fra1`).
- **Secrets per environment**: Preview = mock/sandbox, Production = live. `gitleaks` in CI; secrets only ever read in the server `execute` plane.
- **Cron**: POPIA retention purge; async-operation reconciliation (e.g. `.co.za` registration state).
- **Neon branch previews** per PR.

## Provider-adapter framework

Nine typed adapters — Domain, DNS, Hosting, GitHub, Email, Messaging, Payment, Analytics, Agent — each with:
- a **client readiness plane**: the pure `evaluate(business) → {status, detail}` we already have (no secrets);
- a **server action plane**: real side-effecting verbs, behind the `ActionRouter`.

**Risky verbs** (domain register, DNS write, publish, payment config) flow through `ActionRouter.execute`, which:
1. requires a per-verb **approval** (owner sign-off; step-up where needed),
2. validates a **single-use HMAC token** bound to `verb + payload-hash + idempotency-key`,
3. writes to an **append-only audit log**,
4. for slow vendors, returns `202` + an **`OperationRef`** the client polls; a reconciliation Cron settles final state.

## Frontend

- **Customer sites**: server-rendered template, sanitized user content, JSON-LD, `wa.me` CTA, POPIA consent lead form, versioning + rollback — minimal/zero React island.
- **Dashboard**: code-split React on TanStack Query; onboarding wizard ("from text" via mock Agent first); approval UI.

## Security & compliance

Sanitize all user-generated content **at publish time**; URL-scheme allowlist; **nonce-based CSP**; tenant scoping from
session + **RLS** backstop. POPIA: consent captured + timestamped with each lead, Information Officer gate, `/privacy`
publish-gate + consent banner, retention **purge Cron**, and a **DSAR** workflow. Observability: Sentry + structured
logging (no PII), the audit log, and Lighthouse budgets enforced in CI as part of Definition of Done.
