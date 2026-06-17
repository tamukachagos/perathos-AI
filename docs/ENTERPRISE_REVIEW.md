# Launch Desk — Principal Architect Synthesis & Build/Budget Brief

*Prepared for the Product Owner. Basis: review of the deployed codebase plus six specialist audits (security, reliability, multi-domain/hosting, LLM routing, business strategy, agent-team). This is the decision document for the next build phase and its budget. Decisions are mine to make; conflicts between specialists are resolved in Part 5.*

---

## 1. Executive Summary

**Where it stands.** Launch Desk is further along, and built better, than its "prototype" framing suggests. The core safety architecture is genuinely strong and not a placeholder: the approval-token scheme (HMAC over verb + payload-hash + idempotency-key + nonce + expiry, constant-time compare, single-use server-side nonce ledger with tenant binding) survived the security audit with **no replay, payload-swap, or cross-tenant redemption bypass**. Postgres RLS is real and `FORCE`d. The provider-adapter framework, the single ActionRouter chokepoint, append-only audit on allow *and* deny, async OperationRef machinery, POPIA-by-default, and site versioning/rollback are all the right primitives — and crucially, the four new owner requirements (multi-domain, hosting resale, LLM routing, agent team) **plug into these existing seams rather than needing a parallel control plane.** That is the single most important finding: the expensive part (a trustworthy safety core) is done.

**The biggest risk** is a recurring one-line pattern that turns dormant features into a breach the moment they activate: **"no key = open/accept."** The Paystack webhook, the POPIA purge cron, and the DSAR endpoint all *fail open* if their secret is unset, and mock auth accepts any email if `DATABASE_URL` is merely malformed — on a **public GitHub repo**. Any one of these in production is a self-serve plan upgrade, a cross-tenant PII export, or passwordless login. These are cheap to fix and must be fixed before any real key is added.

**The second risk is reliability-on-activation:** the approval-nonce ledger, the operation store, and webhook dedup all live in `globalThis` in-memory maps. On Vercel's ephemeral lambdas this means approvals frequently fail as "already used," async operations 404, and webhooks re-apply. And async gated verbs (`domain.register`, `hosting.deploy`) currently **never call the adapter** — they settle to a fake success. None of this is visible to the green CI because every test reuses one in-process store. The system *looks* done and *tests* green precisely where it will break first in production.

**The biggest opportunity** is that the business model the owner is asking for — hosting resale, token resale, an always-on agent team — is fundamentally a **consumption business**, and the codebase has **zero metering primitive** (flat-fee plans only, boolean entitlements, no wallet, no usage ledger). All five specialists independently converged on the same answer: add **one prepaid credit wallet + append-only usage ledger, enforced at the existing ActionRouter chokepoint**. That single addition makes hosting resale, OpenRouter token resale, and the agent team monetizable *and* cost-safe simultaneously, while leaving the elegant boolean-entitlement design intact. Subscriptions sell predictability; the wallet is where the margin actually lives (a defensible 1.5–2.5× spread the non-technical owner never shops around).

**My recommendation in one line:** spend ~2 weeks hardening the activation cliff (fail-closed secrets + persistent stores + real async dispatch), then build the wallet/metering layer, then the reseller and agent-team features on top of it. Do not bolt usage pricing onto flat tiers, and do not activate any real key until the fail-open trio is closed.

---

## 2. Bugs & Reliability — Consolidated, Ranked

Deduped across the reliability and security audits. Severity is impact-on-activation.

### P0 — Will break or breach on activation

