// GitHubProvider adapter — the single public face of the per-customer repo (W6).
//
// SERVER-ONLY (imported by core/registry, never a client component). The
// readiness plane stays the pure `evaluateGithub` ("every publish is versioned,
// rollbackable"). The action plane handles the two W6 verbs:
//   * github.createRepo — ensure one operator-owned private repo per site
//   * github.commit     — a publish becomes a commit
//
// These verbs are UNGATED (a publish is the owner's own already-authorized
// action; the deploy that follows is the gated/async one). The actual
// persistence — the per-customer repo record + lastCommitSha tied to
// site_versions — is done by the github service, called from the publish path
// (src/lib/publishPipeline.ts), which holds the repos + tenant. The adapter's
// action plane is the registry-facing surface; in mock mode it confirms the
// verb, and the real GitHub App is dormant behind GITHUB_APP_* (a non-mock
// dispatch throws so accidental use is obvious).

import type { AdapterMode } from "@/lib/types";
import { env } from "@/lib/env";
import { evaluateGithub } from "@/integrations/core/readiness";
import type {
  ActionRequest,
  ActionResult,
  ProviderAdapter,
} from "@/integrations/core/types";
import { isGithubAppConfigured, operatorOrg, repoRefForSlug } from "./service";
import { liveEnsureRepo, liveMergePr } from "./liveService";

const mode: AdapterMode = env.adapterMode;

function dispatch(request: ActionRequest): ActionResult {
  const payload = request.payload ?? {};
  const slug = String(payload.slug ?? "");
  switch (request.verb) {
    case "github.createRepo":
      return {
        ok: true,
        detail: `[mock:GitHubProvider] repo ${repoRefForSlug(slug)} ready.`,
      };
    case "github.commit":
      return {
        ok: true,
        detail: `[mock:GitHubProvider] commit recorded for ${repoRefForSlug(slug)}.`,
      };
    case "github.mergePR": {
      // W7 — merge a PR the agent team opened. Reaches here only AFTER the
      // ActionRouter has verified the owner-minted approval token (the agent
      // cannot self-approve). The PR url is the target.
      const prUrl = String(payload.prUrl ?? payload.branch ?? "");
      return {
        ok: true,
        detail: `[mock:GitHubProvider] merged ${prUrl || "the team's pull request"}.`,
      };
    }
    case "agent.applyContent":
      // W7 — apply an AUTO-tier content/copy swap. The change is a commit on the
      // customer's repo (the rollback target); the deploy that follows is the
      // gated/async agent.deployFix.
      return {
        ok: true,
        detail: `[mock:GitHubProvider] content update applied for ${repoRefForSlug(slug)}.`,
      };
    default:
      return { ok: false, detail: `Unsupported github verb "${request.verb}".` };
  }
}

export const githubAdapter: ProviderAdapter = {
  interfaceName: "GitHubProvider",
  provider: "GitHub App (launchdesk-sites org)",
  approvalGated: false,
  mode,
  evaluate: evaluateGithub,
  async action(request: ActionRequest): Promise<ActionResult> {
    if (mode === "mock") {
      return dispatch(request);
    }
    // Live: real GitHub App — activated when GITHUB_APP_* env vars are set.
    if (!isGithubAppConfigured()) {
      return {
        ok: false,
        detail: `GitHubProvider: GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID not set.`,
      };
    }
    const payload = request.payload ?? {};
    const slug = String(payload.slug ?? "");
    const org = operatorOrg();
    try {
      switch (request.verb) {
        case "github.createRepo":
          await liveEnsureRepo(org, slug);
          return { ok: true, detail: `Repo ${repoRefForSlug(slug)} ready.` };
        case "github.commit":
          // Real commit is driven by commitPublish() in service.ts (called from
          // the publish pipeline). The adapter verb is a confirmation only.
          return { ok: true, detail: `Version committed for ${repoRefForSlug(slug)}.` };
        case "github.mergePR": {
          const prUrl = String(payload.prUrl ?? payload.branch ?? "");
          await liveMergePr(org, slug, prUrl);
          return { ok: true, detail: `Merged PR at ${prUrl}.` };
        }
        case "agent.applyContent":
          return { ok: true, detail: `Content update applied for ${repoRefForSlug(slug)}.` };
        default:
          return { ok: false, detail: `Unsupported github verb "${request.verb}".` };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: msg };
    }
  },
};
