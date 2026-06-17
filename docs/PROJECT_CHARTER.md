# Launch Desk — Project Charter

> Status: **Active** · Last updated: 2026-06-17 · Repo: github.com/tamukachagos/perathos-AI

## 1. Vision

Be the product that takes a non-technical **South African** small-business owner from a plain-language
description to a business that is **genuinely live** — a fast website on a `.co.za` domain, able to take **ZAR**
payments, discoverable on Google, and reachable on WhatsApp — with every risky action gated behind the owner's
approval. The trusted "get your SA business online" slot has been vacant since Google's Woza Online closed in 2015.
Launch Desk fills it.

## 2. Goals (this engagement)

1. Turn the working front-end prototype into a **production application** that actually works end-to-end.
2. Stand up a real backend, data layer, authentication, and the **provider-adapter framework** for real (not simulated).
3. Ship it **hosted on Vercel** with a live URL, CI/CD, tests, and observability.
4. Be **POPIA-compliant by default** and honest in all claims (evidence, never guarantees).

## 3. Scope

**In scope:** monorepo + Vercel hosting; Postgres data model; auth + multi-tenancy; provider-adapter interfaces with
sandbox/mock implementations (Domain, DNS, Hosting, GitHub, Email, Messaging, Payment, Analytics, Agent); publish
pipeline; POPIA tooling; TypeScript migration; tests + CI/CD; deploy + verification.

**Out of scope (this phase):** live paid vendor accounts. Adapters ship in sandbox/mock mode; **real keys
(Paystack, domains.co.za, Meta/WhatsApp BSP, Zoho/Google, Cloudflare, GitHub App, PostHog/GA4) drop in later behind
the same interface with no UI changes.** Native WhatsApp Business API (click-to-chat first). Multilingual generation.

## 4. Key Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Host on Vercel** | Already connected via integration; app was designed around a Vercel adapter; fastest path to a live URL + serverless API + managed Postgres. |
| D2 | **Sandbox/mock adapters now, real keys later** | The whole product works end-to-end today without blocking on paid vendor accounts; production interfaces mean zero rework when keys arrive. |
| D3 | **SA-first product constraints** | ZAR payments (Paystack first), `.co.za` async domain ops, WhatsApp click-to-chat, POPIA by default, low-bandwidth/mobile-first output. |
| D4 | Frontend/runtime topology | **Deferred to the architecture team** (Next.js vs Vite-SPA + Vercel functions) — TPM makes the call in the synthesis. |

## 5. Team & Roles

| Role | Responsibility |
|------|----------------|
| **Engagement Lead / Principal Architect** (Claude, me) | Direction, integration of all workstreams, verification, deploy, reporting to stakeholder. |
| **Technical Program Manager (TPM)** | Roadmap, work breakdown, sequencing, conflict resolution. |
| **Staff Backend / Platform Engineer** | Vercel topology, API, publish pipeline, secrets/config. |
| **Staff Data Engineer** | Postgres schema, migrations, multi-tenant isolation, retention. |
| **Staff Integrations Engineer** | Provider-adapter framework + sandbox implementations. |
| **Staff Security / Identity Engineer** | Auth, multi-tenancy, sanitization/CSP, POPIA. |
| **Staff Frontend Engineer** | TypeScript, router, data layer, onboarding, UI. |
| **Staff QA / DevEx Engineer** | Tests (Vitest/RTL/Playwright), CI/CD, observability. |

## 6. Ways of Working

- **Design before build.** Interfaces and module boundaries are agreed first so engineers build in parallel without colliding.
- **Isolated worktrees** for parallel implementation; integrate via the Engagement Lead.
- **Definition of Done:** lint + typecheck clean, tests passing, build green, browser/E2E verified, committed & pushed.
- **Approval-first** remains a product principle: domain purchase, DNS, publish, and payment config require sign-off + audit.
- Milestones tracked on the session task board; architecture & roadmap live in `docs/`.

## 7. Milestones (high-level — refined by the architecture synthesis)

- **M0** Foundation: monorepo, tooling, TypeScript, Vercel deploy skeleton (live "hello") + CI.
- **M1** Data: Postgres schema + migrations + data access layer.
- **M2** Adapters: production interfaces + sandbox implementations + registry + audit.
- **M3** Identity & Security: auth, multi-tenancy, sanitization, POPIA tooling.
- **M4** Backend & Publish: API surface + real publish pipeline + per-tenant site serving.
- **M5** Frontend Integration: TS migration, router, data layer, onboarding wizard, auth UI.
- **M6** Quality & Launch: full test suite, CI/CD gates, observability, deploy to Vercel + verification.

## 8. Top Risks (initial — expanded by the team)

| Risk | Mitigation |
|------|------------|
| Repo lives in OneDrive (sync churn, Vite-junction dev issues on this machine) | Build/CI from clean checkouts; consider relocating before heavy local dev. |
| Scope is large for one engagement | Strict milestone sequencing; each milestone independently shippable. |
| Compliance claims outrunning reality | POPIA features must be real before the UI claims them; honest framing only. |
| Repo name (`perathos-AI`) ≠ product | Optional rename pending stakeholder decision. |
