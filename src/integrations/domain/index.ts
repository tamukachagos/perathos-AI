// DomainProvider adapter — the single public face of multi-domain (W4).
//
// SERVER-ONLY (imported by core/registry, never a client component). The
// readiness plane stays the pure `evaluateDomain`. The action plane now
// dispatches the gated+async verbs to the RegistrarRouter's backend, selected by
// TLD behind the dedicated hostname validator:
//   * domain.register / domain.renew → backend register/renew (metered upstream)
//   * domain.transfer                → backend transfer (auth-code based)
// A backend `ok` leaves the W1 operation pending (settled by reconcile/webhook);
// a backend rejection makes the ActionRouter settle the op to `failed`.
//
// checkAvailability is UNGATED + read-only and does NOT flow through here — it
// has its own server action (no wallet charge). The mock backends are
// deterministic + keyless; real registrars are dormant behind documented envs.

import type { AdapterMode } from "@/lib/types";
import { env } from "@/lib/env";
import { evaluateDomain } from "@/integrations/core/readiness";
import { logger } from "@/lib/logger";
import type {
  ActionRequest,
  ActionResult,
  ProviderAdapter,
} from "@/integrations/core/types";
import { selectRegistrar } from "./registrar/router";

const mode: AdapterMode = env.adapterMode;

async function dispatch(request: ActionRequest): Promise<ActionResult> {
  const payload = request.payload ?? {};
  const hostname = String(payload.domain ?? payload.hostname ?? "");
  const selected = selectRegistrar(hostname);
  if (!selected) {
    // The hostname failed the dedicated validator / has no registrar. Surface a
    // structured failure so the ActionRouter settles the op to `failed` (never
    // silent success). No PII / no auth code is logged.
    logger.warn("domain.dispatch_rejected", { verb: request.verb });
    return { ok: false, detail: "The domain name is invalid or unsupported." };
  }
  const { backend } = selected;

  switch (request.verb) {
    case "domain.register":
      return backend.register({
        hostname,
        autoRenew: Boolean(payload.autoRenew),
      });
    case "domain.renew":
      return backend.renew({ hostname });
    case "domain.transfer":
      // The auth code arrives as PLAINTEXT in the payload only for the dispatch
      // call (it was approved against this exact payload). It is persisted
      // ENCRYPTED by the service; here it is passed to the backend and never
      // logged.
      return backend.transfer({
        hostname,
        authCode: String(payload.authCode ?? ""),
      });
    default:
      return {
        ok: false,
        detail: `Unsupported domain verb "${request.verb}".`,
      };
  }
}

export const domainAdapter: ProviderAdapter = {
  interfaceName: "DomainProvider",
  provider: "RegistrarRouter (.co.za ZACR + .com gTLD reseller)",
  approvalGated: true,
  mode,
  evaluate: evaluateDomain,
  async action(request: ActionRequest): Promise<ActionResult> {
    if (mode === "mock") {
      return dispatch(request);
    }
    // Live/sandbox: the registrar backends are dormant in W4. A real build swaps
    // the mock backend for a live adapter behind the same interface; until then
    // a non-mock dispatch throws so accidental use is obvious (the ActionRouter
    // settles the op to `failed`).
    throw new Error(
      `DomainProvider.action("${request.verb}") has no live registrar backend wired (mode=${mode}).`,
    );
  },
};
