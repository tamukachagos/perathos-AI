// Prisma/Postgres implementation of the repository contracts.
//
// Selected by the factory only when DATABASE_URL is set. Every tenant-owned
// operation runs through withTenant(), so the RLS policies scope it at the DB
// layer in addition to the explicit tenantId filters here (defence in depth).

import type { Prisma } from "@prisma/client";
import type { Business, PublishedSite } from "@/lib/types";
import type {
  AdapterConnectionInput,
  AdapterConnectionRecord,
  AuditEntry,
  AuditInput,
  BusinessRecord,
  DebitResult,
  DeploymentInput,
  DeploymentRecord,
  DeploymentUpdate,
  DomainInput,
  DomainRecord,
  DomainUpdate,
  InvoiceRecord,
  InvoiceStatus,
  LeadInput,
  LeadRecord,
  LocalListingInput,
  LocalListingRecord,
  LocalListingUpdate,
  ProductInput,
  ProductRecord,
  ProductUpdate,
  Repositories,
  SiteRecord,
  SiteRepoInput,
  SiteRepoRecord,
  SiteRepoUpdate,
  SiteVersionRecord,
  SubscriptionInput,
  SubscriptionRecord,
  UsageRecordInput,
  UsageRecordRow,
  WalletRecord,
  WhatsappOrderInput,
  WhatsappOrderItem,
  WhatsappOrderRecord,
  WhatsappOrderUpdate,
} from "../types";
import type { PlanId } from "@/lib/billing/plans";
import { prisma, withTenant } from "./client";

// --- Row → record mappers ----------------------------------------------------

interface BusinessRow {
  id: string;
  tenantId: string;
  name: string;
  industry: string;
  location: string;
  whatsapp: string;
  domainName: string;
  email: string;
  tone: string;
  offer: string;
  services: string;
}

function toBusinessRecord(row: BusinessRow): BusinessRecord {
  // The Business contract uses `domain`; the column is `domainName` (because
  // `domain` is a relation on the model). Map at this boundary only.
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    industry: row.industry,
    location: row.location,
    whatsapp: row.whatsapp,
    domain: row.domainName,
    email: row.email,
    tone: row.tone,
    offer: row.offer,
    services: row.services,
  };
}

function toBusinessData(business: Business) {
  return {
    name: business.name,
    industry: business.industry,
    location: business.location,
    whatsapp: business.whatsapp,
    domainName: business.domain,
    email: business.email,
    tone: business.tone,
    offer: business.offer,
    services: business.services,
  };
}

// --- Repositories ------------------------------------------------------------

const businesses = {
  async list(tenantId: string): Promise<BusinessRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.business.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    );
    return rows.map(toBusinessRecord);
  },
  async get(tenantId: string, id: string): Promise<BusinessRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.business.findFirst({ where: { id, tenantId } }),
    );
    return row ? toBusinessRecord(row) : null;
  },
  async getPrimary(tenantId: string): Promise<BusinessRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.business.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    );
    return row ? toBusinessRecord(row) : null;
  },
  async create(tenantId: string, business: Business): Promise<BusinessRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.business.create({ data: { tenantId, ...toBusinessData(business) } }),
    );
    return toBusinessRecord(row);
  },
  async upsertPrimary(
    tenantId: string,
    business: Business,
  ): Promise<BusinessRecord> {
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.business.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      });
      const row = existing
        ? await tx.business.update({
            where: { id: existing.id },
            data: toBusinessData(business),
          })
        : await tx.business.create({
            data: { tenantId, ...toBusinessData(business) },
          });
      return toBusinessRecord(row);
    });
  },
  async update(
    tenantId: string,
    id: string,
    business: Business,
  ): Promise<BusinessRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.business.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error(`Business ${id} not found for tenant`);
      return tx.business.update({ where: { id }, data: toBusinessData(business) });
    });
    return toBusinessRecord(row);
  },
};

interface SiteRow {
  id: string;
  tenantId: string;
  businessId: string;
  slug: string;
  currentVersion: { version: number; snapshot: unknown } | null;
}

function toSiteRecord(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    slug: row.slug,
    version: row.currentVersion?.version ?? 1,
    site: row.currentVersion?.snapshot as PublishedSite,
  };
}

