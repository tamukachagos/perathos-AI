import { createMockAdapter } from "@/integrations/core/mockAdapter";
import { evaluateGithub } from "@/integrations/core/readiness";

// Version history (GitHub App): every publish is versioned and rollbackable.
export const githubAdapter = createMockAdapter({
  interfaceName: "GitHubProvider",
  provider: "GitHub App",
  approvalGated: false,
  evaluate: evaluateGithub,
});
