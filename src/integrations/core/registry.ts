// The adapter registry: the nine typed ProviderAdapters keyed by interface, plus
// the dashboard launch-checklist (ported verbatim from the prototype's
// `launchAdapters` / `evaluateAdapters` / `readinessScore`).
//
// Downstream milestones import from here; they do not edit it.

import type { AdapterReadiness, Business } from "@/lib/types";
import type {
  ChecklistAdapter,
  ProviderAdapter,
  ProviderInterface,
} from "./types";
import { STATUS } from "./types";
import { domainAdapter } from "@/integrations/domain";
import { dnsAdapter } from "@/integrations/dns";
import { hostingAdapter } from "@/integrations/hosting";
import { githubAdapter } from "@/integrations/github";
import { emailAdapter } from "@/integrations/email";
import { messagingAdapter } from "@/integrations/messaging";
import { paymentAdapter } from "@/integrations/payment";
import { analyticsAdapter } from "@/integrations/analytics";
import { agentAdapter } from "@/integrations/agent";
import {
  evaluateAnalytics,
  evaluateDomain,
  evaluateEmail,
  evaluateGithub,
  evaluatePayments,
  evaluateProfile,
  evaluateSite,
  evaluateWhatsapp,
} from "./readiness";

export { STATUS };
export type {
  ProviderAdapter,
  ChecklistAdapter,
  ProviderInterface,
  ActionRequest,
  ActionResult,
} from "./types";

/** The nine provider adapters, addressable by their interface name. */
export const adapterRegistry: Record<ProviderInterface, ProviderAdapter> = {
  DomainProvider: domainAdapter,
  DnsProvider: dnsAdapter,
  HostingProvider: hostingAdapter,
  GitHubProvider: githubAdapter,
  EmailProvider: emailAdapter,
  MessagingProvider: messagingAdapter,
  PaymentProvider: paymentAdapter,
  AnalyticsProvider: analyticsAdapter,
  AgentProvider: agentAdapter,
};

export function getAdapter(interfaceName: ProviderInterface): ProviderAdapter {
  return adapterRegistry[interfaceName];
}

/**
 * The dashboard launch-checklist. Order, keys, titles, providers and `evaluate`
 * bodies are ported VERBATIM from the prototype's `launchAdapters`. Icons live
 * in the UI layer (keyed by `key`) so this stays server-safe.
 */
export const launchAdapters: ChecklistAdapter[] = [
  {
    key: "profile",
    title: "Business Profile",
    provider: "Launch Desk",
    interfaceName: "AgentProvider",
    approvalGated: false,
    simulated: true,
    evaluate: evaluateProfile,
  },
  {
    key: "site",
    title: "Website",
    provider: "Hosting adapter (Vercel/SA)",
    interfaceName: "HostingProvider",
    approvalGated: false,
    simulated: true,
    evaluate: evaluateSite,
  },
  {
    key: "domain",
    title: "Domain & DNS",
    provider: "domains.co.za + Cloudflare",
    interfaceName: "DomainProvider",
    approvalGated: true,
    simulated: true,
    evaluate: evaluateDomain,
  },
  {
    key: "whatsapp",
    title: "Connect WhatsApp",
    provider: "Click-to-chat (Meta/BSP later)",
    interfaceName: "MessagingProvider",
    approvalGated: false,
    simulated: true,
    evaluate: evaluateWhatsapp,
  },
  {
    key: "payments",
    title: "Payment Links",
    provider: "Paystack / Yoco / PayFast",
    interfaceName: "PaymentProvider",
    approvalGated: true,
    simulated: true,
    evaluate: evaluatePayments,
  },
  {
    key: "email",
    title: "Business Email",
    provider: "Zoho / Google adapter",
    interfaceName: "EmailProvider",
    approvalGated: true,
    simulated: true,
    evaluate: evaluateEmail,
  },
  {
    key: "github",
    title: "Version History",
    provider: "GitHub App",
    interfaceName: "GitHubProvider",
    approvalGated: false,
    simulated: true,
    evaluate: evaluateGithub,
  },
  {
    key: "analytics",
    title: "Analytics",
    provider: "PostHog + GA4",
    interfaceName: "AnalyticsProvider",
    approvalGated: false,
    simulated: true,
    evaluate: evaluateAnalytics,
  },
];

/** A checklist adapter with its live evaluated readiness merged in. */
export interface EvaluatedChecklistAdapter extends ChecklistAdapter, AdapterReadiness {}

// Run every checklist adapter against the current business to derive statuses.
export function evaluateAdapters(business: Business): EvaluatedChecklistAdapter[] {
  return launchAdapters.map((adapter) => ({
    ...adapter,
    ...adapter.evaluate(business),
  }));
}

// Readiness is real: the share of capabilities that are fully automated (READY).
// REVIEW items are intentionally not counted — they await human approval.
export function readinessScore(business: Business): number {
  const evaluated = evaluateAdapters(business);
  const ready = evaluated.filter((item) => item.status === STATUS.READY).length;
  return Math.round((ready / evaluated.length) * 100);
}