const sites = {
  async listByTenant(tenantId: string): Promise<SiteRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.generatedSite.findMany({
        where: { tenantId },
        include: { currentVersion: true },
      }),
    );
    return rows.filter((r) => r.currentVersion).map(toSiteRecord);
  },
  async getBySlug(slug: string): Promise<SiteRecord | null> {
    // Public route: no tenant in context. S7 — the slug is unique PER TENANT
    // now (not globally), so we resolve the single PUBLISHED site bearing it.
    // Restricting to status='published' keeps drafts from leaking and gives a
    // deterministic public match. B5/W1: the public_read_published RLS policy
    // (and public_read_published_versions for the snapshot) makes this
    // base-client read return the row even under FORCE ROW LEVEL SECURITY with
    // no tenant in context.
    const row = await prisma.generatedSite.findFirst({
      where: { slug, status: "published" },
      include: { currentVersion: true },
    });
    if (!row || !row.currentVersion) return null;
    return toSiteRecord(row);
  },
  async publish(
    tenantId: string,
    businessId: string,
    site: PublishedSite,
  ): Promise<SiteRecord> {
    const snapshot = site as unknown as Prisma.InputJsonValue;
    const row = await withTenant(tenantId, async (tx) => {
      // S7: resolve the existing site SCOPED TO THIS TENANT (slug is unique per
      // tenant now). A different tenant's same-slug site is not matched here, so
      // it can neither be overwritten nor squat this tenant's slug. The explicit
      // tenantId filter is belt-and-braces with the withTenant RLS scope.
      const existing = await tx.generatedSite.findFirst({
        where: { slug: site.slug, tenantId },
        include: { currentVersion: true },
      });

      if (existing) {
        // Verify ownership before versioning (S7) — never version another
        // tenant's row even if a future query change widened the match.
        if (existing.tenantId !== tenantId) {
          throw new Error(`Site ${site.slug} is owned by another tenant`);
        }
        const nextVersion = (existing.currentVersion?.version ?? 0) + 1;
        const version = await tx.siteVersion.create({
          data: { tenantId, siteId: existing.id, version: nextVersion, snapshot },
        });
        const updated = await tx.generatedSite.update({
          where: { id: existing.id },
          data: {
            status: "published",
            publishedAt: new Date(),
            currentVersionId: version.id,
          },
          include: { currentVersion: true },
        });
        return updated;
      }

      const created = await tx.generatedSite.create({
        data: {
          tenantId,
          businessId,
          slug: site.slug,
          status: "published",
          publishedAt: new Date(),
        },
      });
      const version = await tx.siteVersion.create({
        data: { tenantId, siteId: created.id, version: 1, snapshot },
      });
      return tx.generatedSite.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
        include: { currentVersion: true },
      });
    });
    return toSiteRecord(row);
  },
  async listVersions(
    tenantId: string,
    siteId: string,
  ): Promise<SiteVersionRecord[]> {
    return withTenant(tenantId, async (tx) => {
      const site = await tx.generatedSite.findFirst({
        where: { id: siteId, tenantId },
        select: { currentVersionId: true },
      });
      const rows = await tx.siteVersion.findMany({
        where: { siteId, tenantId },
        orderBy: { version: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        siteId: row.siteId,
        version: row.version,
        site: row.snapshot as unknown as PublishedSite,
        createdAt: row.createdAt.toISOString(),
        isCurrent: row.id === site?.currentVersionId,
      }));
    });
  },
  async restoreVersion(
    tenantId: string,
    siteId: string,
    version: number,
  ): Promise<SiteRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const site = await tx.generatedSite.findFirst({
        where: { id: siteId, tenantId },
        include: { currentVersion: true },
      });
      if (!site) throw new Error(`Site ${siteId} not found for tenant`);
      const target = await tx.siteVersion.findFirst({
        where: { siteId, tenantId, version },
      });
      if (!target) {
        throw new Error(`Version ${version} not found for site ${siteId}`);
      }
      // Forward-only rollback: append a new version copying the target snapshot.
      const nextVersion = (site.currentVersion?.version ?? 0) + 1;
      const created = await tx.siteVersion.create({
        data: {
          tenantId,
          siteId,
          version: nextVersion,
          snapshot: target.snapshot as Prisma.InputJsonValue,
        },
      });
      return tx.generatedSite.update({
        where: { id: siteId },
        data: {
          status: "published",
          publishedAt: new Date(),
          currentVersionId: created.id,
        },
        include: { currentVersion: true },
      });
    });
    return toSiteRecord(row);
  },
};

