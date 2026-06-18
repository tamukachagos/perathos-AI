import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateLocalListing } from "@/integrations/core/readiness";

// W8 — Google Business Profile (B1). Listing/verification is a risky verb
// (public, verified presence) → approval-gated. Mock backend now; the real
// Google Business Profile API is dormant behind the documented GOOGLE_* env keys
// (see .env.example). gbp.create is async (Google verification settles via the
// W1 op / reconcile); gbp.sync pushes NAP/hours updates.
export const localListingAdapter = createMockAdapter({
  interfaceName: "LocalListingProvider",
  provider: "Google Business Profile (mock; GOOGLE_* later)",
  approvalGated: true,
  evaluate: evaluateLocalListing,
});
