// Repository contracts for the M1 data-access layer.
//
// Two implementations satisfy these interfaces:
//   * an in-memory / mock impl (src/lib/db/memory.ts), seeded with the Maboneng
//     sample, used when there is no DATABASE_URL; and
//   * a Prisma/Postgres impl (src/lib/db/prisma/repositories.ts).
// The env-gated factory in src/lib/db/index.ts chooses between them.
//
// Every method is tenant-scoped: callers pass a `tenantId` resolved from the
// session (src/lib/authz.ts), which is the single app-layer scoping point. The
// Postgres impl additionally relies on RLS as a backstop.

import type { Business, PublishedSite } from "@/lib/types";
import type { PlanId } from "@/lib/billing/plans";

// --- Records -----------------------------------------------------------------

/** A persisted business profile (the editable draft). */
export interface BusinessRecord extends Business {
  id: string;
  tenantId: string;
}

/** A persisted published site = its slug, profile snapshot, and version. */
export interface SiteRecord {
  id: string;
  tenantId: string;
  businessId: string;
  slug: string;
  version: number;
  site: PublishedSite;
}

/** One entry in a site's append-only version history (for rollback). */
export interface SiteVersionRecord {
  id: string;
  tenantId: string;
  siteId: string;
  version: number;
  site: PublishedSite;
  createdAt: string;
  /** True when this version is the one currently published. */
  isCurrent: boolean;
}

/** A POPIA-compliant lead captured by a published site's lead form. */
export interface LeadRecord {
  id: string;
  tenantId: string;
  businessId: string;
  name: string;
  contact: string;
  message: string;
  purpose: string;
  consent: boolean;
  consentAt: string | null;
  marketingOptIn: boolean;
  retentionUntil: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type AdapterConnMode = "mock" | "sandbox" | "live";
export type AdapterConnStatus = "ready" | "review" | "pending";

export interface AdapterConnectionRecord {
  id: string;
  tenantId: string;
  interfaceName: string;
  mode: AdapterConnMode;
  status: AdapterConnStatus;
  state: Record<string, unknown> | null;
}

/**
 * A tenant's billing subscription (M6). One row per tenant (the active plan).
 * In mock mode this is simulated end-to-end; with Paystack keys the same shape
 * is driven by checkout + webhook events. Card data is NEVER stored here.
 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  plan: PlanId;
  status: SubscriptionStatus;
  /** ISO timestamp the current paid period ends (null for Free). */
  currentPeriodEnd: string | null;
  /** Billing provider, e.g. "mock" now, "paystack" once live. */
  provider: string;
  /** The provider's subscription id (e.g. Paystack subscription code). */
  providerSubscriptionId: string | null;
  /** When true, the subscription will not renew at period end. */
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

// --- Inputs ------------------------------------------------------------------

export interface LeadInput {
  businessId: string;
  name: string;
  contact: string;
  message?: string;
  purpose?: string;
  consent: boolean;
  consentAt?: string | null;
  marketingOptIn?: boolean;
  retentionUntil?: string | null;
}

export interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AdapterConnectionInput {
  interfaceName: string;
  mode?: AdapterConnMode;
  status?: AdapterConnStatus;
  state?: Record<string, unknown> | null;
}

/** Fields settable when creating/updating a tenant's subscription (M6). */
export interface SubscriptionInput {
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  provider?: string;
  providerSubscriptionId?: string | null;
  cancelAtPeriodEnd?: boolean;
}

// --- Repository interfaces (one per aggregate) -------------------------------

export interface BusinessRepository {
  list(tenantId: string): Promise<BusinessRecord[]>;
  get(tenantId: string, id: string): Promise<BusinessRecord | null>;
  /** The first/primary business for a tenant (the dashboard draft). */
  getPrimary(tenantId: string): Promise<BusinessRecord | null>;
  create(tenantId: string, business: Business): Promise<BusinessRecord>;
  /** Create or update the tenant's primary business from a draft profile. */
  upsertPrimary(tenantId: string, business: Business): Promise<BusinessRecord>;
  update(
    tenantId: string,
    id: string,
    business: Business,
  ): Promise<BusinessRecord>;
}

export interface SiteRepository {
  /** All published sites owned by a tenant. */
  listByTenant(tenantId: string): Promise<SiteRecord[]>;
  /** Read a published site by slug WITHOUT a tenant (public /s/[slug]). */
  getBySlug(slug: string): Promise<SiteRecord | null>;
  /**
   * Publish a site for a business: creates the site + a new version, or appends
   * a version to an existing site with the same slug.
   */
  publish(
    tenantId: string,
    businessId: string,
    site: PublishedSite,
  ): Promise<SiteRecord>;
  /** Full version history for a site (newest first), tenant-scoped. */
  listVersions(tenantId: string, siteId: string): Promise<SiteVersionRecord[]>;
  /**
   * Roll back a site to a prior version by appending a NEW version whose
   * snapshot is a copy of the target version's snapshot. History is never
   * rewritten; rollback is forward-only.
   */
  restoreVersion(
    tenantId: string,
    siteId: string,
    version: number,
  ): Promise<SiteRecord>;
}

export interface LeadRepository {
  create(tenantId: string, input: LeadInput): Promise<LeadRecord>;
  listByBusiness(tenantId: string, businessId: string): Promise<LeadRecord[]>;
  /**
   * POPIA retention purge: delete every lead whose `retentionUntil` is on or
   * before `asOf`, ACROSS ALL TENANTS (the Cron runs platform-wide, not within
   * a session). Returns the number deleted.
   */
  purgeExpired(asOf: Date): Promise<number>;
  /**
   * DSAR support: find every lead whose `contact` matches (case-insensitive,
   * trimmed), across all tenants — a data subject's identifier is global, not
   * tenant-scoped. Used to EXPORT a subject's records.
   */
  findByContact(contact: string): Promise<LeadRecord[]>;
  /**
   * DSAR erasure: delete every lead whose `contact` matches, across all
   * tenants. Returns the number deleted.
   */
  deleteByContact(contact: string): Promise<number>;
}

export interface AuditRepository {
  /** Append-only: records an event and returns it. */
  append(tenantId: string, input: AuditInput): Promise<AuditEntry>;
  list(tenantId: string): Promise<AuditEntry[]>;
}

export interface AdapterConnectionRepository {
  list(tenantId: string): Promise<AdapterConnectionRecord[]>;
  upsert(
    tenantId: string,
    input: AdapterConnectionInput,
  ): Promise<AdapterConnectionRecord>;
}

export interface SubscriptionRepository {
  /** The tenant's current subscription, or null if it has never had one. */
  get(tenantId: string): Promise<SubscriptionRecord | null>;
  /**
   * Create or replace the tenant's subscription (one per tenant). Used by the
   * upgrade flow and the webhook to set the plan + status.
   */
  upsert(
    tenantId: string,
    input: SubscriptionInput,
  ): Promise<SubscriptionRecord>;
  /**
   * Look a subscription up by the provider's subscription id, ACROSS tenants —
   * the webhook resolves the owning tenant from the provider id, not a session.
   */
  getByProviderId(
    provider: string,
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | null>;
}

/** The full data-access surface, assembled by the factory. */
export interface Repositories {
  businesses: BusinessRepository;
  sites: SiteRepository;
  leads: LeadRepository;
  audit: AuditRepository;
  adapterConnections: AdapterConnectionRepository;
  subscriptions: SubscriptionRepository;
}
