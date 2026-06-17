import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateAnalytics } from "@/integrations/core/readiness";

// Analytics (PostHog + GA4): visits, leads, WhatsApp clicks, payment clicks.
export const analyticsAdapter = createMockAdapter({
  interfaceName: "AnalyticsProvider",
  provider: "PostHog + GA4",
  approvalGated: false,
  evaluate: evaluateAnalytics,
});
