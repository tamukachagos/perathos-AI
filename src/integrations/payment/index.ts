import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluatePayments } from "@/integrations/core/readiness";

// Payment links (Paystack / Yoco / PayFast). Connecting a payout account is
// a risky verb → approval.
export const paymentAdapter = createMockAdapter({
  interfaceName: "PaymentProvider",
  provider: "Paystack / Yoco / PayFast",
  approvalGated: true,
  evaluate: evaluatePayments,
});