const leads = {
  async create(tenantId: string, input: LeadInput): Promise<LeadRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.lead.create({
        data: {
          tenantId,
          businessId: input.businessId,
          name: input.name,
          contact: input.contact,
          message: input.message ?? "",
          purpose: input.purpose ?? "Respond to this enquiry",
          consent: input.consent,
          consentAt: input.consentAt
            ? new Date(input.consentAt)
            : input.consent
              ? new Date()
              : null,
          marketingOptIn: input.marketingOptIn ?? false,
          retentionUntil: input.retentionUntil
            ? new Date(input.retentionUntil)
            : null,
        },
      }),
    );
    return toLeadRecord(row);
  },
  async listByBusiness(
    tenantId: string,
    businessId: string,
  ): Promise<LeadRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.lead.findMany({
        where: { tenantId, businessId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map(toLeadRecord);
  },
  // The next three run PLATFORM-WIDE (no session tenant): the retention Cron and
  // a DSAR span every tenant by design. B5/W1: under FORCE RLS a base-client
  // read/write returns 0 rows for the non-bypass app role, so these route
  // through tightly-scoped SECURITY DEFINER functions (one per operation). The
  // Cron and DSAR endpoints remain independently access-controlled
  // (CRON_SECRET / Information Officer bearer).
  async purgeExpired(asOf: Date): Promise<number> {
    const rows = await prisma.$queryRaw<{ purge_expired_leads: number }[]>`
      SELECT purge_expired_leads(${asOf}) AS purge_expired_leads`;
    return Number(rows[0]?.purge_expired_leads ?? 0);
  },
  async findByContact(contact: string): Promise<LeadRecord[]> {
    const key = contact.trim();
    if (!key) return [];
    const rows = await prisma.$queryRaw<LeadRow[]>`
      SELECT * FROM find_leads_by_contact(${key})`;
    return rows.map(toLeadRecord);
  },
  async deleteByContact(contact: string): Promise<number> {
    const key = contact.trim();
    if (!key) return 0;
    const rows = await prisma.$queryRaw<{ delete_leads_by_contact: number }[]>`
      SELECT delete_leads_by_contact(${key}) AS delete_leads_by_contact`;
    return Number(rows[0]?.delete_leads_by_contact ?? 0);
  },
};

interface LeadRow {
  id: string;
  tenantId: string;
  businessId: string;
  name: string;
  contact: string;
  message: string;
  purpose: string;
  consent: boolean;
  consentAt: Date | null;
  marketingOptIn: boolean;
  retentionUntil: Date | null;
  createdAt: Date;
}

function toLeadRecord(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    name: row.name,
    contact: row.contact,
    message: row.message,
    purpose: row.purpose,
    consent: row.consent,
    consentAt: row.consentAt?.toISOString() ?? null,
    marketingOptIn: row.marketingOptIn,
    retentionUntil: row.retentionUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

interface AuditRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const audit = {
  async append(tenantId: string, input: AuditInput): Promise<AuditEntry> {
    const row = await withTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
    );
    return toAuditEntry(row);
  },
  async list(tenantId: string): Promise<AuditEntry[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    );
    return rows.map(toAuditEntry);
  },
};

interface DomainRow {
  id: string;
  tenantId: string;
  businessId: string | null;
  hostname: string;
  status: string;
  tld: string | null;
  registrar: string | null;
  registrarRef: string | null;
  autoRenew: boolean;
  expiresAt: Date | null;
  authCode: string | null;
  costCents: number | null;
  priceCents: number | null;
  operationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomainRecord(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    hostname: row.hostname,
    status: row.status as DomainRecord["status"],
    tld: row.tld,
    registrar: (row.registrar as DomainRecord["registrar"]) ?? null,
    registrarRef: row.registrarRef,
    autoRenew: row.autoRenew,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    authCode: row.authCode,
    costCents: row.costCents,
    priceCents: row.priceCents,
    operationId: row.operationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const domains = {
  async list(tenantId: string): Promise<DomainRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.domain.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } }),
    );
    return rows.map((r) => toDomainRecord(r as DomainRow));
  },
  async getByHostname(
    tenantId: string,
    hostname: string,
  ): Promise<DomainRecord | null> {
    const key = hostname.trim().toLowerCase();
    const row = await withTenant(tenantId, (tx) =>
      tx.domain.findFirst({ where: { tenantId, hostname: key } }),
    );
    return row ? toDomainRecord(row as DomainRow) : null;
  },
  async create(tenantId: string, input: DomainInput): Promise<DomainRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.domain.create({
        data: {
          tenantId,
          businessId: input.businessId ?? null,
          hostname: input.hostname.trim().toLowerCase(),
          status: input.status ?? "requested",
          tld: input.tld ?? null,
          registrar: input.registrar ?? null,
          registrarRef: input.registrarRef ?? null,
          autoRenew: input.autoRenew ?? false,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          authCode: input.authCode ?? null,
          costCents: input.costCents ?? null,
          priceCents: input.priceCents ?? null,
          operationId: input.operationId ?? null,
        },
      }),
    );
    return toDomainRecord(row as DomainRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: DomainUpdate,
  ): Promise<DomainRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.domain.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error(`Domain ${id} not found for tenant`);
      return tx.domain.update({
        where: { id },
        data: {
          status: update.status,
          registrarRef: update.registrarRef,
          autoRenew: update.autoRenew,
          expiresAt:
            update.expiresAt === undefined
              ? undefined
              : update.expiresAt
                ? new Date(update.expiresAt)
                : null,
          authCode: update.authCode,
          operationId: update.operationId,
        },
      });
    });
    return toDomainRecord(row as DomainRow);
  },
};

