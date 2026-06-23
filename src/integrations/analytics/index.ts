// Analytics adapter — PostHog capture API (server-side, fetch-based).
//
// When POSTHOG_API_KEY is set, events are forwarded to the PostHog capture
// endpoint. Without it (local dev / CI) the mock adapter returns deterministic
// fake metrics so the dashboard and page components work without a real key.
//
// Usage:
//   import { getProvider } from "@/integrations/analytics";
//   void getProvider().trackEvent("site_pageview", { siteSlug: "maboneng" });

export type AnalyticsEventName =
  | "site_pageview"
  | "lead_captured"
  | "booking_created"
  | "payment_started"
  | "payment_completed";

export interface AnalyticsProperties {
  siteSlug?: string;
  industry?: string;
  location?: string;
  source?: string;
  path?: string;
  tenantId?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface AnalyticsMetrics {
  visits: number;
  leads: number;
  bookings: number;
  revenue: number;
  /** Daily visit counts for the last N days, oldest first */
  dailyVisits: number[];
  sourceBreakdown: {
    direct: number;
    whatsapp: number;
    google: number;
    other: number;
  };
}

export interface AnalyticsProvider {
  isConfigured(): boolean;
  trackEvent(event: AnalyticsEventName, properties: AnalyticsProperties): Promise<void>;
  getMetrics(tenantId: string, days?: number): Promise<AnalyticsMetrics>;
}

// ---------------------------------------------------------------------------
// Real PostHog adapter
// ---------------------------------------------------------------------------

const POSTHOG_HOST =
  process.env.POSTHOG_HOST ?? "https://app.posthog.com";

class PostHogAdapter implements AnalyticsProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  isConfigured(): boolean {
    return true;
  }

  async trackEvent(
    event: AnalyticsEventName,
    properties: AnalyticsProperties,
  ): Promise<void> {
    const distinct_id =
      properties.tenantId ?? properties.siteSlug ?? "anonymous";

    try {
      await fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          event,
          distinct_id,
          properties: {
            ...properties,
            $lib: "launch-desk-server",
          },
          timestamp: new Date().toISOString(),
        }),
        // Fire-and-forget friendly: short timeout so it never blocks a render
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Silently swallow — analytics must never break a page render
    }
  }

  async getMetrics(tenantId: string, days = 30): Promise<AnalyticsMetrics> {
    // PostHog's Query API requires a paid plan and is complex to aggregate
    // server-side. For now we return placeholder zeros so the dashboard renders;
    // a future milestone can wire up the PostHog Query API or pull from a
    // Postgres materialized view populated by webhook events.
    void tenantId;
    void days;
    return {
      visits: 0,
      leads: 0,
      bookings: 0,
      revenue: 0,
      dailyVisits: Array<number>(days).fill(0),
      sourceBreakdown: { direct: 0, whatsapp: 0, google: 0, other: 0 },
    };
  }
}

// ---------------------------------------------------------------------------
// Mock adapter (dev / CI — no POSTHOG_API_KEY)
// ---------------------------------------------------------------------------

/** Deterministic fake metrics so the dashboard always renders in dev. */
class MockAnalyticsAdapter implements AnalyticsProvider {
  isConfigured(): boolean {
    return false;
  }

  async trackEvent(
    _event: AnalyticsEventName,
    _properties: AnalyticsProperties,
  ): Promise<void> {
    // no-op in mock mode
  }

  async getMetrics(_tenantId: string, days = 30): Promise<AnalyticsMetrics> {
    // Seeded fake data so UI looks realistic in dev
    const seed = [12, 18, 9, 22, 30, 25, 14, 11, 17, 28, 35, 20, 8, 15, 19,
                   24, 31, 16, 10, 27, 33, 21, 13, 26, 29, 18, 22, 14, 20, 25];
    return {
      visits: 50,
      leads: 5,
      bookings: 2,
      revenue: 1800,
      dailyVisits: seed.slice(0, days),
      sourceBreakdown: { direct: 22, whatsapp: 14, google: 10, other: 4 },
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton selector
// ---------------------------------------------------------------------------

let _provider: AnalyticsProvider | null = null;

/** Returns the configured provider (PostHog if key present, mock otherwise). */
export function getProvider(): AnalyticsProvider {
  if (!_provider) {
    const apiKey = process.env.POSTHOG_API_KEY;
    _provider = apiKey ? new PostHogAdapter(apiKey) : new MockAnalyticsAdapter();
  }
  return _provider;
}

// ProviderAdapter-compatible export for the integration registry.
// The analytics-specific methods (trackEvent, getMetrics) are accessed via
// getProvider() directly; this object satisfies the registry's ProviderAdapter
// contract.
import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateAnalytics } from "@/integrations/core/readiness";

export const analyticsAdapter = createMockAdapter({
  interfaceName: "AnalyticsProvider",
  provider: "PostHog",
  approvalGated: false,
  evaluate: evaluateAnalytics,
});
