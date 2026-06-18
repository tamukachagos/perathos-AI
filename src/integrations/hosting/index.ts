// HostingProvider adapter — StaticTier (Vercel) deploy target (W6 / §5.2).
//
// SERVER-ONLY (imported by core/registry, never a client component). The
// readiness plane stays the pure `evaluateSite`. The action plane handles:
//   * hosting.publish — gated + SYNC (existing M3 verb; confirms the publish).
//   * hosting.deploy  — gated + ASYNC: create/use a Vercel project + deploy hook
//                       for the repo. On `ok` the ActionRouter leaves the W1 op
//                       PENDING; the signed Vercel webhook (or the reconcile
//                       cron in mock) settles it to live/failed. The Deployment
//                       row is persisted by the publish path (which holds repos).
//
// hosting.deploy is NOT metered in W6 (static is plan-included, §8) — its
// estimate is 0. The real Vercel API is DORMANT behind VERCEL_* (a non-mock
// dispatch throws so accidental use is obvious). Container/K8s tiers are Phase 3.

import type { AdapterMode } from "@/lib/types";
import { env } from "@/lib/env";
import { evaluateSite } from "@/integrations/core/readiness";
import type {
  ActionRequest,
  ActionResult,
  ProviderAdapter,
} from "@/integrations/core/types";
import { isVercelConfigured, vercelProjectForSlug } from "./service";

const mode: AdapterMode = env.adapterMode;

function dispatch(request: ActionRequest): ActionResult {
  const payload = request.payload ?? {};
  const slug = String(payload.slug ?? "");
  switch (request.verb) {
    case "hosting.publish":
      return {
        ok: true,
        detail: `[mock:HostingProvider] "${slug}" published.`,
      };
    case "hosting.deploy":
    case "agent.deployFix":
      // Async: returning ok leaves the W1 op pending; the Vercel webhook (mock:
      // reconcile sweep) settles it to live. operationRef is informational.
      // W7 agent.deployFix rides the same StaticTier deploy plane as a manual
      // hosting.deploy — a deploy is a deploy regardless of who proposed it.
      return {
        ok: true,
        detail: `[mock:HostingProvider] deploy queued on Vercel project ${vercelProjectForSlug(slug)}.`,
      };
    default:
      return { ok: false, detail: `Unsupported hosting verb "${request.verb}".` };
  }
}

export const hostingAdapter: ProviderAdapter = {
  interfaceName: "HostingProvider",
  provider: "Vercel (StaticTier)",
  approvalGated: true,
  mode,
  evaluate: evaluateSite,
  async action(request: ActionRequest): Promise<ActionResult> {
    if (mode === "mock") {
      return dispatch(request);
    }
    // Live/sandbox: the Vercel API is dormant in W6. A real build swaps the mock
    // for a live adapter behind the same interface; until then a non-mock
    // dispatch throws so accidental use is obvious (the ActionRouter settles the
    // op to `failed`).
    throw new Error(
      `HostingProvider.action("${request.verb}") has no live Vercel API wired (mode=${mode}, configured=${isVercelConfigured()}).`,
    );
  },
};
