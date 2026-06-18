// The adapter registry: the nine typed ProviderAdapters keyed by interface.
//
// This is the SERVER action plane — it statically imports every adapter
// implementation (which can pull in node:crypto via payment/LLM/metering), so it
// must NEVER be imported by a client component. Client components import the pure
// launch-checklist readiness from ./checklist instead (re-exported here for
// server consumers' convenience).
//
// Downstream milestones import from here; they do not edit it.

import type { ProviderAdapter, ProviderInterface } from "./types";
import { domainAdapter } from "@/integrations/domain";
import { dnsAdapter } from "@/integrations/dns";
import { hostingAdapter } from "@/integrations/hosting";
import { githubAdapter } from "@/integrations/github";
import { emailAdapter } from "@/integrations/email";
import { messagingAdapter } from "@/integrations/messaging";
import { paymentAdapter } from "@/integrations/payment";
import { analyticsAdapter } from "@/integrations/analytics";
import { agentAdapter } from "@/integrations/agent";
import { localListingAdapter } from "@/integrations/localListing";

// Re-export the client-safe checklist readiness plane so existing SERVER
// importers of the registry keep working unchanged.
export {
  STATUS,
  launchAdapters,
  evaluateAdapters,
  readinessScore,
} from "./checklist";
export type { EvaluatedChecklistAdapter } from "./checklist";
export type {
  ProviderAdapter,
  ChecklistAdapter,
  ProviderInterface,
  ActionRequest,
  ActionResult,
} from "./types";

/** The provider adapters, addressable by their interface name. */
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
  LocalListingProvider: localListingAdapter,
};

export function getAdapter(interfaceName: ProviderInterface): ProviderAdapter {
  return adapterRegistry[interfaceName];
}
