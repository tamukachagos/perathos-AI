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
  LeadInput,
  LeadRecord,
  Repositories,
  SiteRecord,
} from "../types";
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
    // Public route: no tenant in context. We read the published row directly
    // (the slug is globally unique). RLS still applies, so this runs outside a
    // withTenant() transaction using a service read — see note below.
    const row = await prisma.generatedSite.findUnique({
      where: { slug },
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
      const existing = await tx.generatedSite.findUnique({
        where: { slug: site.slug },
        include: { currentVersion: true },
      });

      if (existing) {
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

export const prismaRepositories: Repositories = {
  businesses,
  sites,
  leads,
  audit,
  adapterConnections,
};
