import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateEmail } from "@/integrations/core/readiness";

// Business email (Zoho / Google). Provisioning mailboxes is gated → approval.
export const emailAdapter = createMockAdapter({
  interfaceName: "EmailProvider",
  provider: "Zoho / Google adapter",
  approvalGated: true,
  evaluate: evaluateEmail,
});
