"use server";

// W8 — Google Business Profile (B1) server actions.
//
// Two surfaces, both tenant-scoped via requireTenant() (the client never
// supplies a tenant):
//   1. getListingAction — read the tenant's current listing + the single-source
//      NAP derived from the business profile (so the client step can show the
//      review screen without importing any server-only module).
//   2. runGbpGatedAction — gbp.create / gbp.sync. Mints + redeems a payload-bound
//      approval token through the ActionRouter (the single chokepoint), then on
//      accept persists/updates the tenant-owned LocalListing row.
//
// This module is a SERVER ACTION plane file: it imports the localListing service
// + the ActionRouter and is never statically imported by a client component —
// the GBP step calls these actions by reference.

import type { Business } from "@/lib/types";
import type { LocalListingRecord } from "@/lib/db/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { executeAction, readOperation } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import {
  deriveNap,
  napIsComplete,
  settleListingVerification,
  syncListing,
  upsertListingForCreate,
  type Nap,
} from "@/integrations/localListing/service";

export interface ListingView {
  nap: Nap;
  napComplete: boolean;
  listing: LocalListingRecord | null;
}

/**
 * Read the tenant's current listing + the single-source NAP derived from the
 * supplied business draft. No write, no charge. Lets the client GBP step render
 * the review + status without touching a server-only module.
 */
export async function getListingAction(
  business: Business,
): Promise<ListingView> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const nap = deriveNap(business);
  let listing = await repos.localListings.getPrimary(ctx.tenantId);

  // Drive the async verification lifecycle from the bound W1 operation: reading
  // the op reconciles it (mock: the timer settles pending → succeeded), so a
  // pending_verification listing flips to live (op succeeded) or failed (op
  // failed) on poll — the same read-driven settlement the rest of W1 uses. In
  // live mode the Google verification webhook settles the op instead.
  if (listing && listing.status === "pending_verification" && listing.operationId) {
    const op = await readOperation(listing.operationId, ctx.tenantId);
    if (op && op.status === "succeeded") {
      listing =
        (await settleListingVerification(
          repos,
          ctx.tenantId,
          listing.operationId,
          "live",
        )) ?? listing;
    } else if (op && op.status === "failed") {
      listing =
        (await settleListingVerification(
          repos,
          ctx.tenantId,
          listing.operationId,
          "failed",
        )) ?? listing;
    }
  }

  return { nap, napComplete: napIsComplete(nap), listing };
}

export type GbpVerb = "gbp.create" | "gbp.sync";

export interface RunGbpRequest {
  verb: GbpVerb;
  business: Business;
  /** Primary GBP category, e.g. "Plumber". */
  category: string;
  extraCategories?: string[];
  hours?: Record<string, unknown> | null;
  /** Step-up confirmation (the owner re-affirms intent). */
  stepUp: boolean;
}

export interface RunGbpResult {
  status: "accepted" | "allowed" | "denied";
  detail: string;
  operationId?: string;
  listing?: LocalListingRecord | null;
}

/**
 * Approve + run a gated GBP verb in one round-trip. Mirrors the approval-flow
 * split (mint token → redeem through the ActionRouter) but is GBP-specific so it
 * can persist/update the LocalListing on accept. All gating (entitlement +
 * single-use token) is enforced by executeAction.
 */
export async function runGbpGatedAction(
  request: RunGbpRequest,
): Promise<RunGbpResult> {
  const ctx = await requireTenant();
  const repos = await getRepositories();

  if (request.stepUp !== true) {
    await repos.audit.append(ctx.tenantId, {
      actorId: ctx.userId,
      action: "approval.denied",
      targetType: "approval",
      targetId: request.verb,
      metadata: { verb: request.verb, reason: "step_up_required" },
    });
    return { status: "denied", detail: "Step-up confirmation is required." };
  }

  const nap = deriveNap(request.business);
  if (!napIsComplete(nap)) {
    return {
      status: "denied",
      detail:
        "Add your business name, area, and a valid phone before listing on Google.",
    };
  }

  // The approval binds to the derived NAP + the chosen category (so a change to
  // any of them since approval re-requires sign-off). target = listing name.
  const payload: Record<string, unknown> = {
    name: nap.name,
    area: nap.area,
    phone: nap.phone,
    category: request.category,
  };

  const idempotencyKey = `${request.verb}:${ctx.tenantId}:${Date.now()}`;
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({
    verb: request.verb,
    payloadHash,
    idempotencyKey,
    nonce,
    expiresAt,
  });
  await recordIssued({
    nonce,
    tenantId: ctx.tenantId,
    verb: request.verb,
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
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      verb: request.verb,
      business: request.business,
      payload,
      idempotencyKey,
      approvalToken: token,
    },
  );

  if (outcome.status === "denied") {
    return { status: "denied", detail: outcome.detail };
  }

  // gbp.create is async (Google verification) → "accepted" with an op; the
  // listing is persisted pending_verification and settled live/failed by the op
  // (mock reconcile / live Google webhook). gbp.sync is sync → "allowed".
  let listing: LocalListingRecord | null = null;
  try {
    if (request.verb === "gbp.create" && outcome.status === "accepted") {
      const operationId = outcome.operation.id;
      if (outcome.operation.status !== "failed") {
        listing = await upsertListingForCreate(repos, {
          tenantId: ctx.tenantId,
          business: request.business,
          category: request.category,
          extraCategories: request.extraCategories,
          hours: request.hours ?? null,
          operationId,
        });
      }
      return {
        status: "accepted",
        detail: outcome.detail,
        operationId,
        listing,
      };
    }
    if (request.verb === "gbp.sync") {
      listing = await syncListing(repos, {
        tenantId: ctx.tenantId,
        business: request.business,
        category: request.category,
        extraCategories: request.extraCategories,
        hours: request.hours ?? null,
      });
    }
  } catch {
    // Persistence failure must not crash the action; the op/audit already exist.
  }

  return {
    status: outcome.status === "accepted" ? "accepted" : "allowed",
    detail: outcome.detail,
    listing,
  };
}
