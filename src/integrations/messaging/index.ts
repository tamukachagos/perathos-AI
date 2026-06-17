import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateWhatsapp } from "@/integrations/core/readiness";

// Messaging (WhatsApp click-to-chat now; Meta/BSP later). Click-to-chat is free.
export const messagingAdapter = createMockAdapter({
  interfaceName: "MessagingProvider",
  provider: "Click-to-chat (Meta/BSP later)",
  approvalGated: false,
  evaluate: evaluateWhatsapp,
});
