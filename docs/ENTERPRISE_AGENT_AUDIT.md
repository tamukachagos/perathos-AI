# Enterprise Agent Audit

Date: 2026-06-18

## Executive Read

Launch Desk is not just another website builder if it stays focused on the
operator outcome: "tell us your business, and in under 10 minutes your domain,
site, email, WhatsApp, payments, analytics, repo, deployment, support, and update
loop are working." The strongest moat is not AI page generation by itself. The
moat is the trusted automation bundle for low-technical South African and
African SMBs: local payments, POPIA-aware lead capture, WhatsApp commerce,
domain/DNS, GitHub/Vercel deployment, agent maintenance, and high-touch support.

The market already has fragments:

- Domains.co.za offers South African domains, hosting, templates, and an AI site
  builder: https://www.domains.co.za/ and
  https://www.domains.co.za/knowledgebase/site-builder/ai-website-builder/
- HOSTAFRICA offers a no-code AI website builder with hosting:
  https://hostafrica.co.za/website-builder/easy-ai-builder/
- xneelo is a trusted local hosting/domain provider with 24/7 support:
  https://xneelo.co.za/
- Global builders such as Site.pro, HostPapa, Network Solutions, Manus, Wix,
  Shopify, and GoDaddy compete on fast AI websites, templates, domains, and
  hosting.

The gap: none of those fragments appear positioned as a South Africa-first
"business launch operating system" that also provisions GitHub repos, deploys
customer sites, configures Paystack/WhatsApp, meters AI and hosting costs,
keeps an audit trail, and assigns agent teams to maintain customer outcomes.

## Moat To Build

1. **10-minute activation guarantee**: templates, pre-vetted flows, deterministic
   provisioning, and a visible launch timer.
2. **Trust bundle**: POPIA lead consent, DSAR workflow, payment-webhook truth,
   domain auth-code encryption, audit log, and customer-visible site health.
3. **Local operating stack**: `.co.za` domains, Paystack/Yoco/PayFast paths,
   WhatsApp commerce, SA mobile validation, ZAR wallets, local support.
4. **Agent staff, not vague AI**: bounded roles that open PRs, run checks,
   explain risk, and ask approval for billing/auth/RLS/deploy changes.
5. **Template economics**: industry skeletons reduce LLM spend, improve quality,
   shorten launch time, and create a marketplace.
6. **Learning loop**: every failed launch, support ticket, incident, and template
   edit becomes a test, runbook patch, or template improvement.

## AI Video Add-On

Do not make video generation part of the default 10-minute path. Offer it as a
metered add-on for ads, product explainers, WhatsApp catalog clips, and social
launch packs. Route through a provider adapter so the platform can switch models
by cost, region, quality, and availability.

Good first provider candidates:

- OpenAI Sora Videos API: https://developers.openai.com/api/docs/guides/video-generation
- Google Veo in Gemini API: https://ai.google.dev/gemini-api/docs/video
- Runway API: https://docs.dev.runwayml.com/

Recommended first product: "Launch Pack" that creates 3 short vertical videos,
3 WhatsApp catalog images, 5 social captions, and a landing-page hero image from
the customer's approved business profile. Run it only after the core site is
live and wallet-funded.

## Enterprise Agent Team

Run agents as bounded staff with permissions, queues, budgets, and approvals:

- Ops Conductor: routes signals into incidents, support tickets, or PR work.
- CI Medic: reads failing checks and opens fix PRs.
- Security Sentinel: CodeQL, dependency review, secrets, auth/RLS/billing review.
- Dependency Steward: Dependabot triage and patch PRs.
- Release Captain: deploy health gates, rollback, release notes.
- Synthetic Monitor: probes customer sites, forms, WhatsApp links, JSON-LD, SEO.
- Provider Health Agent: checks Vercel, GitHub, Paystack, registrar, WhatsApp,
  email, and LLM providers.
- Template QA Agent: mobile, accessibility, POPIA, SEO, low-bandwidth quality.
- Support Agent: drafts customer replies and turns reports into issues.
- Business Review Agent: weekly uptime, conversion, revenue, cost, churn report.

Rule: agents may propose, test, open issues, and open PRs. They do not directly
merge, change payment/auth/RLS/privacy code, or spend unbounded money.

## Business Opportunities

- **Done-for-you launch fee**: charge a setup fee for guaranteed launch speed.
- **Managed monthly plan**: domain, hosting, support, updates, AI credits, uptime.
- **Template marketplace**: charge for industry packs and partner templates.
- **WhatsApp commerce pack**: catalog, order intake, payment links, reminders.
- **AI ad/video credits**: high-margin optional wallet usage.
- **Local SEO pack**: Google Business Profile setup, schema, review automation.
- **Agency/reseller portal**: let accountants, marketing freelancers, and township
  business hubs launch clients through your control plane.
- **Compliance pack**: POPIA notices, DSAR export/erasure, breach playbook.
- **Migration concierge**: import from Facebook pages, Instagram bios, WhatsApp
  catalogs, old WordPress sites, or PDFs.

## Next Build Priorities

1. Finish live payment truth: pending checkout records, refund/chargeback states,
   invoices, and tax-ready receipts.
2. Add customer site health dashboard and external synthetic monitors.
3. Add host-to-slug middleware for custom domains.
4. Make `/api/cron/agent` a real multi-tenant queue sweep before scheduling it.
5. Add branch protection in GitHub: CI, DB tests, E2E, CodeQL, dependency review,
   secret scan, and CODEOWNERS review for risky paths.
6. Build 5 launch templates: beauty, trades, restaurant/takeaway, professional
   services, ecommerce/WhatsApp catalog.
7. Add provider status and rollback runbooks for Paystack, Vercel, GitHub, DNS,
   WhatsApp, email, and LLM routes.

## Compliance Notes

POPIA breach reporting through the Information Regulator eServices portal became
mandatory from 2025-04-01 according to the Regulator's 2025-04-07 media
statement:
https://inforegulator.org.za/wp-content/uploads/2025/04/MEDIA-STATEMENT-INVITATION-TO-REPORT-SECURITY-COMPROMISES-THROUGH-THE-eSERVICES-PORTAL-.pdf

Keep a breach playbook, subprocessor list, customer DPA, retention schedule, and
DSAR identity-proofing process before production customers.
