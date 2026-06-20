// W6 — GitHub service (SERVER-ONLY orchestration for the per-customer repo).
//
// Repo-per-customer, operator-owned (§5.3): one private repo per customer site
// under the operator org (launchdesk-sites/{slug}). GitHub is the SINGLE SOURCE
// OF TRUTH; the owner never sees Git — a publish becomes a commit, surfaced to
// the owner as "history" + "undo" (tied to the existing site_versions).
//
// SERVER-ONLY: imports node:crypto (synthetic sha) + the repos. Reached only via
// server actions / the publish path / the ActionRouter adapter, never by a
// client component. Two verbs:
//   * github.createRepo — ensure one operator-owned private repo per site.
//   * github.commit     — a publish becomes a commit (records lastCommitSha,
//                         tied to the site_versions version it published).
//
// The real GitHub App is DORMANT behind GITHUB_APP_* (see .env.example). In mock
// mode the repo ref + commit sha are deterministic + keyless, so the whole
// publish -> commit -> deploy chain is exercisable with no keys.

import { createHash } from "node:crypto";
import type { Repositories, SiteRepoRecord } from "@/lib/db/types";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { liveEnsureRepo, liveCommitVersion } from "./liveService";

/** The operator org repos live under. Overridable via GITHUB_APP_ORG. */
export function operatorOrg(): string {
  return process.env.GITHUB_APP_ORG?.trim() || "launchdesk-sites";
}

/** The operator-side repo reference, e.g. "launchdesk-sites/joes-shop". */
export function repoRefForSlug(slug: string): string {
  return `${operatorOrg()}/${slug}`;
}

/**
 * Whether the real GitHub App is configured. When false (the default) the
 * service runs the deterministic mock; when true a future live adapter takes
 * over behind the same surface. We never read the private key here — only the
 * action plane would, server-side, and it is never logged.
 */
export function isGithubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_APP_INSTALLATION_ID,
  );
}

/**
 * `github.createRepo` — ensure ONE operator-owned private repo exists for this
 * customer site, persisting a per-customer repo record (tenantId, slug, repoRef,
 * repoUrl, defaultBranch). Idempotent on (tenant, slug): a re-publish reuses the
 * repo. In mock mode the repo is synthetic (no network); the real GitHub App
 * adapter is dormant behind GITHUB_APP_*.
 */
export async function ensureSiteRepo(
  repos: Repositories,
  tenantId: string,
  slug: string,
): Promise<SiteRepoRecord> {
  const repoRef = repoRefForSlug(slug);
  const repoUrl = `https://github.com/${repoRef}`;
  const record = await repos.siteRepos.ensure(tenantId, {
    slug,
    repoRef,
    repoUrl,
    defaultBranch: "main",
  });
  if (isGithubAppConfigured()) {
    await liveEnsureRepo(operatorOrg(), slug);
  }
  logger.info("github.createRepo", {
    slug,
    mode: env.adapterMode,
    live: isGithubAppConfigured(),
    created: record.lastCommitSha === null,
  });
  return record;
}

/**
 * Compute a deterministic, content-addressed commit sha for a publish. In mock
 * mode this stands in for GitHub's commit sha; in live mode the GitHub App
 * returns the real sha and this is unused. Deterministic so a test (and the UI)
 * can correlate a version with its commit without a network call.
 */
export function mockCommitSha(
  slug: string,
  version: number,
  payloadHash: string,
): string {
  return createHash("sha1")
    .update(`${slug}:${version}:${payloadHash}`)
    .digest("hex");
}

export interface CommitResult {
  repo: SiteRepoRecord;
  commitSha: string;
}

/**
 * `github.commit` — a publish becomes a commit. Ensures the repo exists, records
 * the new commit sha on the repo record (the rollback target + the agent team's
 * working surface), and returns it. `version` ties the commit to the
 * site_versions snapshot it published (deploy↔commit↔version). PII-free logging.
 */
export async function commitPublish(
  repos: Repositories,
  params: {
    tenantId: string;
    slug: string;
    version: number;
    /** Content hash of the published snapshot (drives the deterministic sha). */
    payloadHash: string;
  },
): Promise<CommitResult> {
  const repo = await ensureSiteRepo(repos, params.tenantId, params.slug);
  const commitSha = isGithubAppConfigured()
    ? await liveCommitVersion(operatorOrg(), params.slug, params.version, params.payloadHash)
    : mockCommitSha(params.slug, params.version, params.payloadHash);
  const updated = await repos.siteRepos.update(params.tenantId, repo.id, {
    lastCommitSha: commitSha,
  });
  logger.info("github.commit", {
    slug: params.slug,
    version: params.version,
    mode: env.adapterMode,
    live: isGithubAppConfigured(),
  });
  return { repo: updated, commitSha };
}