| # | Issue | Location | Fix |
|---|---|---|---|
| **B1** | **In-memory stores break the whole approval + async flow on serverless.** Nonce ledger, operation store, and webhook dedup all live in `globalThis`. On Vercel lambdas: approvals fail as `replayed_token` on tokens never used; async ops 404 on poll; webhook redelivery re-applies plan changes. No DB-backed branch exists even when `DATABASE_URL` is set. | `approvalStore.ts:25-34`, `operationStore.ts:34-47`, `webhooks/paystack/route.ts:32-35` | Back nonce ledger + operation store + webhook-dedup with **Prisma tables, tenant-scoped, atomic compare-and-set on consume** (`UPDATE … WHERE consumed_at IS NULL`). One change fixes B1/B7/B8/B12 — same root cause. |
| **B2** | **Async gated verbs never call the adapter.** `domain.register`/`hosting.deploy`/`email.provision` start an operation and return 202 *without* `adapter.action()`; `reconcile()` unconditionally marks `succeeded`. The `"failed"` status is never produced anywhere. On activation: owner told a domain registered when nothing happened, and real failures still report success. | `actionRouter.ts:281-300`, `operationStore.ts:124-135` | Make async verbs call `adapter.action()`; let real settlement (webhook/cron) drive terminal state **including `failed`**, with retries/polling. |
| **B3** | **Webhook/cron/DSAR fail open.** `if (!secret) return true` on Paystack webhook; same on `/api/cron/purge` (deletes leads platform-wide) and `/api/dsar` (exports/deletes any person's PII by contact string, on the base client with no tenant scope). DSAR bearer compare is also non-constant-time. | `webhooks/paystack/route.ts:42-50`, `cron/purge/route.ts:21-27`, `dsar/route.ts:27-33`, `repositories.ts:336-352` | **Fail closed in production**: missing secret = reject, never accept. `requireProductionSecret(name)` helper that throws at boot. Constant-time compares. Rate-limit + identity-proof DSAR. |
| **B4** | **Mock auth accepts any email, selected by DB presence.** `hasDatabase()` drives real-vs-mock auth; a malformed `DATABASE_URL` silently flips the app to passwordless login while looking "up." | `auth.ts:30,46-67`, `env.ts:33` | Refuse to load mock auth when `NODE_ENV==="production"`; require explicit `LAUNCH_DESK_MOCK=1` opt-in. Never infer "auth is real" from "DB exists." |
| **B5** | **Public `/s/[slug]` goes dark under RLS.** `getBySlug` runs on the base client outside `withTenant`; with RLS enabled and a real DB, the tenant predicate evaluates against NULL → zero rows → every public customer site 404s. Same pattern in `purgeExpired`/`findByContact`/`getByProviderId`. | `repositories.ts:164-174,330-352,565-573`, `client.ts:31` | Add a dedicated **public-read RLS policy** (`status='published'`, no tenant predicate) or a privileged read connection. Resolve *before* enabling RLS with a real DB. |
| **B6** | **Forgeable approval tokens / auth secret via public-repo fallback.** Hardcoded dev fallback secrets for the approval HMAC and `AUTH_SECRET`; repo is public. Unset in prod = anyone can mint approval tokens, defeating the entire ActionRouter gate. | `env.ts:61-75`, `auth.ts:27` | Assert both secrets present at boot in production; refuse to start otherwise. |

### P1 — Correctness / parity

| # | Issue | Location | Fix |
|---|---|---|---|
| **B7** | **Idempotency key not tenant-scoped in the operation store** → two tenants using the same key (UI default `"idem-1"`) get each other's OperationRef (cross-tenant leak). Nonce store *does* check tenant; op store doesn't. | `operationStore.ts:30,68-71` | Namespace idempotency by `tenantId` (folded into B1). |
| **B8** | **`consumeNonce` is not atomic (TOCTOU).** Safe single-process, but a double-spend the moment it's backed by Redis/Postgres. The single-use guarantee depends on atomic compare-and-set. | `approvalStore.ts:54-60` | Atomic `UPDATE … WHERE consumed_at IS NULL` returning rowcount (folded into B1). |
| **B9** | **Entitlement gate fails open if `subscriptions` dep omitted.** A billing gate that silently disables when a dependency is missing; the default test harness exercises the unprotected path. | `actionRouter.ts:207` | Fail **closed**: entitlement-bearing verbs deny when subscriptions repo absent; make the param required. |
| **B10** | **Memory vs Prisma versioning parity drift.** `isCurrent` stored-boolean (memory) vs derived from `currentVersionId` (Prisma); version numbering off different sources can collide on the `(siteId, version)` unique constraint. Tests pass on memory, don't prove Prisma. | `memory.ts:150-166`, `repositories.ts:188,244` | Unify version-number derivation; add Prisma repo tests. |
| **B11** | **Reconcile only driven by reads; no operations cron.** `vercel.json` configures only the POPIA purge cron. An unpolled async op stays `pending` forever; on serverless the holding process may be gone. | `operationStore.ts:124-146`, `vercel.json` | Add an operations-reconcile cron route to `vercel.json` (depends on B1's persistent store). |

### P2 — Activation hazards / robustness

| # | Issue | Location | Fix |
|---|---|---|---|
| **B12** | **Real Claude swallows all errors into silent mock fallback** — bad key/401/quota/network all degrade to heuristic with no log, no telemetry. Operator believes AI is live while every request is fake. | `claudeProfile.ts:147-151` | Log error *class* (never key/PII); surface a `degraded` flag in `GeneratedProfile`. |
| **B13** | **Paystack: dedup only on success; weak event-id fallback** (`${event}:${rawBody.length}` collides distinct same-length events); unverified-tenant events ack-and-drop. | `webhooks/paystack/route.ts:85-146` | Hash raw body for event id; verify resolved tenant owns the subscription (also a security item — see S1). |
| **B14** | **`requireTenant()` failures flattened to 401 everywhere** — a live-DB session-resolution error looks like an auth problem, real error swallowed. | `operations/[id]/route.ts:20-25`, `approvals/route.ts:54-59` | Distinguish "unauthenticated" from "error"; `captureError` on the latter. |
| **B15** | **Rate-limit key is spoofable `X-Forwarded-For`; in-memory per-process.** Attacker rotates the header to bypass the 5/min lead cap and flood/poison a tenant's leads. | `leads/route.ts:42-45` | Use platform-provided client IP; back with shared store (Upstash) keyed by IP **and** slug. |
| **B16** | **`db-deploy.mjs` swallows spawn errors; no migration advisory-lock.** Failed `npx` spawn exits 1 with no message; concurrent deploys can race migrations. | `scripts/db-deploy.mjs:31-35` | Log `result.error`/`stderr` before exit; add migration advisory lock. |
| **B17** | **Test-clock leaks into prod settlement timing.** Any caller passing `now` gets instant settlement (delay 0), defeating the pending→poll contract; no way to pass a real clock *and* keep a real delay. | `actionRouter.ts:288` | Decouple settlement delay from the injected clock (explicit param). |

**Highest-leverage order:** (1) B1+B7+B8+B12-dedup together (persistent stores); (2) B2+B11 (real async dispatch + reconcile cron + `failed` state); (3) B5 (public-read RLS) before enabling RLS; (4) the fail-closed trio B3/B4/B6/B9. **Test-coverage caveat:** green CI does not prove serverless multi-process behavior, that async verbs do anything, Prisma-repo correctness, cross-tenant idempotency, or Claude-fallback observability — all the highest-likelihood production failures are structurally invisible to the current suite. Add these tests as part of the hardening workstream.

---

## 3. Security — Consolidated Findings + Must-Have New Controls

**The core is sound.** No bypass found in the approval-token scheme; RLS is real and `FORCE`d. The exposure is concentrated in (a) the fail-open idiom and (b) the *unbuilt* reseller/agent attack surface.

**Existing-code findings** (deduped with Part 2; severity from the security audit):

- **S1 / High** — Paystack webhook fails open *and* trusts `data.metadata.tenantId` from the body with no ownership check → forge `charge.success` to self-upgrade any tenant to Pro. (= B3 + B13.) Verify the resolved tenant owns the `subscription_code`.
- **S2 / High** — Cron-purge and DSAR fail open on **destructive, platform-wide, unauthenticated** endpoints; DSAR leaks any PII by bare contact string. (= B3.)
- **S3 / High** — Mock-auth passwordless flip via malformed `DATABASE_URL`. (= B4.)
- **S4 / Med** — Public-repo fallback secrets for approval HMAC + `AUTH_SECRET`. (= B6.)
- **S5 / Med** — `hashPayload` uses an unkeyed HMAC with a hardcoded key; sound for *binding* but misleadingly named — rename to `digestPayload`, plain SHA-256, so no one later mistakes it for a keyed MAC. (`approvalToken.ts:80`)
- **S6 / Med** — Spoofable rate-limit key. (= B15.)
- **S7 / Med** — Slug is globally unique and `publish` keys off it via a base-client read → cross-tenant **slug-squatting** (deny a competitor their business-name slug). Scope slug uniqueness per tenant; verify `existing.tenantId` matches before versioning. (`repositories.ts:164-223`, `migration.sql:248`)
- **S8 / Low** — JSON-LD via `dangerouslySetInnerHTML`; `JSON.stringify` doesn't escape `<`/`/`, so `</script>` would break out. Currently mitigated by `sanitizeText` stripping tags, but single-sanitizer-deep — escape `<` → `<` before injection. (`PublishedSiteView.tsx:48-51`)
- **S9 / Low** — `inferInterface` defaults unknown/ungated verbs to `HostingProvider` and dispatches them. As real adapters land, a typo'd or attacker-supplied verb routes to a real action plane ungated. **Default-deny.** (`actionRouter.ts:324-337`)
- **S10 / Low** — Step-up is a client-supplied boolean (`stepUp === true`) with no re-auth — the only thing between a session and minting approval tokens. Replace with real step-up (WebAuthn / re-magic-link) before live adapters. (`approvals/actions.ts:66`)

**Cross-cutting root-cause fixes:** a single `requireProductionSecret(name)` helper (kills the fail-open idiom everywhere); constant-time compares for all bearer/secret checks; and a **CI smoke test that asserts RLS is actually on** — the app DB role must be non-superuser / non-`BYPASSRLS`, a cross-tenant read returns 0 rows, and `current_setting` is NULL outside `withTenant`. A wrong DB role silently disables all isolation.

### Must-have controls for the NEW features (build against these — they don't exist yet)

**A. Hosting reseller (containers + managed K8s) — the highest-risk addition in the product.**
- Region/scale/plan from a **server-side enum allowlist** (`{us-east, eu-west, ap-south} × fixed t-shirt sizes`), never free-form. **No raw YAML/Dockerfile/manifest/env from owners, ever** — owner-authored build commands = RCE on your build infra. The platform renders manifests from a vetted catalog.
- **SSRF controls on every outbound provisioning/DNS/webhook call:** destination allowlist, resolve-then-pin IPs, block RFC1918/link-local/`169.254.169.254` (cloud metadata) + IPv6 equivalents. The domain-validation flow is a classic SSRF entrypoint.
- **Per-tenant credential isolation:** namespace-per-tenant, own scoped service account, K8s `NetworkPolicy` default-deny egress, `PodSecurity` restricted, `ResourceQuota`/`LimitRange`. Platform master cloud creds **never** reachable from tenant workloads.
- **Cost-abuse guardrails:** hard per-plan quotas, max-scale ceilings, billing-anomaly alerts, kill-switch. (Reseller billing makes crypto-mining the attacker's goal.)
- All provisioning verbs go through the **existing ActionRouter as gated + async**, entitlement-checked *before* approval.

**B. Domains (.com + .co.za).** Validate hostnames against a strict regex + public-suffix list before any registrar call (the existing `sanitizeUrl` is for *display*, not registrar input — add a dedicated domain validator). Bind every domain to `tenantId` at request time; verify ownership on every `dns.write`. Registrar keys are operator secrets, server-action-plane only.

**C. Customer agent team — the single most dangerous capability** (autonomous repo-write + deploy). Containment, all independent layers:
1. **Least-privilege, per-tenant, short-lived tokens** — a GitHub App scoped to that tenant's single repo, installation tokens minted per task, expiring in minutes. The LLM **never holds a token**.
2. **No direct push to `main`, no direct deploy** — agent opens a PR; merge + deploy are gated verbs through the ActionRouter. The agent is just another actor, not an exception to gating.
3. **Treat agent output as untrusted input** — diffs run the project CI **plus mandatory SAST + secret-scanning + dependency-review**; auto-merge only inside an allowlisted path set (content/styles), **never** CI config, auth, RLS, or `integrations/core`.
4. **Sandbox execution** — ephemeral worker, read-only checkout, egress allowlist = git remote + model endpoint only, **no tenant secrets mounted**, hard token/spend ceiling.
5. **Prompt-injection hardening** — instructions vs. data strictly separated; the only privileged path out is the ActionRouter, which ignores anything but a typed verb+payload. The agent cannot escalate its own scope from inside a task.
6. **Full audit + reversibility** — every agent action to `audit_log` with `actorId` = the agent identity (distinct from owner); reuse site versioning for one-click rollback; tenant-visible activity feed + a per-tenant **pause/kill switch**.

**Decisive call:** the agent **never mints its own approval token** — only the owner-facing approval endpoint mints them. This is what makes a compromised agent unable to self-approve a merge or deploy, and it must be an invariant of the build.

---

## 4. SA Pain Points → Solutions, and Prioritized Opportunities

| Pain (non-technical SA owner) | Severity | How Launch Desk solves it |
|---|---|---|
| Can't build a site; can't afford R8k–R25k agency | **Critical** | Plain-language → live site via wizard + agent profile gen; Free tier = R0 to be live |
| Mobile **data cost** (owner + visitors on metered prepaid) | **Critical** | Static/ISR zero-island sites, Lighthouse budgets in CI → tiny payloads, cheap to load |
| **Load-shedding** kills self-hosted/PC-run sites | High | Site lives on managed hosting, not owner hardware; agent team keeps it up during outages |
| **ZAR payments** (Stripe won't onboard most SA SMBs) | **Critical** | `payments` entitlement + Paystack-shaped adapter; plan copy already names Paystack/Yoco/PayFast |
| **Trust / "is this a scam?"** | High | Approval-first router, append-only audit, POPIA-by-default, `/privacy` + Information Officer = a legible, accountable presence |
| **No technical skill / fear of breaking it** | **Critical** | Single chokepoint + simple approvals; agent team does the technical labour |
| **POPIA fear** (real fines; most SMBs non-compliant) | High | Consent-gated leads, retention purge, DSAR, Information Officer baked in — compliance as default |
| **Discoverability** ("online but nobody finds me") | High | LocalBusiness JSON-LD + wa.me shipped — **but Google Business Profile, the real SA discovery engine, is missing** (top upsell) |

The platform already nails pains 1–7 structurally. The weakest-covered pain — **discoverability** — is also the highest-leverage upsell.

**Prioritized missing opportunities:**
- **Tier 1 (ship alongside the new requirements):**
  - **B1 — Google Business Profile automation.** In SA, GBP + WhatsApp *is* discovery far more than classic SEO. Auto-create/verify/sync from the same profile. #1 missing thing for discoverability; natural Growth+ feature.
  - **B2 — WhatsApp commerce** (not just `wa.me`): catalogues, order capture, payment links inside WhatsApp (Meta BSP), billed per-conversation. High differentiation; gives the agent team something commercially valuable to maintain.
  - **B3 — Invoicing & quotes** (branded, with banking details + VAT) — cheap to build off existing profile/site data, huge retention hook, justifies Pro.
- **Tier 2:** reviews/reputation (feeds GBP); multi-language generation (isiZulu/isiXhosa/Afrikaans — a real moat vs. global builders, near-free via the cheap-model LLM lane); lightweight bookkeeping (defer, build-heavy).
- **Tier 3:** Launch Desk directory (network effect + future ad surface); domain+email bundling as a profit center.

**Decision:** ship **GBP (B1) + WhatsApp commerce (B2)** as part of this phase so the agent team has something worth paying to keep running; **invoicing (B3)** is the cheapest standalone retention win and a fast follow.

---

## 5. Expansion Architecture (Conflicts Resolved, Calls Made)

The unifying principle from all specialists: **add verbs and tables, not a second control plane.** Everything risky still flows through the one ActionRouter, gets a single-use HMAC approval, and lands an append-only audit row on allow and deny.

### 5.1 Multi-domain (.com + .co.za) — registrar-agnostic
Keep the single `DomainProvider` interface; introduce a **RegistrarRouter** selecting a backend by TLD (no single registrar does both well):
- **`.co.za`** → EPP via a ZACR-accredited SA registrar (Domains.co.za / Diamatrix / ZARForce-Hetzner). Ownership-bound, settles in minutes; transfers use ZACR auth-info.
- **`.com`** → an international gTLD reseller API (Namecheap / Gandi / OpenSRS / Cloudflare Registrar at-cost). Near-instant register; transfers are the slow path (60-day ICANN lock, auth code, 5-day ACK).

This is mostly framing + routing — the `Domain` model is already TLD-neutral (`hostname String @unique`). New verbs: `domain.checkAvailability` (**ungated**, read-only — a real availability/price tool already exists in this environment), `domain.transfer` (gated+async), `domain.renew` (gated+async, auto-renew billing). Async settlement reuses `startOperation`/`settleOperation`, driven by **registrar webhooks** in live mode (replacing the mock timer) and a **reconciliation cron** for transfers with no webhook. Add `transfer_pending`/`expiring` to the existing `Domain.status` lifecycle, plus `tld`, `registrar`, `registrarRef`, `autoRenew`, `expiresAt`, `authCode` (encrypted), `costCents`, `priceCents`, `operationId`.

### 5.2 Multi-region hosting / K8s / container resale control plane
Mirror the registrar pattern: keep `HostingProvider`, route to a **HostingTier** backend chosen by the owner's plain-language picker.

| Tier | Backend | Use |
|---|---|---|
| **StaticTier** | Vercel (already the deploy target) | Frontend/SSR sites at `/s/[slug]` — included |
| **ContainerTier** | Fly.io / Railway / Hetzner + thin orchestrator | Small backend + volume — the "rent what they use" workhorse, flat monthly |
| **KubernetesTier** | GKE / EKS / AKS, namespace-per-tenant | True US/EU/Asia regional placement, metered |

**Call I'm making — namespace-per-tenant, not cluster-per-customer.** The security audit and the platform architect agree but it's worth making explicit: the operator runs a **small number of operator-owned clusters per region** and gives each customer a namespace + `ResourceQuota`. Cheap, dense, and the only way the unit economics work. Cluster-per-customer is rejected.

**The non-technical picker** is two plain questions — "Where are your customers?" (→ region) and "How big?" (→ named plan: Starter/Business/Scale), never vCPUs or YAML. A data-driven `HostingPlan` table maps each plan → `{tier, regionPool, cpuMilli, memMb, replicas, storageGb, priceCents}` so the catalog and markup are config, not code.

New gated+async verbs: `hosting.provision`, `hosting.scale`, `hosting.teardown` (entitlement `managedHosting`). Provisioning runs in a durable queue (`provisioning_jobs` table + cron, or QStash/Inngest), not in the request; a `HostingDeployment` row carries the state machine `requested → provisioning → running → (scaling) → suspended → torn_down | failed`, with a reconciliation cron sweeping stuck rows. Non-payment → `hosting.teardown` stops the meter.

### 5.3 Vercel + GitHub integration
**Repo-per-customer, operator-owned.** The GitHub App creates one private repo per customer site under an operator org (`launchdesk-sites/{slug}`); each publish is a commit (the rollback target *and* the agent team's working surface). The owner never sees Git — they see "history" and "undo." StaticTier uses the Vercel API to create a project + deploy hook per repo; `deployment.succeeded` settles the `hosting.deploy` operation; custom domains map via Vercel's domains API + a gated `dns.write` (Cloudflare CNAME/A). Container/K8s tiers build from the **same repo** via GitHub Actions → operator registry → worker rolls the deployment. **GitHub is the single source of truth across all three tiers; only the deploy target differs.**

### 5.4 Metering → billing (the resolved conflict)
**Resolved conflict:** the LLM specialist proposed `TokenWallet`/`TokenLedger` (ZAR micro-cents); the hosting specialist proposed `UsageRecord`/`Invoice`; the agent specialist proposed `UsageRecord` (microcents) + `TokenWallet`. **My call: one unified ledger, one wallet.**
- **`TokenWallet`** (one per tenant): `balanceMicro` in **ZAR micro-cents**, prepaid; cached running total.
- **`UsageRecord`** (append-only, the billing source of truth): one row per metered event — `kind` (`hosting.cpu_hour | hosting.storage_gb_mo | domain.register | llm.<task>`), `quantity`, `unitCostMicro` (wholesale), `unitPriceMicro` (retail = cost × margin), period, `idempotencyKey`, `@@unique([tenantId, idempotencyKey])` for exactly-once accounting.
- **`Invoice`** rolls usage per period and charges via the dormant Paystack `BillingProvider`.

This single ledger serves LLM tokens, hosting-hours, and domains alike. **The wallet balance is the universal hard ceiling, enforced as a pre-flight check at the ActionRouter** — provisioning/agent work/LLM calls are all denied before they can rack up cost the customer can't pay. This is the one structural addition that unlocks every new revenue line.

**Where everything plugs in (no new chokepoints):** TLD routing → `DomainProvider` + mode selection; all risky verbs → `GATED_VERBS` + token + audit; async ops → `startOperation`/`settleOperation` via webhook/cron; hosting tiers → `HostingProvider` + tier router; entitlement/pay gate → `requiresEntitlement` pre-check; per-customer repo + deploy → `GitHubProvider` + Vercel API; metering → `UsageRecord`/`Invoice` + Paystack.

---

## 6. LLM Strategy — OpenRouter Routing, Task→Tier→Model, Token Resale

Today the agent layer is single-model, single-task: `selectAgentProvider()` returns mock-or-Claude on `ANTHROPIC_API_KEY`; `generateBusinessProfileWithClaude` hardcodes Sonnet, no router, no metering, no cost attribution. The fix is a new **`src/integrations/llm/` model-router** that becomes the chokepoint for *every* LLM call (the AgentProvider and the agent team both call `routeLlm`, never SDKs directly).

**Provider selection (mirrors the existing dormant pattern):** `OPENROUTER_API_KEY` → OpenRouter (primary; OpenAI-compatible, one billing relationship for OSS *and* frontier models, returns native token usage + cost for metering); else `ANTHROPIC_API_KEY` → direct Anthropic; else deterministic mock with synthetic usage so the whole wallet/metering UX is exercisable with no keys.

**Four tiers and concrete model policy** (pinned in `src/integrations/llm/policy.ts`, overridable per-tier by env — models churn, so this is config not code):

| Task | Tier | Primary | Fallbacks |
|---|---|---|---|
| `profile.extract` | CHEAP | `meta-llama/llama-3.3-70b-instruct` | `qwen-2.5-72b`, `deepseek-chat` |
| `classify.intent` | CHEAP | `meta-llama/llama-3.3-8b-instruct` | `qwen-2.5-7b` |
| `copy.generate` | CHEAP | `deepseek/deepseek-chat` | `qwen-2.5-72b` |
| `site.codegen` | SPECIALIST-CODE | `anthropic/claude-sonnet-4-6` | `qwen-2.5-coder-32b`, `deepseek-coder` |
| `site.codefix` | SPECIALIST-CODE | `anthropic/claude-sonnet-4-6` | `deepseek-r1` |
| `image.generate` | SPECIALIST-IMAGE | `google/gemini-2.5-flash-image` | `black-forest-labs/flux-1.1-pro` |
| `image.edit` | SPECIALIST-IMAGE | `flux-1.1-pro` | `gemini-2.5-flash-image` |
| `reason.plan` | PREMIUM | `anthropic/claude-opus-4-6` | `gpt-5`, `gemini-2.5-pro` |
| `security.review` | PREMIUM | `anthropic/claude-opus-4-6` | `gpt-5` |

> Note (Engagement Lead): pin to currently-released model ids at build time — e.g. Anthropic `claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5` — and keep the policy env-overridable, since model names churn.

**Rationale:** DeepSeek/Qwen/Llama own the price-performance frontier for extraction/classification/draft copy — using Sonnet there (as today) is pure margin erosion. Sonnet for code because the agent team's edits must compile and pass CI; a wrong cheap fix costs more in re-runs than a right expensive one. Opus reserved only for the two tasks that gate a risky deploy. **Flux 1.1 Pro for hero/logo quality, Gemini Flash Image for cheap/volume + in-image text** covers the graphics bar; image models route through a per-image sub-adapter (OpenRouter or fal.ai/Replicate).

**Routing loop (`routeLlm`):** resolve model from policy → **pre-flight quota gate** (estimate max cost; reject `insufficient_credits` if wallet+allowance can't cover it — the LLM analogue of the entitlement gate) → cache check → call → **quality gate** (JSON must parse the existing schema; code must pass `tsc --noEmit` + lint in sandbox before going near a PR; security verdict must be structured) → **escalate one tier on twice-failed cheap result, then human** → settle wallet in one transaction → audit (`action: "llm.usage"`, PII-free metadata). **Cost levers:** exact + prompt caching keyed on `hash(model+system+messages+params)` (a hit debits nothing — the single biggest margin lever), JSON mode + output caps, cheapest-viable-first.

**Token resale:** prepaid ZAR wallet (caps surprise bills, self-limits abuse). Margin = `upstreamCost × FX(LLM_FX_ZAR_PER_USD, buffered) × per-tier markup` (CHEAP ~3.0×, CODE ~1.6×, IMAGE ~1.8×, PREMIUM ~1.4× — fat multiple on tiny-absolute cheap volume, near pass-through on premium so no single Opus call feels punitive). Each plan includes a monthly allowance; top-ups reuse the Paystack `createCheckout` path as a `token_topup` SKU. Exactly-once via the `@@unique([tenantId, idempotencyKey])` ledger constraint. Owner-facing UX is a "Credits" page showing **Rand and a progress bar — never tokens or model names.**

---

## 7. The Customer Agent-Team Service

**Design stance (the load-bearing decision):** the agent team is **not a tenth adapter that can do what it wants** — it is an orchestrator that calls the existing nine adapters through the existing ActionRouter. Agents hold **zero raw credentials** and **zero direct push/deploy power**; their only side-effecting move is `executeAction()`, the same chokepoint the owner's manual actions use. The LLM proposes a typed verb+payload; the router decides, possibly after owner approval. It reuses approval tokens, single-use nonce, per-verb gating, entitlement-before-token, async OperationRef, SiteVersion rollback, append-only audit, and the Paystack provider — all already built. It adds only **roles + a job queue + a metering ledger + three gated verbs.**

**Five roles behind a queue** (a thin **Conductor** decomposes each trigger into a bounded job DAG — no role self-loops; `maxAttempts=2`, `maxTokens` per job):

| Role | Trigger | Produces | Model tier |
|---|---|---|---|
| **Conductor** | every trigger | job DAG + budget allocation | premium |
| **CI Medic** | GH Actions `workflow_run` failure | a fix PR | cheap → escalate on 2nd failure |
| **Builder** | owner request; improvement sweep | feature/content PR + preview | website-strong + graphics |
| **Bug Hunter** | runtime error spike; schedule | repro + fix PR | mid → premium on sev-high |
| **Security Sentinel** | Dependabot/advisory; daily; pre-merge | dep-bump PR or `BLOCK` verdict | premium |
| **Reviewer** | every PR before owner sees it | `{approve\|revise\|escalate}` + plain-language summary | premium (last machine gate) |

**Safe execution, layered:** (a) **sandboxed authoring** — ephemeral worker, read-only checkout, egress allowlist = git + model endpoint, no secrets mounted, output is a diff only; (b) **PRs never pushes** — the GitHub App token is held server-side, scoped to feature branches; `main` is branch-protected requiring PR + green CI + Reviewer approval; (c) **required CI gates** — CI Medic's own fixes must pass the same CI it cannot disable; (d) **everything risky through the ActionRouter** via three new gated verbs (`github.mergePR`, `agent.deployFix` async, `agent.applyContent`), entitlement `agentTeam`; (e) **async + rollback** — deploy is `async`, settled by the Vercel webhook; post-deploy health-check failure auto-rolls-back by repointing `currentVersionId`; (f) **risk tiering** maps to who approves — **AUTO** (content/copy/image swaps, patch dep-bumps with green CI → notify, don't ask), **REVIEW** (features, layout, anything touching the lead form/POPIA → owner one-tap card), **ESCALATE** (schema/auth/billing/RLS, major bumps, any Security-Sentinel flag, `/privacy`/consent/payment → explicit approval + Sentinel warning); (g) **spend cap as a hard pre-flight between every step**, not a post-hoc reconcile.

**The invariant that prevents a rogue agent:** approval tokens are minted **only** by the owner-facing approval endpoint — the agent has no signing secret, so a compromised agent cannot self-approve a merge or deploy. Plus per-tenant **pause/kill switch** (`AgentPolicy.pausedByOwner`), tenant-scoped jobs + RLS backstop, and untrusted text treated as data not instructions.

**Owner UX:** an "Ask your team" box (plain English in), an activity feed rendered from `audit_log` + `agent_jobs` ("Your team fixed a failed deploy — live again. 2h ago"), and approval cards with an embedded preview-deploy link and friendly risk labels (Safe / Worth a look / Please read). The mental model sold: *"You have a web team on call. Tell them what you want in plain English. They fix breakages overnight and only interrupt you for a yes/no. You pay for what they do."*

**Monetization:** gate as an `agentTeam` entitlement (bundled on Pro / add-on); the work is metered against the same wallet (§5.4/§6), so the always-on team is naturally budget-bounded and visible in the ledger — no separate runaway-cost surface. New tables: `AgentJob`, `UsageRecord` (shared), `TokenWallet` (shared), `AgentPolicy`. No raw code/diffs/secrets in the DB — code lives in the customer's GitHub repo; payloads referenced by hash to stay token-bindable.

---

## 8. Monetization & Unit Economics

**Architectural prerequisite (all specialists agree):** keep the flat tiers for *capability* (the boolean entitlements are right); add a **prepaid credit wallet for consumption**. Subscriptions = predictability + overhead cover; the wallet = margin. *Margin lives in the credit→cost spread, never in the subscription.*

**Packaging:**

| | Free | Growth (R149) | Pro (R349) | **Managed (new, R899–R1,499)** |
|---|---|---|---|---|
| Domains | — | .co.za **and .com** (at-cost + markup) | same | same |
| Hosting | shared static | shared static | **1 container included**, regions extra | **managed K8s region included to a cap** |
| Tokens | tiny grant (~R10) | ~R30 credits/mo | ~R75 credits/mo | **~R300 credits/mo** |
| Agent team | — | fix-it on approval (pay-per-run) | scheduled weekly maintenance | **always-on autonomous team** |

**Resale spreads:** domains — .co.za wholesale ~R65–90/yr **[est]** sell R149; .com wholesale ~R150–220/yr **[est]** sell R249 → ~R60–85 margin/domain/yr. Hosting — containers/K8s at **~40–60% markup** over operator cloud cost. Tokens — **customer credits = operator cost × 1.5–2.5×**.

**Per-customer unit economics (illustrative; R/USD ≈ 18; Paystack ≈ 2.9% + R1; all costs [est]):**
- **Growth (R149/mo):** −R5.30 Paystack, −~R8 static hosting, −~R12–18 included token cost, −~R10 amortized support → **gross margin ≈ R110/mo (~74%)**; overages are pure additional margin.
- **Managed (R1,199/mo + wallet):** included allowance costs ≈ R120–200 tokens + **R350–550 K8s small node** (the real risk line) + R36 Paystack + R60 support → **contribution ≈ R250–430/mo before overage**. Thin if the included K8s is generous → **size the included tier deliberately small; push real workloads to metered overage.**
- **Token micro-economics (the engine):** a "continuous dev + fix CI" run ~50k–300k tokens ≈ $0.50–3.00 wholesale **[est]**; at 2× the customer pays ~R18–110/run. A maintenance-heavy month of 30–60 runs = **R500–3,000 of wallet draw at ~50% margin — this dwarfs the subscription.**

**Headline:** sell subscriptions for predictability; **the wallet (tokens + hosting + domains) is where Launch Desk actually makes money**, at a defensible 1.5–2.5× spread the non-technical owner neither sees nor shops around. FX risk (USD cost, ZAR revenue) is absorbed by an FX buffer baked into the markup; re-price credit packs quarterly.

---

## 9. Cost Estimate to Complete the Initial Build

**Assumptions (stated plainly):** blended senior full-stack rate **ZAR 850/hr ≈ USD 47/hr** (≈ R34k/eng-week at 40h); R/USD = 18; one strong engineer-equivalent throughput, so eng-weeks ≈ calendar weeks for a 1–2 person team. Estimates are **t-shirt ranges, not quotes** — the bottom assumes the existing primitives carry as much as the architects claim (they should); the top carries integration friction with real registrar/cloud/Meta APIs. Effort excludes the cloud run-rate (separate below). I've added a **20% integration-and-rework buffer** into the totals, not the line items.

| # | Workstream | Scope | Eng-weeks | ZAR | USD |
|---|---|---|---|---|---|
| W1 | **Activation hardening** (P0/P1 bugs + fail-closed secrets + persistent stores + real async dispatch + reconcile cron + public-read RLS + the missing tests) | Part 2 B1–B11 + Part 3 cross-cutting | 4–6 | R136k–204k | $7.5k–11.3k |
| W2 | **Metering core** (TokenWallet + UsageRecord + Invoice + walletsRepo + pre-flight wallet gate at ActionRouter + Credits UI) | §5.4 / §8 prerequisite | 3–5 | R102k–170k | $5.7k–9.4k |
| W3 | **LLM router** (`src/integrations/llm/*`: provider, policy, router, meter, cache; refactor profile path; quality gates) | Part 6 | 4–6 | R136k–204k | $7.5k–11.3k |
| W4 | **Multi-domain** (RegistrarRouter, .com + .co.za live adapters, availability/transfer/renew verbs, webhook+cron settlement) | §5.1 | 3–5 | R102k–170k | $5.7k–9.4k |
| W5 | **Hosting reseller control plane** (HostingTier router, container + K8s provisioners, provisioning queue, state machine, region picker UI, SSRF + isolation controls) — *the heaviest, riskiest workstream* | §5.2 + Part 3.A | 7–11 | R238k–374k | $13.1k–20.6k |
| W6 | **Vercel + GitHub integration** (per-customer repo, project+deploy-hook, deploy webhooks, custom-domain mapping) | §5.3 | 2–4 | R68k–136k | $3.8k–7.5k |
| W7 | **Agent team** (Conductor + 5 roles, sandbox worker, 3 gated verbs, risk-tiering, webhook ingress, approval/activity UI, kill switch) | Part 7 | 6–9 | R204k–306k | $11.3k–16.9k |
| W8 | **SA growth features** (GBP automation + WhatsApp commerce; invoicing as fast-follow) | Part 4 Tier 1 | 4–7 | R136k–238k | $7.5k–13.1k |
| W9 | **Real-key activation + hardening pass** (sandbox/SAST/secret-scan on agent PRs, step-up auth, abuse/rate limits, go-live runbook, security re-test) | Parts 2/3 | 2–4 | R68k–136k | $3.8k–7.5k |
| | **Subtotal** | | **35–57** | R1.19m–1.94m | $66k–107k |
| | **+20% integration/rework buffer** | | | **R1.43m–2.33m** | **$79k–129k** |

**Confident headline range to complete the expanded one-stop shop: ZAR 1.4m–2.3m / USD 79k–129k**, roughly **8–13 calendar months** for a 1–2 engineer team, or ~4–6 months if parallelized across 3 engineers. If the owner wants a phased commitment, **Phase 1 (W1+W2+W3, the foundation) is ZAR ~375k–575k / USD ~21k–32k** and de-risks everything downstream.

**Monthly run-rate / infra** (operator fixed cost, before per-customer cloud which is pass-through-plus-margin):

| Item | ZAR/mo | USD/mo |
|---|---|---|
| Vercel (platform + small customer base) | R900–2,700 | $50–150 |
| Postgres (Neon/Vercel) | R360–1,800 | $20–100 |
| Operator-owned K8s clusters (3 regions, minimal baseline before tenant load) | R5,400–14,400 | $300–800 |
| Upstash (rate-limit/cache), QStash/Inngest (queue) | R540–1,800 | $30–100 |
| Observability + secret-scanning/SAST tooling | R900–2,700 | $50–150 |
| LLM/image baseline (operator testing + mock-to-real) | R900–3,600 | $50–200 |
| **Fixed operator run-rate** | **R9,000–27,000** | **$500–1,500** |

The K8s baseline dominates and is the reason for the "default customers to containers, size included K8s small" call in §8. **Per-customer cloud cost is pass-through + markup via the wallet**, so it does not sit in the fixed run-rate — a customer cannot consume infra they haven't pre-funded.

**Per-customer economics recap:** Growth ~R110/mo gross margin (~74%); Managed ~R250–430/mo contribution before overage; the wallet draw (tokens + hosting overage) at ~50% margin is the real earner. Break-even on the fixed run-rate is on the order of **~80–250 Growth customers** (or far fewer Managed/wallet-active ones) — sensitive to how heavily the agent team is used, which is exactly why metering-before-spend is non-negotiable.

---

## 10. Prioritized Roadmap (Phased)

**Phase 0 — Stop the bleeding (≈2 weeks, part of W1). Gate: no real key activates until this is green.**
Close the fail-open trio (Paystack webhook, cron-purge, DSAR) and the mock-auth flip; assert prod secrets at boot; default-deny unknown verbs; escape JSON-LD; per-tenant slug scoping. Add the RLS CI smoke test. *Outcome: the public-repo + dormant-key combination is no longer a breach waiting for one missing env var.*

**Phase 1 — Foundation (W1 finish + W2 + W3; ZAR ~375k–575k / USD ~21k–32k).**
Persistent nonce/operation/dedup stores with atomic consume; real async adapter dispatch + reconcile cron + `failed` state; public-read RLS resolved; the missing tests. Then the **metering core** (wallet + usage ledger + pre-flight gate) and the **LLM router** (OpenRouter, task→tier→model, caching, quality gates). *Outcome: the system is reliable on serverless, real AI runs cheaply-routed and metered, and the consumption business model is now possible. This phase de-risks everything after it.*

**Phase 2 — Make money on consumption (W4 + W6 + W8-GBP/WhatsApp).**
Multi-domain (.com + .co.za) live; Vercel+GitHub per-customer repos and deploys; GBP automation + WhatsApp commerce so there's something commercially valuable to maintain. Turn on real Paystack + token resale. *Outcome: first real revenue lines beyond flat subscriptions; discoverability gap closed.*

**Phase 3 — The reseller substrate (W5 + W9-security).**
Hosting control plane: container tier first (the workhorse), then managed K8s with the full isolation/SSRF/quota control set, region picker, provisioning queue, teardown-on-non-payment. *Outcome: "rent what they use + margin" is live; this is the heaviest, most security-sensitive phase — do it after metering and the safety re-test exist, never before.*

**Phase 4 — The always-on team (W7 + W9 finish).**
Agent team with PR-only execution, the three gated verbs, risk-tiering, sandbox + SAST/secret-scan on agent PRs, step-up auth, kill switch, owner activity feed. Launch the **Managed** plan. *Outcome: the full one-stop-shop promise — the non-technical owner pays for tokens and gets an enterprise team keeping their site live, secure, and improving.*

**Fast-follows (anytime after Phase 1):** invoicing/quotes (cheap retention win), multi-language generation (near-free via the cheap LLM lane, a real moat), reviews/reputation, the Launch Desk directory.

**The through-line:** every phase adds verbs and tables to the *one* ActionRouter, never a second control plane; every risky action keeps the single-use HMAC approval and the append-only audit on allow and deny; and the prepaid wallet is the universal hard ceiling that makes resale and autonomy cost-safe. The owner only ever answers *"which name?"*, *"where & how big?"*, and *"yes/no?"* — the platform does everything else.
