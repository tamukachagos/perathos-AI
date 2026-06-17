// M6 — Server-side entitlement enforcement (request-scoped guards).
//
// requireEntitlement(...) is the single server gate for paid features: custom
// domain connect, branding removal, and the per-plan site-count cap. It mirrors
// the UI gating (both resolve via the plan catalog) so the browser and the
// server never disagree — the server is authoritative.
//
// Server-only: resolves the current tenant via requireTenant() and its
// subscription via the repository. Runs in mock mode (in-memory repo) unchanged.
// The PURE check (checkEntitlement) + types live in ./entitlements so the
// ActionRouter can use them without importing the Auth.js chain.

import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import type { Entitlements } from "@/lib/billing/plans";
import { getEntitlements } from "@/lib/billing/service";
import {
  EntitlementError,
  FEATURE_MESSAGE,
  type FeatureKey,
} from "@/lib/billing/entitlements";

export { EntitlementError, checkEntitlement } from "@/lib/billing/entitlements";
export type { FeatureKey } from "@/lib/billing/entitlements";

/**
 * Assert the current tenant's plan unlocks `feature`. Throws EntitlementError
 * when it does not. Returns the resolved entitlements so callers can reuse them.
 */
export async function requireEntitlement(
  feature: FeatureKey,
): Promise<Entitlements> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const entitlements = await getEntitlements(repos, ctx.tenantId);
  if (!entitlements[feature]) {
    throw new EntitlementError(feature, FEATURE_MESSAGE[feature]);
  }
  return entitlements;
}

/**
 * Assert the tenant may publish ANOTHER site (i.e. is below maxSites). Pass the
 * current published-site count. Throws EntitlementError when the cap is hit.
 */
export async function requireSiteCapacity(
  currentSiteCount: number,
): Promise<Entitlements> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const entitlements = await getEntitlements(repos, ctx.tenantId);
  if (currentSiteCount >= entitlements.maxSites) {
    throw new EntitlementError(
      "maxSites",
      `Your plan allows ${entitlements.maxSites} site${
        entitlements.maxSites === 1 ? "" : "s"
      }. Upgrade to publish more.`,
    );
  }
  return entitlements;
}
