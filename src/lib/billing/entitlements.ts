// M6 — Pure entitlement checks (no auth / no request context).
//
// Split out of entitlementGuard.ts so modules that must stay free of the Auth.js
// import chain (e.g. the ActionRouter, and Vitest unit tests) can check
// entitlements without pulling in next-auth. The request-scoped throwing guards
// (requireEntitlement / requireSiteCapacity) live in entitlementGuard.ts.

import type { Repositories } from "@/lib/db/types";
import { entitlementsForSubscription } from "@/lib/billing/service";

/** A boolean capability key on the Entitlements map. */
export type FeatureKey =
  | "customDomain"
  | "removeBranding"
  | "payments"
  | "prioritySupport";

/** User-facing rationale for each gated feature. */
export const FEATURE_MESSAGE: Record<FeatureKey, string> = {
  customDomain:
    "Connecting a custom .co.za domain requires the Growth plan or higher.",
  removeBranding:
    'Removing the "Powered by Launch Desk" badge requires the Growth plan or higher.',
  payments: "Collecting payments requires the Growth plan or higher.",
  prioritySupport: "Priority support is available on the Pro plan.",
};

export class EntitlementError extends Error {
  readonly code = "entitlement_required";
  readonly feature: string;
  constructor(feature: string, message: string) {
    super(message);
    this.name = "EntitlementError";
    this.feature = feature;
  }
}

/**
 * Non-throwing check for callers that already hold the subscriptions repo +
 * tenantId (e.g. the ActionRouter). Takes only the subscriptions repo so the
 * caller need not assemble a full Repositories object.
 */
export async function checkEntitlement(
  subscriptionsRepo: Repositories["subscriptions"],
  tenantId: string,
  feature: FeatureKey,
): Promise<{ allowed: boolean; detail: string }> {
  const sub = await subscriptionsRepo.get(tenantId);
  const entitlements = entitlementsForSubscription(sub);
  return entitlements[feature]
    ? { allowed: true, detail: "ok" }
    : { allowed: false, detail: FEATURE_MESSAGE[feature] };
}
