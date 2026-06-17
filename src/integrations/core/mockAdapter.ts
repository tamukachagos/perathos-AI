// Factory for a MOCK ProviderAdapter. The action plane is a no-op/throwing stub
// in M0 — real side-effecting verbs land in M4 behind the ActionRouter (M3).

import type { AdapterMode, AdapterReadiness, Business } from "@/lib/types";
import { env } from "@/lib/env";
import type {
  ActionRequest,
  ActionResult,
  ProviderAdapter,
  ProviderInterface,
} from "./types";

export interface MockAdapterSpec {
  interfaceName: ProviderInterface;
  provider: string;
  approvalGated: boolean;
  evaluate(business: Business): AdapterReadiness;
}

export function createMockAdapter(spec: MockAdapterSpec): ProviderAdapter {
  const mode: AdapterMode = env.adapterMode;

  return {
    interfaceName: spec.interfaceName,
    provider: spec.provider,
    approvalGated: spec.approvalGated,
    mode,
    evaluate: spec.evaluate,
    async action(request: ActionRequest): Promise<ActionResult> {
      // M0: no real side effects exist yet. Mock mode is a safe no-op; any
      // other mode is not wired in this milestone.
      if (mode === "mock") {
        return {
          ok: true,
          detail: `[mock:${spec.interfaceName}] "${request.verb}" accepted (no-op in M0).`,
        };
      }
      throw new Error(
        `${spec.interfaceName}.action("${request.verb}") not implemented in M0 (mode=${mode}).`,
      );
    },
  };
}
