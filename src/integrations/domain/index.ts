import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateDomain } from "@/integrations/core/readiness";

// Domain registration (domains.co.za). Registering is a risky verb → approval.
export const domainAdapter = createMockAdapter({
  interfaceName: "DomainProvider",
  provider: "domains.co.za",
  approvalGated: true,
  evaluate: evaluateDomain,
});
