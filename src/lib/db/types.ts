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

// --- W4 multi-domain ---------------------------------------------------------

/** The domain lifecycle, mirroring the Prisma DomainStatus enum. */
export type DomainStatus =
  | "requested"
  | "pending_registration"
  | "transfer_pending"
  | "active"
  | "expiring"
  | "failed"
  | "released";

/** The registrar backend kind a domain routes to (TLD-derived, server-side). */
export type DomainRegistrar = "za" | "gtld";

/**
 * A tenant-owned domain (registrar-agnostic). `authCode` is stored ENCRYPTED
 * (AES-256-GCM ciphertext string) — never plaintext, never logged. The repo
 * never decrypts; only the server action plane does, at transfer dispatch.
 */
export interface DomainRecord {
  id: string;
  tenantId: string;
  businessId: string | null;
  hostname: string;
  status: DomainStatus;
  tld: string | null;
  registrar: DomainRegistrar | null;
  registrarRef: string | null;
  autoRenew: boolean;
  expiresAt: string | null;
  /** ENCRYPTED auth-code ciphertext (or null). NEVER plaintext. */
  authCode: string | null;
  costCents: number | null;
  priceCents: number | null;
  operationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields settable when creating a domain at request time. */
export interface DomainInput {
  businessId?: string | null;
  hostname: string;
  status?: DomainStatus;
  tld?: string | null;
  registrar?: DomainRegistrar | null;
  registrarRef?: string | null;
  autoRenew?: boolean;
  expiresAt?: string | null;
  /** Pass the ALREADY-ENCRYPTED ciphertext (the action plane encrypts first). */
  authCode?: string | null;
  costCents?: number | null;
  priceCents?: number | null;
  operationId?: string | null;
}

/** Fields settable when updating a domain (e.g. status on settlement). */
export interface DomainUpdate {
  status?: DomainStatus;
  registrarRef?: string | null;
  autoRenew?: boolean;
  expiresAt?: string | null;
  authCode?: string | null;
  operationId?: string | null;
}

// --- W8 Google Business Profile (B1) -----------------------------------------

/**
 * The GBP listing lifecycle. Google verification is ASYNC: a freshly created
 * listing is `pending_verification` until Google confirms ownership (mock: the
 * W1 reconcile sweep settles it), then `live`. A rejected/failed verification
 * lands `failed`. `draft` is the pre-submit state before `gbp.create`.
 */
export type LocalListingStatus =
  | "draft"
  | "pending_verification"
  | "live"
  | "failed";

/**
 * A tenant-owned Google Business Profile listing. The NAP (Name / Address-area /
 * Phone) is the SINGLE SOURCE derived from the Business profile and reused both
 * on-site (JSON-LD) and pushed to GBP — so the listing carries a snapshot of it.
 * `googleLocationId` / `operationId` link the async create/verify lifecycle.
 */
export interface LocalListingRecord {
  id: string;
  tenantId: string;
  businessId: string | null;
  /** NAP — Name. */
  name: string;
  /** NAP — Address/service area (SA SMBs are often area-based, not a street). */
  area: string;
  /** NAP — Phone (E.164-ish, derived from the business WhatsApp/phone). */
  phone: string;
  /** GBP primary + additional categories (e.g. "Plumber"). */
  categories: string[];
  /** Opening hours, free-form JSON (per-day ranges); null when not set. */
  hours: Record<string, unknown> | null;
  status: LocalListingStatus;
  /** The Google location resource id once created (mock: synthetic). */
  googleLocationId: string | null;
  /** The async W1 operation that creates/verifies this listing. */
  operationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalListingInput {
  businessId?: string | null;
  name: string;
  area: string;
  phone: string;
  categories?: string[];
  hours?: Record<string, unknown> | null;
  status?: LocalListingStatus;
  googleLocationId?: string | null;
  operationId?: string | null;
}

export interface LocalListingUpdate {
  name?: string;
  area?: string;
  phone?: string;
  categories?: string[];
  hours?: Record<string, unknown> | null;
  status?: LocalListingStatus;
  googleLocationId?: string | null;
  operationId?: string | null;
}

// --- W8 WhatsApp commerce (B2) -----------------------------------------------

/** A catalog product offered over WhatsApp. priceCents is ZAR cents (BigInt). */
export interface ProductRecord {
  id: string;
  tenantId: string;
  businessId: string | null;
  name: string;
  description: string;
  /** ZAR cents. BigInt end-to-end (the column is BigInt) — never widened. */
  priceCents: bigint;
  imageUrl: string | null;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  businessId?: string | null;
  name: string;
  description?: string;
  priceCents: bigint;
  imageUrl?: string | null;
  available?: boolean;
}

export interface ProductUpdate {
  name?: string;
  description?: string;
  priceCents?: bigint;
  imageUrl?: string | null;
  available?: boolean;
}

/** The WhatsApp order lifecycle. */
export type WhatsappOrderStatus =
  | "draft"
  | "sent"
  | "paid"
  | "fulfilled"
  | "canceled";

/** One line item snapshot inside an order (price captured at order time). */
export interface WhatsappOrderItem {
  productId: string;
  name: string;
  quantity: number;
  /** Unit price in ZAR cents at order time. */
  priceCents: number;
}

/** A tenant-owned order captured over WhatsApp. totalCents is ZAR cents. */
export interface WhatsappOrderRecord {
  id: string;
  tenantId: string;
  businessId: string | null;
  /** Customer WhatsApp contact (E.164-ish). */
  customerContact: string;
  items: WhatsappOrderItem[];
  /** ZAR cents. BigInt end-to-end. */
  totalCents: bigint;
  status: WhatsappOrderStatus;
  /** The PaymentLink id this order was billed through, when a link was created. */
  paymentLinkRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappOrderInput {
  businessId?: string | null;
  customerContact: string;
  items: WhatsappOrderItem[];
  totalCents: bigint;
  status?: WhatsappOrderStatus;
  paymentLinkRef?: string | null;
}

export interface WhatsappOrderUpdate {
  items?: WhatsappOrderItem[];
  totalCents?: bigint;
  status?: WhatsappOrderStatus;
  paymentLinkRef?: string | null;
}

// --- W6 GitHub + Vercel per-customer repos & deploys -------------------------

/**
 * One operator-owned private GitHub repo per customer site (§5.3). GitHub is the
 * single source of truth; the owner never sees Git — this record is surfaced as
 * "history". `repoRef` is the backend id (mock: synthetic; live: "owner/name");
 * `lastCommitSha` ties the most recent publish (a commit) to its site_version.
 */
export interface SiteRepoRecord {
  id: string;
  tenantId: string;
  slug: string;
  repoRef: string;
  repoUrl: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteRepoInput {
  slug: string;
  repoRef: string;
  repoUrl: string;
  defaultBranch?: string;
  lastCommitSha?: string | null;
}

export interface SiteRepoUpdate {
  repoRef?: string;
  repoUrl?: string;
  defaultBranch?: string;
  lastCommitSha?: string | null;
}

/** The StaticTier (Vercel) deploy lifecycle, mirroring the Prisma enum. */
export type DeploymentStatus = "queued" | "building" | "live" | "failed";

/**
 * One StaticTier deploy attempt for a site (§5.2 StaticTier; container/K8s are
 * Phase 3). A deploy is gated + async: `operationId` links the W1 operation the
 * Vercel webhook (or the reconcile cron in mock) settles to live/failed. `url`
 * is the live deployment URL once it settles; `version` ties it to the
 * site_versions snapshot it published (deploy↔commit↔version).
 */
export interface DeploymentRecord {
  id: string;
  tenantId: string;
  slug: string;
  /** Deploy target tier. W6 ships "static" only. */
  target: string;
  status: DeploymentStatus;
  url: string | null;
  operationId: string | null;
  version: number | null;
  /** Vendor-side deployment id, correlating the inbound Vercel webhook. */
  providerDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentInput {
  slug: string;
  target?: string;
  status?: DeploymentStatus;
  url?: string | null;
  operationId?: string | null;
  version?: number | null;
  providerDeploymentId?: string | null;
}

export interface DeploymentUpdate {
  status?: DeploymentStatus;
  url?: string | null;
  operationId?: string | null;
  providerDeploymentId?: string | null;
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

// --- W2 metering wallet records ----------------------------------------------

/**
 * A tenant's prepaid credit wallet (one per tenant). `balanceMicro` is in ZAR
 * MICRO-CENTS (1 cent = 1_000 micro; R1 = 100_000 micro) so per-token retail
 * prices stay exact. It is a `bigint` end-to-end (the column is BigInt) — never
 * widened to `number`, so very large balances never lose precision.
 */
export interface WalletRecord {
  id: string;
  tenantId: string;
  balanceMicro: bigint;
  updatedAt: string;
}

/** One metered event in the append-only usage ledger. All amounts micro-cents. */
export interface UsageRecordRow {
  id: string;
  tenantId: string;
  /** e.g. "llm.profile.extract" | "hosting.cpu_hour" | "domain.register". */
  kind: string;
  quantity: number;
  unitCostMicro: bigint;
  unitPriceMicro: bigint;
  amountMicro: bigint;
  /** Billing period, "YYYY-MM". */
  period: string;
  idempotencyKey: string;
  createdAt: string;
}

export type InvoiceStatus = "open" | "paid" | "void";

/** A period's usage rolled into a single invoice. One per (tenant, period). */
export interface InvoiceRecord {
  id: string;
  tenantId: string;
  period: string;
  totalMicro: bigint;
  status: InvoiceStatus;
  providerInvoiceId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for appending a usage record (the metering service builds this). */
export interface UsageRecordInput {
  kind: string;
  quantity: number;
  unitCostMicro: bigint;
  unitPriceMicro: bigint;
  amountMicro: bigint;
  period: string;
  idempotencyKey: string;
}

/**
 * The result of an atomic debit. `applied` is false when the idempotencyKey was
 * already seen (a no-op that returns the prior balance + record — never a
 * second debit). `record` is the usage row (existing one on a duplicate).
 */
export interface DebitResult {
  applied: boolean;
  balanceMicro: bigint;
  record: UsageRecordRow;
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

export interface DomainRepository {
  /** All domains owned by a tenant (newest first). */
  list(tenantId: string): Promise<DomainRecord[]>;
  /** Read a domain by hostname, tenant-scoped (null if not this tenant's). */
  getByHostname(tenantId: string, hostname: string): Promise<DomainRecord | null>;
  /** Create a tenant-owned domain at request time (bound to tenantId here). */
  create(tenantId: string, input: DomainInput): Promise<DomainRecord>;
  /** Update mutable fields (status/expiry/ref) on settlement, tenant-scoped. */
  update(
    tenantId: string,
    id: string,
    update: DomainUpdate,
  ): Promise<DomainRecord>;
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

// --- W2 metering wallet repositories -----------------------------------------

export interface WalletRepository {
  /** The tenant's wallet balance in ZAR micro-cents (0 if no wallet yet). */
  getBalance(tenantId: string): Promise<bigint>;
  /** Read the wallet row (null if the tenant has never had a wallet). */
  get(tenantId: string): Promise<WalletRecord | null>;
  /**
   * Credit the wallet by `amountMicro` (a top-up / monthly grant). Creates the
   * wallet on first credit. Returns the new balance.
   */
  credit(tenantId: string, amountMicro: bigint): Promise<bigint>;
  /**
   * ATOMICALLY append a usage record AND debit the wallet by amountMicro, keyed
   * EXACTLY-ONCE on (tenantId, input.idempotencyKey). A duplicate key is a
   * no-op: it returns the prior record + balance with `applied:false` (never a
   * second debit). Single statement-set in one transaction so the usage row and
   * the balance change commit or roll back together.
   */
  debit(tenantId: string, input: UsageRecordInput): Promise<DebitResult>;
}

export interface UsageRepository {
  /** Append a usage record WITHOUT touching the wallet (debit does both). */
  append(tenantId: string, input: UsageRecordInput): Promise<UsageRecordRow>;
  /** All usage rows for a tenant in a period (newest first). */
  listByPeriod(tenantId: string, period: string): Promise<UsageRecordRow[]>;
  /** A tenant's most recent usage rows across all periods (newest first). */
  listRecent(tenantId: string, limit?: number): Promise<UsageRecordRow[]>;
}

export interface InvoiceRepository {
  /** Read a tenant's invoice for a period, or null. */
  get(tenantId: string, period: string): Promise<InvoiceRecord | null>;
  /** Create or update the rolled invoice for a period. One per (tenant, period). */
  upsert(
    tenantId: string,
    period: string,
    totalMicro: bigint,
    status?: InvoiceStatus,
    providerInvoiceId?: string | null,
  ): Promise<InvoiceRecord>;
  /** All of a tenant's invoices (newest period first). */
  list(tenantId: string): Promise<InvoiceRecord[]>;
}

// --- W8 repositories ---------------------------------------------------------

export interface LocalListingRepository {
  /** All listings owned by a tenant (newest first). */
  list(tenantId: string): Promise<LocalListingRecord[]>;
  /** Read a listing by id, tenant-scoped (null if not this tenant's). */
  get(tenantId: string, id: string): Promise<LocalListingRecord | null>;
  /** The tenant's primary (first) listing, or null. */
  getPrimary(tenantId: string): Promise<LocalListingRecord | null>;
  create(tenantId: string, input: LocalListingInput): Promise<LocalListingRecord>;
  update(
    tenantId: string,
    id: string,
    update: LocalListingUpdate,
  ): Promise<LocalListingRecord>;
}

export interface ProductRepository {
  /** All products owned by a tenant (newest first). */
  list(tenantId: string): Promise<ProductRecord[]>;
  get(tenantId: string, id: string): Promise<ProductRecord | null>;
  create(tenantId: string, input: ProductInput): Promise<ProductRecord>;
  update(
    tenantId: string,
    id: string,
    update: ProductUpdate,
  ): Promise<ProductRecord>;
}

export interface WhatsappOrderRepository {
  /** All orders owned by a tenant (newest first). */
  list(tenantId: string): Promise<WhatsappOrderRecord[]>;
  get(tenantId: string, id: string): Promise<WhatsappOrderRecord | null>;
  create(
    tenantId: string,
    input: WhatsappOrderInput,
  ): Promise<WhatsappOrderRecord>;
  update(
    tenantId: string,
    id: string,
    update: WhatsappOrderUpdate,
  ): Promise<WhatsappOrderRecord>;
}

// --- W6 repositories ---------------------------------------------------------

export interface SiteRepoRepository {
  /** All repos owned by a tenant (newest first). */
  list(tenantId: string): Promise<SiteRepoRecord[]>;
  /** Read the repo backing a site by slug, tenant-scoped (null if none). */
  getBySlug(tenantId: string, slug: string): Promise<SiteRepoRecord | null>;
  /**
   * Ensure a repo exists for (tenant, slug): returns the existing one or creates
   * it. Idempotent on (tenantId, slug) — one repo per customer site.
   */
  ensure(tenantId: string, input: SiteRepoInput): Promise<SiteRepoRecord>;
  /** Update mutable fields (e.g. lastCommitSha on a publish), tenant-scoped. */
  update(
    tenantId: string,
    id: string,
    update: SiteRepoUpdate,
  ): Promise<SiteRepoRecord>;
}

export interface DeploymentRepository {
  /** All deployments owned by a tenant (newest first). */
  list(tenantId: string): Promise<DeploymentRecord[]>;
  /** A site's deployments (newest first), tenant-scoped. */
  listBySlug(tenantId: string, slug: string): Promise<DeploymentRecord[]>;
  /** The latest deployment for a site, or null. */
  getLatestBySlug(tenantId: string, slug: string): Promise<DeploymentRecord | null>;
  /** Read a deployment by id, tenant-scoped. */
  get(tenantId: string, id: string): Promise<DeploymentRecord | null>;
  /** Create a deployment row at deploy request time (bound to tenantId here). */
  create(tenantId: string, input: DeploymentInput): Promise<DeploymentRecord>;
  /** Update mutable fields (status/url) on settlement, tenant-scoped. */
  update(
    tenantId: string,
    id: string,
    update: DeploymentUpdate,
  ): Promise<DeploymentRecord>;
  /**
   * Read a deployment by its async operation id, tenant-scoped. The Vercel
   * webhook resolves the deploy from the operation it settles.
   */
  getByOperationId(
    tenantId: string,
    operationId: string,
  ): Promise<DeploymentRecord | null>;
  /**
   * Resolve the owning {tenantId, deploymentId} for a vendor-side
   * providerDeploymentId, ACROSS tenants (the signed Vercel webhook has no
   * session). Returns null when unknown. Under Postgres FORCE RLS this routes
   * through a tightly-scoped SECURITY DEFINER function (the W1 pattern); the
   * webhook then settles INSIDE that tenant's scope.
   */
  resolveByProviderDeploymentId(
    providerDeploymentId: string,
  ): Promise<{ tenantId: string; deploymentId: string } | null>;
}

/** The full data-access surface, assembled by the factory. */
export interface Repositories {
  businesses: BusinessRepository;
  sites: SiteRepository;
  leads: LeadRepository;
  audit: AuditRepository;
  domains: DomainRepository;
  adapterConnections: AdapterConnectionRepository;
  subscriptions: SubscriptionRepository;
  wallet: WalletRepository;
  usage: UsageRepository;
  invoices: InvoiceRepository;
  localListings: LocalListingRepository;
  products: ProductRepository;
  whatsappOrders: WhatsappOrderRepository;
  siteRepos: SiteRepoRepository;
  deployments: DeploymentRepository;
}
