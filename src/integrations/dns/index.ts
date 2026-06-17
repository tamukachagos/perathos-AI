import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateDns } from "@/integrations/core/readiness";

// DNS record management (Cloudflare). Writes are a risky verb → approval.
export const dnsAdapter = createMockAdapter({
  interfaceName: "DnsProvider",
  provider: "Cloudflare",
  approvalGated: true,
  evaluate: evaluateDns,
});
