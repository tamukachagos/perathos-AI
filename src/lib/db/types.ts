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
}

export interface LeadRepository {
  create(tenantId: string, input: LeadInput): Promise<LeadRecord>;
  listByBusiness(tenantId: string, businessId: string): Promise<LeadRecord[]>;
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

/** The full data-access surface, assembled by the factory. */
export interface Repositories {
  businesses: BusinessRepository;
  sites: SiteRepository;
  leads: LeadRepository;
  audit: AuditRepository;
  adapterConnections: AdapterConnectionRepository;
}