interface AdapterConnRow {
  id: string;
  tenantId: string;
  interfaceName: string;
  mode: AdapterConnectionRecord["mode"];
  status: AdapterConnectionRecord["status"];
  state: unknown;
}

function toAdapterConnRecord(row: AdapterConnRow): AdapterConnectionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    interfaceName: row.interfaceName,
    mode: row.mode,
    status: row.status,
    state: (row.state as Record<string, unknown> | null) ?? null,
  };
}

const adapterConnections = {
  async list(tenantId: string): Promise<AdapterConnectionRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.adapterConnection.findMany({ where: { tenantId } }),
    );
    return rows.map(toAdapterConnRecord);
  },
  async upsert(
    tenantId: string,
    input: AdapterConnectionInput,
  ): Promise<AdapterConnectionRecord> {
    const state = (input.state ?? undefined) as Prisma.InputJsonValue | undefined;
    const row = await withTenant(tenantId, (tx) =>
      tx.adapterConnection.upsert({
        where: {
          tenantId_interfaceName: {
            tenantId,
            interfaceName: input.interfaceName,
          },
        },
        create: {
          tenantId,
          interfaceName: input.interfaceName,
          mode: input.mode ?? "mock",
          status: input.status ?? "pending",
          state,
        },
        update: {
          mode: input.mode,
          status: input.status,
          state,
        },
      }),
    );
    return toAdapterConnRecord(row);
  },
};

interface SubscriptionRow {
  id: string;
  tenantId: string;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  provider: string;
  providerSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    plan: row.plan as PlanId,
    status: row.status as SubscriptionRecord["status"],
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    provider: row.provider,
    providerSubscriptionId: row.providerSubscriptionId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const subscriptions = {
  async get(tenantId: string): Promise<SubscriptionRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId } }),
    );
    return row ? toSubscriptionRecord(row) : null;
  },
  async upsert(
    tenantId: string,
    input: SubscriptionInput,
  ): Promise<SubscriptionRecord> {
    const currentPeriodEnd =
      input.currentPeriodEnd === undefined
        ? undefined
        : input.currentPeriodEnd
          ? new Date(input.currentPeriodEnd)
          : null;
    const row = await withTenant(tenantId, (tx) =>
      tx.subscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          plan: input.plan,
          status: input.status,
          currentPeriodEnd: currentPeriodEnd ?? null,
          provider: input.provider ?? "mock",
          providerSubscriptionId: input.providerSubscriptionId ?? null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
        },
        update: {
          plan: input.plan,
          status: input.status,
          currentPeriodEnd,
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        },
      }),
    );
    return toSubscriptionRecord(row);
  },
  // Cross-tenant lookup (no session): the webhook resolves the owning tenant
  // from the provider's subscription id. B5/W1: under FORCE RLS a base-client
  // read returns nothing for the non-bypass app role, so we resolve the owning
  // tenantId via a SECURITY DEFINER function, then read the full row INSIDE
  // withTenant(tenantId) so the rest of the read is RLS-scoped normally.
  async getByProviderId(
    provider: string,
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | null> {
    const resolved = await prisma.$queryRaw<{ subscription_tenant_by_provider: string | null }[]>`
      SELECT subscription_tenant_by_provider(${provider}, ${providerSubscriptionId})
        AS subscription_tenant_by_provider`;
    const tenantId = resolved[0]?.subscription_tenant_by_provider ?? null;
    if (!tenantId) return null;
    const row = await withTenant(tenantId, (tx) =>
      tx.subscription.findUnique({ where: { tenantId } }),
    );
    return row ? toSubscriptionRecord(row) : null;
  },
};

// --- W2 metering wallet (Prisma/Postgres) -----------------------------------

interface WalletRow {
  id: string;
  tenantId: string;
  balanceMicro: bigint;
  updatedAt: Date;
}

