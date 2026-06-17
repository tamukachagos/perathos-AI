// In-memory / mock repository implementation.
//
// Active whenever there is no DATABASE_URL. Seeded with the Maboneng sample so
// the app is fully usable with no database. State lives in module-level maps; it
// resets on server restart, which is the intended behaviour for a mock.

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
  SiteVersionRecord,
  SubscriptionInput,
  SubscriptionRecord,
} from "./types";
import { seedBusiness, seedSite } from "./seed";

// --- Module-level store (one per server process) ----------------------------

interface Store {
  businesses: Map<string, BusinessRecord>;
  // S7: keyed by `${tenantId}:${slug}` so slug uniqueness is PER TENANT, not
  // global — two tenants may both hold "joes-shop" without colliding or
  // squatting each other's slug.
  sites: Map<string, SiteRecord>; // CURRENT version, per (tenant, slug)
  siteVersions: SiteVersionRecord[]; // append-only history across all sites
  leads: LeadRecord[];
  audit: AuditEntry[];
  adapterConnections: Map<string, AdapterConnectionRecord>; // key `${tenantId}:${interfaceName}`
  subscriptions: Map<string, SubscriptionRecord>; // keyed by tenantId
  seq: number;
}

// Reuse a single store across hot-reloads in dev so a just-published site is
// still visible to the public route within the same server process.
const globalStore = globalThis as unknown as { __launchDeskStore?: Store };

function createStore(): Store {
  const business = seedBusiness();
  const site = seedSite();
  return {
    businesses: new Map([[business.id, business]]),
    sites: new Map([[siteKey(site.tenantId, site.slug), site]]),
    siteVersions: [
      {
        id: `ver_${site.id}_1`,
        tenantId: site.tenantId,
        siteId: site.id,
        version: site.version,
        site: site.site,
        createdAt: site.site.publishedAt,
        isCurrent: true,
      },
    ],
    leads: [],
    audit: [],
    adapterConnections: new Map(),
    // The seeded dev tenant starts on Free (no row) — exactly the default tier.
    subscriptions: new Map(),
    seq: 1,
  };
}

function store(): Store {
  if (!globalStore.__launchDeskStore) {
    globalStore.__launchDeskStore = createStore();
  }
  return globalStore.__launchDeskStore;
}

function nextId(prefix: string): string {
  const s = store();
  s.seq += 1;
  return `${prefix}_${s.seq.toString(36)}_${Date.now().toString(36)}`;
}

/** Composite key for the per-tenant slug scoping (S7). */
function siteKey(tenantId: string, slug: string): string {
  return `${tenantId}:${slug}`;
}

// --- Repositories ------------------------------------------------------------

const businesses = {
  async list(tenantId: string): Promise<BusinessRecord[]> {
    return [...store().businesses.values()].filter(
      (b) => b.tenantId === tenantId,
    );
  },
  async get(tenantId: string, id: string): Promise<BusinessRecord | null> {
    const found = store().businesses.get(id);
    return found && found.tenantId === tenantId ? found : null;
  },
  async getPrimary(tenantId: string): Promise<BusinessRecord | null> {
    return (
      [...store().businesses.values()].find((b) => b.tenantId === tenantId) ??
      null
    );
  },
  async create(tenantId: string, business: Business): Promise<BusinessRecord> {
    const record: BusinessRecord = {
      id: nextId("biz"),
      tenantId,
      ...business,
    };
    store().businesses.set(record.id, record);
    return record;
  },
  async upsertPrimary(
    tenantId: string,
    business: Business,
  ): Promise<BusinessRecord> {
    const existing = await this.getPrimary(tenantId);
    if (existing) return this.update(tenantId, existing.id, business);
    return this.create(tenantId, business);
  },
  async update(
    tenantId: string,
    id: string,
    business: Business,
  ): Promise<BusinessRecord> {
    const existing = await this.get(tenantId, id);
    if (!existing) throw new Error(`Business ${id} not found for tenant`);
    const updated: BusinessRecord = { ...existing, ...business };
    store().businesses.set(id, updated);
    return updated;
  },
};

const sites = {
  async listByTenant(tenantId: string): Promise<SiteRecord[]> {
    return [...store().sites.values()].filter((s) => s.tenantId === tenantId);
  },
  async getBySlug(slug: string): Promise<SiteRecord | null> {
    // Public route: no tenant in context. The slug is unique PER TENANT (S7),
    // so resolve the single published site that carries it. (In practice a
    // public host→slug mapping resolves the tenant; here we return the match.)
    return (
      [...store().sites.values()].find((site) => site.slug === slug) ?? null
    );
  },
  async publish(
    tenantId: string,
    businessId: string,
    site: PublishedSite,
  ): Promise<SiteRecord> {
    const s = store();
    // S7: look up the existing site SCOPED TO THIS TENANT. A different tenant's
    // site with the same slug is invisible here, so it can neither be
    // overwritten nor block this tenant from using the slug.
    const existing = s.sites.get(siteKey(tenantId, site.slug));
    if (existing && existing.tenantId !== tenantId) {
      // Defensive: the composite key already scopes by tenant, but verify the
      // stored owner matches the caller before versioning (S7).
      throw new Error(`Site ${site.slug} is owned by another tenant`);
    }
    const record: SiteRecord = {
      id: existing?.id ?? nextId("site"),
      tenantId,
      businessId,
      slug: site.slug,
      version: existing ? existing.version + 1 : 1,
      site,
    };
    s.sites.set(siteKey(tenantId, site.slug), record);
    // Append a new immutable version and re-point "current" to it.
    for (const v of s.siteVersions) {
      if (v.siteId === record.id) v.isCurrent = false;
    }
    s.siteVersions.push({
      id: `ver_${record.id}_${record.version}`,
      tenantId,
      siteId: record.id,
      version: record.version,
      site,
      createdAt: site.publishedAt ?? new Date().toISOString(),
      isCurrent: true,
    });
    return record;
  },
  async listVersions(
    tenantId: string,
    siteId: string,
  ): Promise<SiteVersionRecord[]> {
    return store()
      .siteVersions.filter(
        (v) => v.tenantId === tenantId && v.siteId === siteId,
      )
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ ...v }));
  },
  async restoreVersion(
    tenantId: string,
    siteId: string,
    version: number,
  ): Promise<SiteRecord> {
    const s = store();
    const target = s.siteVersions.find(
      (v) => v.tenantId === tenantId && v.siteId === siteId && v.version === version,
    );
    if (!target) {
      throw new Error(`Version ${version} not found for site ${siteId}`);
    }
    const current = [...s.sites.values()].find(
      (site) => site.id === siteId && site.tenantId === tenantId,
    );
    if (!current) throw new Error(`Site ${siteId} not found for tenant`);
    // Forward-only rollback: re-publish the target snapshot as a new version.
    return this.publish(tenantId, current.businessId, target.site);
  },
};

