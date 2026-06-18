// The ProviderAdapter interface: a CLIENT readiness plane and a SERVER action
// plane. The readiness plane is the pure, secret-free `evaluate(business)` we
// already shipped in the prototype. The action plane is the side-effecting
// surface that real vendors implement in M4 — in M0 actions are mock/no-op
// stubs, selected by config (mock mode is the default).

import type { AdapterMode, AdapterReadiness, Business } from "@/lib/types";

/** Readiness vocabulary shared across the platform. */
export const STATUS = {
  READY: "ready", // automated and good to go
  REVIEW: "review", // works, but a risky action needs owner approval first
  PENDING: "pending", // needs more input or a guided setup step
} as const;

/**
 * The provider-adapter interfaces in the framework. W8 adds a tenth,
 * LocalListingProvider, for Google Business Profile automation (the GBP verbs
 * route to it the same way every other verb routes to its owning interface).
 */
export type ProviderInterface =
  | "DomainProvider"
  | "DnsProvider"
  | "HostingProvider"
  | "GitHubProvider"
  | "EmailProvider"
  | "MessagingProvider"
  | "PaymentProvider"
  | "AnalyticsProvider"
  | "AgentProvider"
  | "LocalListingProvider";

/** Input to a server-plane action verb. Payload shape is per-verb (M3/M4). */
export interface ActionRequest {
  verb: string;
  business: Business;
  payload?: Record<string, unknown>;
}

/** Result of a server-plane action. Async vendors return a ref to poll (M3). */
export interface ActionResult {
  ok: boolean;
  detail: string;
  operationRef?: string;
}

/**
 * Provider-adapter contract.
 *
 * Every launch capability is modelled as an adapter so a simulated MVP can be
 * swapped for a real vendor integration without touching the UI.
 */
export interface ProviderAdapter {
  /** The provider-adapter interface this satisfies. */
  readonly interfaceName: ProviderInterface;
  /** The vendor/interface this maps to (human label). */
  readonly provider: string;
  /** True if its primary action needs owner sign-off (risky verb). */
  readonly approvalGated: boolean;
  /** Current action-plane mode for this adapter. */
  readonly mode: AdapterMode;

  /**
   * CLIENT readiness plane: pure, synchronous, secret-free. Safe to run in the
   * browser. Behaviour is ported verbatim from the prototype.
   */
  evaluate(business: Business): AdapterReadiness;

  /**
   * SERVER action plane: real, side-effecting verbs. In M0 every adapter's
   * action is a mock/no-op. Real implementations (M4) run server-only behind
   * the ActionRouter (M3). Stubs throw to make accidental M0 use obvious.
   */
  action(request: ActionRequest): Promise<ActionResult>;
}

/**
 * A checklist row in the dashboard's "Ready to publish" panel. This preserves
 * the prototype's launch-checklist contract (key/title/icon/evaluate) verbatim.
 */
export interface ChecklistAdapter {
  key: string;
  title: string;
  provider: string;
  interfaceName: ProviderInterface;
  approvalGated: boolean;
  simulated: boolean;
  evaluate(business: Business): AdapterReadiness;
}
