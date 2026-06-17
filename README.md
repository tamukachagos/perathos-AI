# Launch Desk

Launch Desk is the first prototype for a South Africa-first platform that helps non-technical businesses get online quickly:

- AI-generated business profile and website content
- Website preview and publish workflow
- Domain, DNS, email, WhatsApp, payments, GitHub, analytics, and AI update readiness
- Approval-first agent actions for risky operations
- Provider-adapter architecture so the MVP can launch fast without locking into one vendor

## Run Locally

```bash
npm install
npm run dev
```

## MVP Slice

The current app is a working front-end prototype. It simulates the most important customer journey:

1. A business owner enters plain-language business details.
2. The site preview updates immediately.
3. The draft is saved locally so edits survive refresh.
4. `Publish draft` generates a customer-facing route like `#/site/maboneng-mobile-spa`.
5. The launch checklist shows which provider systems are ready, pending, or approval-gated.
6. The analytics and AI update areas show the operational layer that keeps the business improving after launch.

## Build Strategy

Start as a modular monolith with provider adapters:

- `DomainProvider`
- `DnsProvider`
- `HostingProvider`
- `GitHubProvider`
- `EmailProvider`
- `MessagingProvider`
- `PaymentProvider`
- `AnalyticsProvider`
- `AgentProvider`

This keeps the first release simple while preserving a clean path to enterprise-grade orchestration, audit logs, regional providers, and customer-owned assets.
