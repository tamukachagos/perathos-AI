// W6 (mock) — GitHub per-customer repo + the publish -> commit -> deploy chain.
//
// Asserts:
//   * github.createRepo (ensureSiteRepo) creates ONE tenant-owned repo record
//     under the operator org, idempotent on (tenant, slug).
//   * github.commit records a deterministic commit sha tied to the version.
//   * runPublishChain commits + triggers an async deploy (a Deployment row bound
//     to a pending W1 operation).

import { beforeEach, describe, expect, it } from "vitest";
import { memoryRepositories, __resetMemoryStore } from "@/lib/db/memory";
import { __resetApprovalStore } from "@/integrations/core/approvalStore";
import { __resetOperationStore } from "@/integrations/core/operationStore";
import { DEV_TENANT_ID } from "@/lib/db/seed";
import { initialBusiness } from "@/lib/platformData";
import {
  commitPublish,
  ensureSiteRepo,
  operatorOrg,
  repoRefForSlug,
} from "./service";
import { runPublishChain } from "@/lib/publishPipeline";

const repos = memoryRepositories;
const TENANT = DEV_TENANT_ID;

describe("W6 github service (mock)", () => {
  beforeEach(() => {
    __resetMemoryStore();
    __resetApprovalStore();
    __resetOperationStore();
  });

  it("github.createRepo creates one tenant-owned repo record under the operator org", async () => {
    const repo = await ensureSiteRepo(repos, TENANT, "joes-shop");
    expect(repo.tenantId).toBe(TENANT);
    expect(repo.slug).toBe("joes-shop");
    expect(repo.repoRef).toBe(`${operatorOrg()}/joes-shop`);
    expect(repo.repoRef).toBe(repoRefForSlug("joes-shop"));
    expect(repo.repoUrl).toContain("github.com");
    expect(repo.defaultBranch).toBe("main");

    // Idempotent on (tenant, slug): a re-create reuses the same repo.
    const again = await ensureSiteRepo(repos, TENANT, "joes-shop");
    expect(again.id).toBe(repo.id);
    expect(await repos.siteRepos.list(TENANT)).toHaveLength(1);
  });

  it("github.commit records a deterministic commit sha tied to the version", async () => {
    const a = await commitPublish(repos, {
      tenantId: TENANT,
      slug: "joes-shop",
      version: 1,
      payloadHash: "hash-1",
    });
    expect(a.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(a.repo.lastCommitSha).toBe(a.commitSha);

    // Deterministic: same inputs => same sha; different version => different sha.
    const a2 = await commitPublish(repos, {
      tenantId: TENANT,
      slug: "joes-shop",
      version: 1,
      payloadHash: "hash-1",
    });
    expect(a2.commitSha).toBe(a.commitSha);
    const b = await commitPublish(repos, {
      tenantId: TENANT,
      slug: "joes-shop",
      version: 2,
      payloadHash: "hash-1",
    });
    expect(b.commitSha).not.toBe(a.commitSha);
  });

  it("publish chain commits + triggers an async deploy bound to a pending op", async () => {
    const result = await runPublishChain(repos, {
      tenantId: TENANT,
      actorId: "user-1",
      business: initialBusiness,
      slug: "joes-shop",
      version: 1,
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.deployOperationId).toBeTruthy();
    expect(result.deploymentId).toBeTruthy();

    // A repo record now exists with the commit sha recorded.
    const repo = await repos.siteRepos.getBySlug(TENANT, "joes-shop");
    expect(repo?.lastCommitSha).toBe(result.commitSha);

    // A Deployment row is bound to the async op, starting queued (NOT live yet —
    // the webhook/cron settles it).
    const deployment = await repos.deployments.getLatestBySlug(TENANT, "joes-shop");
    expect(deployment).not.toBeNull();
    expect(deployment?.status).toBe("queued");
    expect(deployment?.target).toBe("static");
    expect(deployment?.operationId).toBe(result.deployOperationId);
    expect(deployment?.version).toBe(1);
  });
});