function toWalletRecord(row: WalletRow): WalletRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    balanceMicro: row.balanceMicro,
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface UsageRow {
  id: string;
  tenantId: string;
  kind: string;
  quantity: number;
  unitCostMicro: bigint;
  unitPriceMicro: bigint;
  amountMicro: bigint;
  period: string;
  idempotencyKey: string;
  createdAt: Date;
}

function toUsageRecord(row: UsageRow): UsageRecordRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind,
    quantity: row.quantity,
    unitCostMicro: row.unitCostMicro,
    unitPriceMicro: row.unitPriceMicro,
    amountMicro: row.amountMicro,
    period: row.period,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

interface InvoiceRow {
  id: string;
  tenantId: string;
  period: string;
  totalMicro: bigint;
  status: string;
  providerInvoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toInvoiceRecord(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    period: row.period,
    totalMicro: row.totalMicro,
    status: row.status as InvoiceStatus,
    providerInvoiceId: row.providerInvoiceId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const wallet = {
  async get(tenantId: string): Promise<WalletRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.tokenWallet.findUnique({ where: { tenantId } }),
    );
    return row ? toWalletRecord(row as WalletRow) : null;
  },
  async getBalance(tenantId: string): Promise<bigint> {
    const row = await withTenant(tenantId, (tx) =>
      tx.tokenWallet.findUnique({ where: { tenantId } }),
    );
    return (row as WalletRow | null)?.balanceMicro ?? 0n;
  },
  async credit(tenantId: string, amountMicro: bigint): Promise<bigint> {
    const row = await withTenant(tenantId, (tx) =>
      tx.tokenWallet.upsert({
        where: { tenantId },
        create: { tenantId, balanceMicro: amountMicro },
        update: { balanceMicro: { increment: amountMicro } },
      }),
    );
    return (row as WalletRow).balanceMicro;
  },
  async debit(tenantId: string, input: UsageRecordInput): Promise<DebitResult> {
    // ATOMIC + EXACTLY-ONCE: one transaction that (1) ensures the wallet exists,
    // then (2) calls record_usage_debit() — the SQL function that INSERTs the
    // usage row keyed on (tenantId, idempotencyKey) ON CONFLICT DO NOTHING and
    // only debits when a row was actually inserted. A duplicate key inserts
    // nothing and does NOT debit (returns applied=false + the prior balance).
    // Running inside withTenant() keeps RLS scoping the rows the function
    // touches to the active tenant.
    const usageId = `usage_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    return withTenant(tenantId, async (tx) => {
      // Ensure a wallet row exists (debit needs something to decrement). A
      // first-ever debit on a tenant with no top-up starts the wallet at 0 and
      // goes negative — the pre-flight gate at the router prevents that in
      // practice, but the ledger must still be coherent if called directly.
      await tx.tokenWallet.upsert({
        where: { tenantId },
        create: { tenantId, balanceMicro: 0n },
        update: {},
      });
      // Bind quantity as BigInt so Prisma sends int8, matching the function's
      // BIGINT param (a JS number would still bind as int8, but being explicit
      // keeps the overload unambiguous — see the migration's type note).
      const rows = await tx.$queryRaw<{ balance_micro: bigint; applied: boolean }[]>`
        SELECT balance_micro, applied FROM record_usage_debit(
          ${tenantId}, ${usageId}, ${input.kind}, ${BigInt(input.quantity)},
          ${input.unitCostMicro}, ${input.unitPriceMicro}, ${input.amountMicro},
          ${input.period}, ${input.idempotencyKey}
        )`;
      const applied = rows[0]?.applied ?? false;
      const balanceMicro = rows[0]?.balance_micro ?? 0n;
      // Read back the canonical usage row (the one just inserted, or the prior
      // one on a duplicate) so callers get a consistent record either way.
      const usageRow = await tx.usageRecord.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      return {
        applied,
        balanceMicro,
        record: toUsageRecord(usageRow as UsageRow),
      };
    });
  },
};

const usage = {
  async append(
    tenantId: string,
    input: UsageRecordInput,
  ): Promise<UsageRecordRow> {
    const row = await withTenant(tenantId, (tx) =>
      tx.usageRecord.create({
        data: {
          tenantId,
          kind: input.kind,
          quantity: input.quantity,
          unitCostMicro: input.unitCostMicro,
          unitPriceMicro: input.unitPriceMicro,
          amountMicro: input.amountMicro,
          period: input.period,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    );
    return toUsageRecord(row as UsageRow);
  },
  async listByPeriod(
    tenantId: string,
    period: string,
  ): Promise<UsageRecordRow[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.usageRecord.findMany({
        where: { tenantId, period },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toUsageRecord(r as UsageRow));
  },
  async listRecent(tenantId: string, limit = 20): Promise<UsageRecordRow[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.usageRecord.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    );
    return rows.map((r) => toUsageRecord(r as UsageRow));
  },
};

const invoices = {
  async get(tenantId: string, period: string): Promise<InvoiceRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.invoice.findUnique({
        where: { tenantId_period: { tenantId, period } },
      }),
    );
    return row ? toInvoiceRecord(row as InvoiceRow) : null;
  },
  async upsert(
    tenantId: string,
    period: string,
    totalMicro: bigint,
    status: InvoiceStatus = "open",
    providerInvoiceId: string | null = null,
  ): Promise<InvoiceRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.invoice.upsert({
        where: { tenantId_period: { tenantId, period } },
        create: {
          tenantId,
          period,
          totalMicro,
          status,
          providerInvoiceId,
        },
        update: { totalMicro, status, providerInvoiceId },
      }),
    );
    return toInvoiceRecord(row as InvoiceRow);
  },
  async list(tenantId: string): Promise<InvoiceRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.invoice.findMany({ where: { tenantId }, orderBy: { period: "desc" } }),
    );
    return rows.map((r) => toInvoiceRecord(r as InvoiceRow));
  },
};

// --- W8 GBP listings (Prisma/Postgres) --------------------------------------

interface LocalListingRow {
  id: string;
  tenantId: string;
  businessId: string | null;
  name: string;
  area: string;
  phone: string;
  categories: unknown;
  hours: unknown;
  status: string;
  googleLocationId: string | null;
  operationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toLocalListingRecord(row: LocalListingRow): LocalListingRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    name: row.name,
    area: row.area,
    phone: row.phone,
    categories: Array.isArray(row.categories)
      ? (row.categories as string[])
      : [],
    hours: (row.hours as Record<string, unknown> | null) ?? null,
    status: row.status as LocalListingRecord["status"],
    googleLocationId: row.googleLocationId,
    operationId: row.operationId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const localListings = {
  async list(tenantId: string): Promise<LocalListingRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.localListing.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toLocalListingRecord(r as LocalListingRow));
  },
  async get(tenantId: string, id: string): Promise<LocalListingRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.localListing.findFirst({ where: { id, tenantId } }),
    );
    return row ? toLocalListingRecord(row as LocalListingRow) : null;
  },
  async getPrimary(tenantId: string): Promise<LocalListingRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.localListing.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "asc" },
      }),
    );
    return row ? toLocalListingRecord(row as LocalListingRow) : null;
  },
  async create(
    tenantId: string,
    input: LocalListingInput,
  ): Promise<LocalListingRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.localListing.create({
        data: {
          tenantId,
          businessId: input.businessId ?? null,
          name: input.name,
          area: input.area,
          phone: input.phone,
          categories: (input.categories ?? []) as Prisma.InputJsonValue,
          hours: (input.hours ?? undefined) as Prisma.InputJsonValue | undefined,
          status: input.status ?? "draft",
          googleLocationId: input.googleLocationId ?? null,
          operationId: input.operationId ?? null,
        },
      }),
    );
    return toLocalListingRecord(row as LocalListingRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: LocalListingUpdate,
  ): Promise<LocalListingRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.localListing.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new Error(`Listing ${id} not found for tenant`);
      return tx.localListing.update({
        where: { id },
        data: {
          name: update.name,
          area: update.area,
          phone: update.phone,
          categories:
            update.categories === undefined
              ? undefined
              : (update.categories as Prisma.InputJsonValue),
          hours:
            update.hours === undefined
              ? undefined
              : (update.hours as Prisma.InputJsonValue | undefined),
          status: update.status,
          googleLocationId: update.googleLocationId,
          operationId: update.operationId,
        },
      });
    });
    return toLocalListingRecord(row as LocalListingRow);
  },
};

// --- W8 WhatsApp catalog products (Prisma/Postgres) -------------------------

interface ProductRow {
  id: string;
  tenantId: string;
  businessId: string | null;
  name: string;
  description: string;
  priceCents: bigint;
  imageUrl: string | null;
  available: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toProductRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    imageUrl: row.imageUrl,
    available: row.available,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const products = {
  async list(tenantId: string): Promise<ProductRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.product.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toProductRecord(r as ProductRow));
  },
  async get(tenantId: string, id: string): Promise<ProductRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.product.findFirst({ where: { id, tenantId } }),
    );
    return row ? toProductRecord(row as ProductRow) : null;
  },
  async create(tenantId: string, input: ProductInput): Promise<ProductRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.product.create({
        data: {
          tenantId,
          businessId: input.businessId ?? null,
          name: input.name,
          description: input.description ?? "",
          priceCents: input.priceCents,
          imageUrl: input.imageUrl ?? null,
          available: input.available ?? true,
        },
      }),
    );
    return toProductRecord(row as ProductRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: ProductUpdate,
  ): Promise<ProductRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.product.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error(`Product ${id} not found for tenant`);
      return tx.product.update({
        where: { id },
        data: {
          name: update.name,
          description: update.description,
          priceCents: update.priceCents,
          imageUrl: update.imageUrl,
          available: update.available,
        },
      });
    });
    return toProductRecord(row as ProductRow);
  },
};

// --- W8 WhatsApp orders (Prisma/Postgres) -----------------------------------

interface WhatsappOrderRow {
  id: string;
  tenantId: string;
  businessId: string | null;
  customerContact: string;
  items: unknown;
  totalCents: bigint;
  status: string;
  paymentLinkRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toWhatsappOrderRecord(row: WhatsappOrderRow): WhatsappOrderRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    customerContact: row.customerContact,
    items: Array.isArray(row.items)
      ? (row.items as unknown as WhatsappOrderItem[])
      : [],
    totalCents: row.totalCents,
    status: row.status as WhatsappOrderRecord["status"],
    paymentLinkRef: row.paymentLinkRef,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const whatsappOrders = {
  async list(tenantId: string): Promise<WhatsappOrderRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.whatsappOrder.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toWhatsappOrderRecord(r as WhatsappOrderRow));
  },
  async get(tenantId: string, id: string): Promise<WhatsappOrderRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.whatsappOrder.findFirst({ where: { id, tenantId } }),
    );
    return row ? toWhatsappOrderRecord(row as WhatsappOrderRow) : null;
  },
  async create(
    tenantId: string,
    input: WhatsappOrderInput,
  ): Promise<WhatsappOrderRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.whatsappOrder.create({
        data: {
          tenantId,
          businessId: input.businessId ?? null,
          customerContact: input.customerContact,
          items: input.items as unknown as Prisma.InputJsonValue,
          totalCents: input.totalCents,
          status: input.status ?? "draft",
          paymentLinkRef: input.paymentLinkRef ?? null,
        },
      }),
    );
    return toWhatsappOrderRecord(row as WhatsappOrderRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: WhatsappOrderUpdate,
  ): Promise<WhatsappOrderRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.whatsappOrder.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new Error(`Order ${id} not found for tenant`);
      return tx.whatsappOrder.update({
        where: { id },
        data: {
          items:
            update.items === undefined
              ? undefined
              : (update.items as unknown as Prisma.InputJsonValue),
          totalCents: update.totalCents,
          status: update.status,
          paymentLinkRef: update.paymentLinkRef,
        },
      });
    });
    return toWhatsappOrderRecord(row as WhatsappOrderRow);
  },
};

// --- W6 GitHub repos + Vercel deployments (Prisma/Postgres) -----------------

interface SiteRepoRow {
  id: string;
  tenantId: string;
  slug: string;
  repoRef: string;
  repoUrl: string;
  defaultBranch: string;
  lastCommitSha: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSiteRepoRecord(row: SiteRepoRow): SiteRepoRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    repoRef: row.repoRef,
    repoUrl: row.repoUrl,
    defaultBranch: row.defaultBranch,
    lastCommitSha: row.lastCommitSha,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const siteRepos = {
  async list(tenantId: string): Promise<SiteRepoRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.siteRepo.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toSiteRepoRecord(r as SiteRepoRow));
  },
  async getBySlug(
    tenantId: string,
    slug: string,
  ): Promise<SiteRepoRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.siteRepo.findFirst({ where: { tenantId, slug } }),
    );
    return row ? toSiteRepoRecord(row as SiteRepoRow) : null;
  },
  async ensure(
    tenantId: string,
    input: SiteRepoInput,
  ): Promise<SiteRepoRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      // Idempotent on (tenant, slug): return the existing repo or create it.
      const existing = await tx.siteRepo.findFirst({
        where: { tenantId, slug: input.slug },
      });
      if (existing) return existing;
      return tx.siteRepo.create({
        data: {
          tenantId,
          slug: input.slug,
          repoRef: input.repoRef,
          repoUrl: input.repoUrl,
          defaultBranch: input.defaultBranch ?? "main",
          lastCommitSha: input.lastCommitSha ?? null,
        },
      });
    });
    return toSiteRepoRecord(row as SiteRepoRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: SiteRepoUpdate,
  ): Promise<SiteRepoRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.siteRepo.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error(`SiteRepo ${id} not found for tenant`);
      return tx.siteRepo.update({
        where: { id },
        data: {
          repoRef: update.repoRef,
          repoUrl: update.repoUrl,
          defaultBranch: update.defaultBranch,
          lastCommitSha: update.lastCommitSha,
        },
      });
    });
    return toSiteRepoRecord(row as SiteRepoRow);
  },
};

interface DeploymentRow {
  id: string;
  tenantId: string;
  slug: string;
  target: string;
  status: string;
  url: string | null;
  operationId: string | null;
  version: number | null;
  providerDeploymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDeploymentRecord(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    target: row.target,
    status: row.status as DeploymentRecord["status"],
    url: row.url,
    operationId: row.operationId,
    version: row.version,
    providerDeploymentId: row.providerDeploymentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const deployments = {
  async list(tenantId: string): Promise<DeploymentRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.deployment.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toDeploymentRecord(r as DeploymentRow));
  },
  async listBySlug(
    tenantId: string,
    slug: string,
  ): Promise<DeploymentRecord[]> {
    const rows = await withTenant(tenantId, (tx) =>
      tx.deployment.findMany({
        where: { tenantId, slug },
        orderBy: { createdAt: "desc" },
      }),
    );
    return rows.map((r) => toDeploymentRecord(r as DeploymentRow));
  },
  async getLatestBySlug(
    tenantId: string,
    slug: string,
  ): Promise<DeploymentRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.deployment.findFirst({
        where: { tenantId, slug },
        orderBy: { createdAt: "desc" },
      }),
    );
    return row ? toDeploymentRecord(row as DeploymentRow) : null;
  },
  async get(tenantId: string, id: string): Promise<DeploymentRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.deployment.findFirst({ where: { id, tenantId } }),
    );
    return row ? toDeploymentRecord(row as DeploymentRow) : null;
  },
  async create(
    tenantId: string,
    input: DeploymentInput,
  ): Promise<DeploymentRecord> {
    const row = await withTenant(tenantId, (tx) =>
      tx.deployment.create({
        data: {
          tenantId,
          slug: input.slug,
          target: input.target ?? "static",
          status: input.status ?? "queued",
          url: input.url ?? null,
          operationId: input.operationId ?? null,
          version: input.version ?? null,
          providerDeploymentId: input.providerDeploymentId ?? null,
        },
      }),
    );
    return toDeploymentRecord(row as DeploymentRow);
  },
  async update(
    tenantId: string,
    id: string,
    update: DeploymentUpdate,
  ): Promise<DeploymentRecord> {
    const row = await withTenant(tenantId, async (tx) => {
      const existing = await tx.deployment.findFirst({ where: { id, tenantId } });
      if (!existing) throw new Error(`Deployment ${id} not found for tenant`);
      return tx.deployment.update({
        where: { id },
        data: {
          status: update.status,
          url: update.url,
          operationId: update.operationId,
          providerDeploymentId: update.providerDeploymentId,
        },
      });
    });
    return toDeploymentRecord(row as DeploymentRow);
  },
  async getByOperationId(
    tenantId: string,
    operationId: string,
  ): Promise<DeploymentRecord | null> {
    const row = await withTenant(tenantId, (tx) =>
      tx.deployment.findFirst({ where: { tenantId, operationId } }),
    );
    return row ? toDeploymentRecord(row as DeploymentRow) : null;
  },
  async resolveByProviderDeploymentId(
    providerDeploymentId: string,
  ): Promise<{ tenantId: string; deploymentId: string } | null> {
    // Cross-tenant (no session): the signed Vercel webhook resolves the owning
    // tenant + deployment via the SECURITY DEFINER function, then the webhook
    // settles INSIDE withTenant(tenantId). B5/W1 pattern.
    const rows = await prisma.$queryRaw<{ tenantId: string; id: string }[]>`
      SELECT "tenantId", "id" FROM deployment_owner_by_provider_id(${providerDeploymentId})`;
    const row = rows[0];
    return row ? { tenantId: row.tenantId, deploymentId: row.id } : null;
  },
};

export const prismaRepositories: Repositories = {
  businesses,
  sites,
  leads,
  audit,
  domains,
  adapterConnections,
  subscriptions,
  wallet,
  usage,
  invoices,
  localListings,
  products,
  whatsappOrders,
  siteRepos,
  deployments,
};
