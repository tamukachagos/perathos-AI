# Launch Desk — Definition of Done

> Companion: [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md)
> A change is "done" when every box below is green. CI is the authoritative gate.

## Every change

- [ ] **Builds with no secrets.** `npm run build` passes with NO `DATABASE_URL`
      and no env: mock mode -> in-memory repo. `next build` never touches a DB.
- [ ] **Typechecks.** `npm run typecheck` (`tsc --noEmit`) is clean.
- [ ] **Lints.** `npm run lint` is clean (no new warnings).
- [ ] **Unit tests pass.** `npm test` (Vitest, `src/**/*.test.ts`) is green.
- [ ] **New external services are optional.** Any new vendor/SDK is gated by env
      and is a no-op (never imported) when its env is unset.

## Security & POPIA

- [ ] User-generated content is sanitized at publish time and re-sanitized at
      render; links pass the URL-scheme allowlist.
- [ ] Tenant scoping comes from the session (`requireTenant`); RLS backstops it.
- [ ] Leads are stored only with explicit consent + a consent timestamp; a
      retention/expiry date is set.
- [ ] **Retention purge Cron** (`/api/cron/purge`) deletes expired leads and is
      `CRON_SECRET`-gated (open only in mock/dev).
- [ ] **DSAR** export + erasure (`/api/dsar`) works and is audited (PII-free).
- [ ] The **Information Officer** contact and an auto-generated policy are live
      at `/privacy`; published sites carry the **consent banner** + policy link.

## Observability

- [ ] Errors and key events go through the **structured logger** (`src/lib/logger.ts`),
      which **never logs PII** (PII-ish keys redacted, PII-ish values masked).
- [ ] **Sentry** is wired but OPTIONAL: enabled only when `SENTRY_DSN` is set,
      a no-op otherwise. Mock mode stays clean.
- [ ] The append-only **audit log** is queryable (tenant-scoped read at
      `/admin/audit`).

## E2E & performance

- [ ] **Playwright golden path** (`e2e/publish-flow.spec.ts`) passes: onboarding
      (describe -> profile) -> publish -> `/s/[slug]` renders with LocalBusiness
      JSON-LD, the `wa.me` CTA, and the consent-gated lead form.
- [ ] Vitest and Playwright never overlap: Vitest runs only `src/**/*.test.ts`;
      Playwright runs only `e2e/*.spec.ts`.
- [ ] **Lighthouse budgets** hold for the published site (`lighthouserc.json`):
      script transfer <= 160 KB, total transfer <= 400 KB (errors); performance
      >= 0.90 and unused-JS / script-count budgets (warnings). SA low-bandwidth
      sites stay lean.

## CI

- [ ] CI is two jobs: **build** (lint + typecheck + test + build) and a separate
      **e2e** (Playwright + Lighthouse, browsers via
      `npx playwright install --with-deps chromium`) so a flake there is isolated.