const leads = {
  async create(tenantId: string, input: LeadInput): Promise<LeadRecord> {
    const record: LeadRecord = {
      id: nextId("lead"),
      tenantId,
      businessId: input.businessId,
      name: input.name,
      contact: input.contact,
      message: input.message ?? "",
      purpose: input.purpose ?? "Respond to this enquiry",
      consent: input.consent,
      consentAt: input.consentAt ?? (input.consent ? new Date().toISOString() : null),
      marketingOptIn: input.marketingOptIn ?? false,
      retentionUntil: input.retentionUntil ?? null,
      createdAt: new Date().toISOString(),
    };
    store().leads.push(record);
    return record;
  },
  async listByBusiness(
    tenantId: string,
    businessId: string,
  ): Promise<LeadRecord[]> {
    return store().leads.filter(
      (l) => l.tenantId === tenantId && l.businessId === businessId,
    );
  },
  async purgeExpired(asOf: Date): Promise<number> {
    const s = store();
    const cutoff = asOf.getTime();
    const before = s.leads.length;
    s.leads = s.leads.filter((l) => {
      if (!l.retentionUntil) return true; // no expiry set => keep
      return new Date(l.retentionUntil).getTime() > cutoff;
    });
    return before - s.leads.length;
  },
  async findByContact(contact: string): Promise<LeadRecord[]> {
    const key = contact.trim().toLowerCase();
    if (!key) return [];
    return store().leads.filter((l) => l.contact.trim().toLowerCase() === key);
  },
  async deleteByContact(contact: string): Promise<number> {
    const s = store();
    const key = contact.trim().toLowerCase();
    if (!key) return 0;
    const before = s.leads.length;
    s.leads = s.leads.filter((l) => l.contact.trim().toLowerCase() !== key);
    return before - s.leads.length;
  },
};

const audit = {
  async append(tenantId: string, input: AuditInput): Promise<AuditEntry> {
    const entry: AuditEntry = {
      id: nextId("audit"),
      tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date().toISOString(),
    };
    store().audit.push(entry);
    return entry;
  },
  async list(tenantId: string): Promise<AuditEntry[]> {
    return store()
      .audit.filter((a) => a.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};

const adapterConnections = {
  async list(tenantId: string): Promise<AdapterConnectionRecord[]> {
    return [...store().adapterConnections.values()].filter(
      (c) => c.tenantId === tenantId,
    );
  },
  async upsert(
    tenantId: string,
    input: AdapterConnectionInput,
  ): Promise<AdapterConnectionRecord> {
    const key = `${tenantId}:${input.interfaceName}`;
    const s = store();
    const existing = s.adapterConnections.get(key);
    const record: AdapterConnectionRecord = {
      id: existing?.id ?? nextId("conn"),
      tenantId,
      interfaceName: input.interfaceName,
      mode: input.mode ?? existing?.mode ?? "mock",
      status: input.status ?? existing?.status ?? "pending",
      state: input.state ?? existing?.state ?? null,
    };
    s.adapterConnections.set(key, record);
    return record;
  },
};

const subscriptions = {
  async get(tenantId: string): Promise<SubscriptionRecord | null> {
    return store().subscriptions.get(tenantId) ?? null;
  },
  async upsert(
    tenantId: string,
    input: SubscriptionInput,
  ): Promise<SubscriptionRecord> {
    const s = store();
    const existing = s.subscriptions.get(tenantId);
    const now = new Date().toISOString();
    const record: SubscriptionRecord = {
      id: existing?.id ?? nextId("sub"),
      tenantId,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd:
        input.currentPeriodEnd !== undefined
          ? input.currentPeriodEnd
          : existing?.currentPeriodEnd ?? null,
      provider: input.provider ?? existing?.provider ?? "mock",
      providerSubscriptionId:
        input.providerSubscriptionId !== undefined
          ? input.providerSubscriptionId
          : existing?.providerSubscriptionId ?? null,
      cancelAtPeriodEnd:
        input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    s.subscriptions.set(tenantId, record);
    return record;
  },
  async getByProviderId(
    provider: string,
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | null> {
    return (
      [...store().subscriptions.values()].find(
        (sub) =>
          sub.provider === provider &&
          sub.providerSubscriptionId === providerSubscriptionId,
      ) ?? null
    );
  },
};

export const memoryRepositories: Repositories = {
  businesses,
  sites,
  leads,
  audit,
  adapterConnections,
  subscriptions,
};

// Exposed for tests so they can run against a fresh store.
export function __resetMemoryStore(): void {
  globalStore.__launchDeskStore = createStore();
}
