// GitHub App live adapter (SERVER-ONLY). Activated when GITHUB_APP_ID +
// GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID are all set.
//
// Auth: RS256 JWT (10-min TTL) → installation access token. One token per call;
// no caching (tokens are cheap and serverless lambdas are stateless).
// All outbound calls go to api.github.com — the target is a hardcoded constant,
// not user-supplied, so no additional SSRF guard is required.

import { createSign } from "node:crypto";

function buildJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60, // 60s back for clock-skew tolerance
      exp: now + 600, // 10-minute TTL (GitHub's max)
      iss: appId,
    }),
  ).toString("base64url");
  const signing = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signing);
  return `${signing}.${signer.sign(privateKey, "base64url")}`;
}

async function getInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID!;
  // PEM keys stored as env vars may use literal `\n` instead of real newlines.
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID!;

  const jwt = buildJwt(appId, privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "launch-desk",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub App token: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "launch-desk",
  };
}

/**
 * Ensure a private repo exists under `org/slug`. Idempotent: HTTP 422 (already
 * exists) is silently accepted.
 */
export async function liveEnsureRepo(org: string, slug: string): Promise<void> {
  const token = await getInstallationToken();
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      name: slug,
      private: true,
      auto_init: true,
      description: `Launch Desk site: ${slug}`,
    }),
  });
  // 422 = repo already exists; treat as success.
  if (!res.ok && res.status !== 422) {
    throw new Error(`GitHub createRepo (${slug}): ${res.status} ${await res.text()}`);
  }
}

/**
 * Commit a `site-version.json` recording the published version + content hash.
 * Returns the real commit SHA from GitHub.
 *
 * Steps: resolve HEAD → get base tree → create blob → create tree →
 *        create commit → fast-forward main.
 */
export async function liveCommitVersion(
  org: string,
  slug: string,
  version: number,
  payloadHash: string,
): Promise<string> {
  const token = await getInstallationToken();
  const repo = `${org}/${slug}`;
  const base = `https://api.github.com/repos/${repo}`;

  // 1. Resolve HEAD SHA on main.
  const refRes = await fetch(`${base}/git/ref/heads/main`, { headers: ghHeaders(token) });
  if (!refRes.ok) {
    throw new Error(`GitHub getRef (${slug}): ${refRes.status} ${await refRes.text()}`);
  }
  const {
    object: { sha: headSha },
  } = (await refRes.json()) as { object: { sha: string } };

  // 2. Get the base tree SHA from the HEAD commit.
  const headRes = await fetch(`${base}/git/commits/${headSha}`, { headers: ghHeaders(token) });
  if (!headRes.ok) {
    throw new Error(`GitHub getCommit (${slug}): ${headRes.status}`);
  }
  const {
    tree: { sha: baseTreeSha },
  } = (await headRes.json()) as { tree: { sha: string } };

  // 3. Create a blob for the version metadata file.
  const fileContent = JSON.stringify({ slug, version, payloadHash }, null, 2);
  const blobRes = await fetch(`${base}/git/blobs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ content: fileContent, encoding: "utf-8" }),
  });
  if (!blobRes.ok) {
    throw new Error(`GitHub createBlob (${slug}): ${blobRes.status}`);
  }
  const { sha: blobSha } = (await blobRes.json()) as { sha: string };

  // 4. Create a new tree containing the version file.
  const treeRes = await fetch(`${base}/git/trees`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [{ path: "site-version.json", mode: "100644", type: "blob", sha: blobSha }],
    }),
  });
  if (!treeRes.ok) {
    throw new Error(`GitHub createTree (${slug}): ${treeRes.status}`);
  }
  const { sha: newTreeSha } = (await treeRes.json()) as { sha: string };

  // 5. Create the commit.
  const commitRes = await fetch(`${base}/git/commits`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: `publish: site v${version} (${payloadHash.slice(0, 8)})`,
      tree: newTreeSha,
      parents: [headSha],
    }),
  });
  if (!commitRes.ok) {
    throw new Error(`GitHub createCommit (${slug}): ${commitRes.status}`);
  }
  const { sha: newCommitSha } = (await commitRes.json()) as { sha: string };

  // 6. Fast-forward main to the new commit.
  const updateRes = await fetch(`${base}/git/refs/heads/main`, {
    method: "PATCH",
    headers: ghHeaders(token),
    body: JSON.stringify({ sha: newCommitSha }),
  });
  if (!updateRes.ok) {
    throw new Error(`GitHub updateRef (${slug}): ${updateRes.status}`);
  }

  return newCommitSha;
}

/**
 * Merge a pull request identified by URL (e.g. "https://github.com/org/repo/pull/42").
 * Uses squash merge. HTTP 405 (already merged) is treated as success.
 */
export async function liveMergePr(
  org: string,
  repoSlug: string,
  prUrl: string,
): Promise<void> {
  const match = /\/pull\/(\d+)$/.exec(prUrl);
  if (!match) throw new Error(`Cannot parse PR number from "${prUrl}"`);
  const prNumber = match[1];

  const token = await getInstallationToken();
  const res = await fetch(
    `https://api.github.com/repos/${org}/${repoSlug}/pulls/${prNumber}/merge`,
    {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({ merge_method: "squash" }),
    },
  );
  // 405 = already merged; treat as success.
  if (!res.ok && res.status !== 405) {
    throw new Error(`GitHub mergePR (${repoSlug}#${prNumber}): ${res.status} ${await res.text()}`);
  }
}
