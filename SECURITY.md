# Security Policy

## Supported Version

Launch Desk is pre-1.0. Security fixes target `main` first.

## Reporting a Vulnerability

Email the maintainer privately before opening a public issue. Include:

- affected URL, route, or package
- steps to reproduce
- expected impact
- whether customer data, payments, domains, or agent actions are involved

Do not include real secrets, customer personal information, payment card data,
or full database exports in a report.

## High-Risk Areas

These paths require extra review and green CI before deployment:

- authentication and tenant bootstrap
- Prisma migrations, RLS, and data-access helpers
- billing, wallet credits, Paystack checkout, and webhooks
- approval tokens and ActionRouter gated actions
- GitHub, Vercel, hosting, domain, WhatsApp, and LLM provider adapters
- cron jobs and any platform-wide maintenance function

## Operator Response Target

- Critical exploitable issue: acknowledge within 24 hours
- High severity issue: acknowledge within 48 hours
- Moderate issue: acknowledge within 5 business days

The default response is contain, patch, add a regression test, and update the
runbook or monitor that would have caught the issue earlier.
