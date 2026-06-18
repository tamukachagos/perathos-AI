import type { AdapterMode } from "@/lib/types";
import { env } from "@/lib/env";
import { evaluateProfile } from "@/integrations/core/readiness";
import type {
  ActionRequest,
  ActionResult,
  ProviderAdapter,
} from "@/integrations/core/types";
import { selectAgentProvider } from "./provider";

// Agent (Claude later): turns a plain-language intake into structured business
// data. Its readiness mirrors the profile completeness in M0. Unlike the other
// adapters it has a real (mock) action verb in M3 — `agent.generateProfile` —
// because the onboarding wizard calls it. It is NOT approval-gated (read-only,
// no side effects), so it does not flow through the ActionRouter's gate.
const mode: AdapterMode = env.adapterMode;

export const agentAdapter: ProviderAdapter = {
  interfaceName: "AgentProvider",
  provider: "Launch Desk",
  approvalGated: false,
  mode,
  evaluate: evaluateProfile,
  async action(request: ActionRequest): Promise<ActionResult> {
    if (request.verb === "agent.generateProfile") {
      // The wizard reads the structured profile via /api/agent/profile directly;
      // this verb is the adapter-plane mirror so the AgentProvider has a real
      // action. Both route through selectAgentProvider() — mock by default, and
      // the real provider (W3: via the LLM router) once an LLM key is set
      // (OPENROUTER_API_KEY or ANTHROPIC_API_KEY).
      const description = String(request.payload?.description ?? "");
      const { profile } = await selectAgentProvider().generateProfile(description);
      return {
        ok: true,
        detail: `Generated a draft profile for "${profile.name}".`,
      };
    }
    return {
      ok: true,
      detail: `[mock:AgentProvider] "${request.verb}" accepted (no-op).`,
    };
  },
};
