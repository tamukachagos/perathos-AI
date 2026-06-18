// W6 — Custom-domain mapping (SERVER-ONLY, §5.3).
//
// Ties a W4-registered domain to the deployed site:
//   * a gated `dns.write` (Cloudflare CNAME/A, mock) through the ActionRouter
//     (entitlement `customDomain`), AND
//   * the Vercel domains API (mock) to attach the hostname to the project.
//
// Both flow through the SINGLE chokepoint: dns.write is a GATED + SYNC verb in
// GATED_VERBS (interface DnsProvider, requiresEntitlement customDomain), so a
// free tenant is denied BEFORE the token is even checked. The Vercel attach is a
// mock no-op in W6 (the real Vercel domains API is dormant behind VERCEL_*).
//
// SERVER-ONLY: imports the registry chokepoint + approval minting. Never imported
// by a client component — the client calls the server action by reference.

import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import type { Business } from "@/lib/types";
import type { Repositories } from "@/lib/db/types";
import { vercelProjectForSlug } from "./service";
import { logger } from "@/lib/logger";

export interface ConnectCustomDomainResult {
  status: "connected" | "denied";
  detail: string;
}

/**
 * Connect a (W4-registered) custom domain to a deployed site. Runs the gated
 * `dns.write` through the ActionRouter (entitlement-checked), then the mock
 * Vercel domains attach. The DNS payload binds the domain + the records being
 * written so the approval covers exactly this change.
 */
export async function connectCustomDomain(
  repos: Repositories,
  params: {
    tenantId: string;
    actorId: string | null;
    business: Business;
    slug: string;
    hostname: string;
  },
): Promise<ConnectCustomDomainResult> {
  const { tenantId, actorId, business, slug, hostname } = params;

  // The DNS payload the approval binds to: a CNAME from the custom hostname to
  // the Vercel project (the StaticTier target).
  const payload: Record<string, unknown> = {
    domain: hostname,
    records: [{ type: "CNAME", name: hostname, value: `${vercelProjectForSlug(slug)}.vercel.app` }],
  };
  const idempotencyKey = `dns.write:${tenantId}:${hostname}:${slug}`;
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({
    verb: "dns.write",
    payloadHash,
    idempotencyKey,
    nonce,
    expiresAt,
  });
  await recordIssued({
    nonce,
    tenantId,
    verb: "dns.write",
    payloadHash,
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
      verb: "dns.write",
      business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );

  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }

  // Mock Vercel domains attach (the real API is dormant behind VERCEL_*). In
  // mock mode this is a no-op confirmation; nothing here is logged with PII.
  logger.info("hosting.customDomain.attached", {
    slug,
    mode: "mock",
  });

  return {
    status: "connected",
    detail: `${hostname} is connected — DNS records staged and the domain is mapped to your site.`,
  };
}
