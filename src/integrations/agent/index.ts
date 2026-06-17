import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateProfile } from "@/integrations/core/readiness";

// Agent (Claude later): turns a plain-language intake into structured business
// data. Its readiness mirrors the profile completeness in M0.
export const agentAdapter = createMockAdapter({
  interfaceName: "AgentProvider",
  provider: "Launch Desk",
  approvalGated: false,
  evaluate: evaluateProfile,
});
