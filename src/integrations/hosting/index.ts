import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateSite } from "@/integrations/core/readiness";

// Static/ISR site hosting (Vercel/SA). Publishing is gated in M3 via the router.
export const hostingAdapter = createMockAdapter({
  interfaceName: "HostingProvider",
  provider: "Hosting adapter (Vercel/SA)",
  approvalGated: false,
  evaluate: evaluateSite,
});
