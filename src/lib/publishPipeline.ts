// W6 — Publish -> commit -> deploy chain (SERVER-ONLY, §5.3).
//
// Extends the M2 publish path so publishing a site:
//   (a) writes the site_version (the existing repos.sites.publish), then
//   (b) github.commit's it to the per-customer repo (the rollback target + the
//       agent team's working surface, tied to the version), then
//   (c) triggers hosting.deploy (gated + ASYNC through the ActionRouter) and
//       persists a Deployment row bound to the W1 operation.
//
// The deploy is a GATED verb, but publishing is the owner's own already-intended
// action, so this mints + redeems a payload-bound, single-use approval token
// through the ActionRouter (the SAME chokepoint + gating as any manual action,
// mirroring runDomainGatedAction) rather than bypassing it. hosting.deploy is
// not metered in W6 (static is plan-included, §8 → estimate 0), so it never
// needs an entitlement or the wallet.
//
// In mock mode the chain simulates end-to-end and the reconcile cron / mock
// webhook settles the deploy to `live`. The commit + deploy are best-effort: a
// failure here NEVER fails the publish (the site_version is already written) —
// it is logged and surfaced via the deploy status, not thrown.
//
// SERVER-ONLY: imports the registry chokepoint (executeAction) + the github /
// hosting services. Never imported by a client component.

import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import { commitPublish } from "@/integrations/github/service";
import { createDeployment } from "@/integrations/hosting/service";
import type { Business } from "@/lib/types";
import type { Repositories } from "@/lib/db/types";
import { logger } from "@/lib/logger";

export interface PublishChainResult {
  /** The recorded commit sha for this publish (mock: deterministic). */
  commitSha: string | null;
  /** The async deploy operation id, when a deploy was started. */
  deployOperationId: string | null;
  /** The Deployment row id, when one was created. */
  deploymentId: string | null;
}

/**
 * Run the commit + deploy steps AFTER the site_version has been written. Safe to
 * call unconditionally from the publish action: every step is wrapped so a
 * failure degrades gracefully (the publish has already succeeded).
 */
export async function runPublishChain(
  repos: Repositories,
  params: {
    tenantId: string;
    actorId: string | null;
    business: Business;
    slug: string;
    version: number;
  },
): Promise<PublishChainResult> {
  const { tenantId, actorId, business, slug, version } = params;
  const result: PublishChainResult = {
    commitSha: null,
    deployOperationId: null,
    deploymentId: null,
  };

  // (b) github.commit — a publish becomes a commit on the per-customer repo.
  // The payload hash binds the commit sha to the published snapshot identity.
  let payloadHash: string;
  try {
    payloadHash = digestPayload({ slug, version });
    const commit = await commitPublish(repos, {
      tenantId,
      slug,
      version,
      payloadHash,
    });
    result.commitSha = commit.commitSha;
  } catch (error) {
    logger.warn("publish.commit_failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
    return result; // no commit => no deploy; the publish itself still stands.
  }

  // (c) hosting.deploy — gated + ASYNC through the ActionRouter. Mint + redeem a
  // payload-bound single-use token (the same chokepoint as a manual action), so
  // the deploy is gated, audited, and 202-tracked exactly like every risky verb.
  try {
    const payload: Record<string, unknown> = { slug };
    const idempotencyKey = `hosting.deploy:${tenantId}:${slug}:${version}`;
    const deployHash = digestPayload(payload);
    const nonce = mintNonce();
    const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
    const token = issueToken({
      verb: "hosting.deploy",
      payloadHash: deployHash,
      idempotencyKey,
      nonce,
      expiresAt,
    });
    await recordIssued({
      nonce,
      tenantId,
      verb: "hosting.deploy",
      payloadHash: deployHash,
      idempotencyKey,
      issuedAt: Date.now(),
      expiresAt,
    });

    const outcome = await executeAction(
      {
        audit: repos.audit,
        subscriptions: repos.subscriptions,
        wallet: repos.wallet,
      },
      {
        tenantId,
        actorId,
        verb: "hosting.deploy",
        business,
        payload,
        idempotencyKey,
        approvalToken: token,
      },
    );

    if (outcome.status === "accepted") {
      result.deployOperationId = outcome.operation.id;
      // Persist the Deployment row bound to the async op. A dispatch that already
      // settled to `failed` is recorded as failed; otherwise it starts `queued`
      // and the webhook/cron settles it to live.
      const deployment = await createDeployment(repos, {
        tenantId,
        slug,
        operationId: outcome.operation.id,
        version,
        status: outcome.operation.status === "failed" ? "failed" : "queued",
      });
      result.deploymentId = deployment.id;
    } else {
      logger.warn("publish.deploy_not_accepted", {
        slug,
        status: outcome.status,
      });
    }
  } catch (error) {
    logger.warn("publish.deploy_failed", {
      errorClass: error instanceof Error ? error.name : "unknown",
    });
  }

  return result;
}
