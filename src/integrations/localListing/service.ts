// W8 — Google Business Profile (B1) service (SERVER-ONLY orchestration).
//
// The thin layer between the server actions / ActionRouter and the
// localListings repo. It owns:
//   * the SINGLE-SOURCE NAP mapping (Name / Address-area / Phone derived from
//     the existing Business profile — the same source already used on-site in
//     the LocalBusiness JSON-LD, now also pushed to GBP), and
//   * the listing lifecycle (draft → pending_verification → live | failed).
//
// SERVER-ONLY by convention (it is reached only via server actions / the
// ActionRouter adapter). It is dependency-light (no node:crypto, no network in
// mock mode), but it is NOT imported by any client component — the GBP step
// imports the server actions by reference.
//
// Verbs:
//   * gbp.create — gated + ASYNC (Google verification is async; the W1 op
//     settles it). Mock: the reconcile sweep drives pending_verification → live.
//   * gbp.sync   — gated, sync; pushes NAP/hours/category updates to GBP.

import type { Business } from "@/lib/types";
import type {
  LocalListingInput,
  LocalListingRecord,
  Repositories,
} from "@/lib/db/types";
import { isFilled, normalizeWhatsapp } from "@/lib/format";

/**
 * The single-source NAP derived from the Business profile. This is the ONE place
 * the listing's Name/Area/Phone come from — the same fields the site's
 * LocalBusiness JSON-LD already uses, so the on-site presence and the GBP
 * listing never disagree.
 */
export interface Nap {
  name: string;
  /** Service area / address (SA SMBs are commonly area-based). */
  area: string;
  /** Phone in international form (27XXXXXXXXX) when derivable, else as typed. */
  phone: string;
}

/**
 * Derive the NAP from the business profile. Name ← business.name; Area ←
 * business.location; Phone ← the normalised WhatsApp number (the SA SMB's de
 * facto phone — already the click-to-chat source), falling back to the raw
 * value when it is not a recognisable SA mobile.
 */
export function deriveNap(business: Business): Nap {
  const normalized = normalizeWhatsapp(business.whatsapp);
  const phone =
    isFilled(normalized) && /^\d{6,15}$/.test(normalized)
      ? normalized
      : (business.whatsapp ?? "").trim();
  return {
    name: (business.name ?? "").trim(),
    area: (business.location ?? "").trim(),
    phone,
  };
}

/** A NAP is complete enough to list when Name + Area + Phone are all present. */
export function napIsComplete(nap: Nap): boolean {
  return isFilled(nap.name) && isFilled(nap.area) && isFilled(nap.phone);
}

export interface ListingDispatchInput {
  tenantId: string;
  business: Business;
  category: string;
  /** Additional categories beyond the primary (optional). */
  extraCategories?: string[];
  hours?: Record<string, unknown> | null;
  /** The W1 operation id this listing is bound to (set after startOperation). */
  operationId?: string | null;
  businessId?: string | null;
}

/**
 * Persist (or update) the tenant-owned LocalListing row at gbp.create request
 * time, bound to tenantId here, with the single-source NAP and a
 * `pending_verification` status (Google verification is async). Idempotent on
 * the tenant's primary listing: a retry updates it rather than duplicating.
 */
export async function upsertListingForCreate(
  repos: Repositories,
  input: ListingDispatchInput,
): Promise<LocalListingRecord> {
  const nap = deriveNap(input.business);
  const categories = [
    input.category,
    ...(input.extraCategories ?? []),
  ].filter((c) => isFilled(c));

  const base: LocalListingInput = {
    businessId: input.businessId ?? null,
    name: nap.name,
    area: nap.area,
    phone: nap.phone,
    categories,
    hours: input.hours ?? null,
    status: "pending_verification",
    operationId: input.operationId ?? null,
  };

  const existing = await repos.localListings.getPrimary(input.tenantId);
  if (existing) {
    return repos.localListings.update(input.tenantId, existing.id, {
      name: base.name,
      area: base.area,
      phone: base.phone,
      categories: base.categories,
      hours: base.hours,
      status: "pending_verification",
      operationId: input.operationId ?? existing.operationId,
    });
  }
  return repos.localListings.create(input.tenantId, base);
}

/**
 * Push a NAP/hours/category update for gbp.sync. Re-derives the single-source
 * NAP from the (possibly edited) business and writes it to the listing without
 * changing its verification status. No-op (defensive) when there is no listing.
 */
export async function syncListing(
  repos: Repositories,
  input: ListingDispatchInput,
): Promise<LocalListingRecord | null> {
  const existing = await repos.localListings.getPrimary(input.tenantId);
  if (!existing) return null;
  const nap = deriveNap(input.business);
  const categories = [
    input.category,
    ...(input.extraCategories ?? []),
  ].filter((c) => isFilled(c));
  return repos.localListings.update(input.tenantId, existing.id, {
    name: nap.name,
    area: nap.area,
    phone: nap.phone,
    categories: categories.length > 0 ? categories : existing.categories,
    hours: input.hours ?? existing.hours,
  });
}

/**
 * Settle a listing's verification outcome from the W1 operation status. Called
 * when an operation tracking a gbp.create reaches a terminal state: a
 * `succeeded` op → `live` (verified) with a (mock) googleLocationId; a `failed`
 * op → `failed`. Tenant-scoped + idempotent (re-settling to the same state is a
 * no-op write). In live mode the Google verification webhook drives this.
 */
export async function settleListingVerification(
  repos: Repositories,
  tenantId: string,
  operationId: string,
  outcome: "live" | "failed",
): Promise<LocalListingRecord | null> {
  const listings = await repos.localListings.list(tenantId);
  const listing = listings.find((l) => l.operationId === operationId);
  if (!listing) return null;
  if (listing.status === outcome) return listing;
  return repos.localListings.update(tenantId, listing.id, {
    status: outcome,
    googleLocationId:
      outcome === "live"
        ? listing.googleLocationId ?? `mock-loc-${listing.id}`
        : listing.googleLocationId,
  });
}
