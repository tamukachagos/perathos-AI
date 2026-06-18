// In-memory / mock repository implementation.
//
// Active whenever there is no DATABASE_URL. Seeded with the Maboneng sample so
// the app is fully usable with no database. State lives in module-level maps; it
// resets on server restart, which is the intended behaviour for a mock.

import type { Business, PublishedSite } from "@/lib/types";
import type {
  AdapterConnectionInput,
  AdapterConnectionRecord,
  AgentJobInput,
  AgentJobRecord,
  AgentJobStatus,
  AgentJobUpdate,
  AgentPolicyRecord,
  AgentPolicyUpdate,
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
  WhatsappOrderRecord,
  WhatsappOrderUpdate,
} from "./types";
import { DEV_TENANT_ID, seedBusiness, seedSite } from "./seed";

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
  domains: DomainRecord[]; // append-only across all tenants (W4)
  adapterConnections: Map<string, AdapterConnectionRecord>; // key `${tenantId}:${interfaceName}`
  subscriptions: Map<string, SubscriptionRecord>; // keyed by tenantId
  wallets: Map<string, WalletRecord>; // keyed by tenantId
  usage: UsageRecordRow[]; // append-only across all tenants
  invoices: Map<string, InvoiceRecord>; // keyed by `${tenantId}:${period}`
  localListings: LocalListingRecord[]; // append-only across all tenants (W8)
  products: ProductRecord[]; // append-only across all tenants (W8)
  whatsappOrders: WhatsappOrderRecord[]; // append-only across all tenants (W8)
  siteRepos: SiteRepoRecord[]; // append-only across all tenants (W6)
  deployments: DeploymentRecord[]; // append-only across all tenants (W6)
  agentJobs: AgentJobRecord[]; // append-only across all tenants (W7)
  agentPolicies: Map<string, AgentPolicyRecord>; // keyed by tenantId (W7)
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
    domains: [],
    adapterConnections: new Map(),
    // The seeded dev tenant starts on Free (no row) — exactly the default tier.
    subscriptions: new Map(),
    // Seed the dev tenant with a small starter grant (~R10) so the Credits UX
    // is exercisable with no DB and no top-up — mirrors the Free "tiny grant".
    wallets: new Map([
      [
        DEV_TENANT_ID,
        {
          id: "wallet-dev",
          tenantId: DEV_TENANT_ID,
          balanceMicro: 1_000_000n, // R10 = 1_000_000 micro-cents
          updatedAt: "2026-01-01T08:00:00.000Z",
        },
      ],
    ]),
    usage: [],
    invoices: new Map(),
    localListings: [],
    products: [],
    whatsappOrders: [],
    siteRepos: [],
    deployments: [],
    agentJobs: [],
    agentPolicies: new Map(),
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

const domains = {
  async list(tenantId: string): Promise<DomainRecord[]> {
    return store()
      .domains.filter((d) => d.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({ ...d }));
  },
  async getByHostname(
    tenantId: string,
    hostname: string,
  ): Promise<DomainRecord | null> {
    const key = hostname.trim().toLowerCase();
    const found = store().domains.find(
      (d) => d.tenantId === tenantId && d.hostname === key,
    );
    return found ? { ...found } : null;
  },
  async create(tenantId: string, input: DomainInput): Promise<DomainRecord> {
    const now = new Date().toISOString();
    const record: DomainRecord = {
      id: nextId("dom"),
      tenantId,
      businessId: input.businessId ?? null,
      hostname: input.hostname.trim().toLowerCase(),
      status: input.status ?? "requested",
      tld: input.tld ?? null,
      registrar: input.registrar ?? null,
      registrarRef: input.registrarRef ?? null,
      autoRenew: input.autoRenew ?? false,
      expiresAt: input.expiresAt ?? null,
      authCode: input.authCode ?? null,
      costCents: input.costCents ?? null,
      priceCents: input.priceCents ?? null,
      operationId: input.operationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store().domains.push(record);
    return { ...record };
  },
  async update(
    tenantId: string,
    id: string,
    update: DomainUpdate,
  ): Promise<DomainRecord> {
    const existing = store().domains.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!existing) throw new Error(`Domain ${id} not found for tenant`);
    if (update.status !== undefined) existing.status = update.status;
    if (update.registrarRef !== undefined)
      existing.registrarRef = update.registrarRef;
    if (update.autoRenew !== undefined) existing.autoRenew = update.autoRenew;
    if (update.expiresAt !== undefined) existing.expiresAt = update.expiresAt;
    if (update.authCode !== undefined) existing.authCode = update.authCode;
    if (update.operationId !== undefined)
      existing.operationId = update.operationId;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
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

// --- W2 metering wallet (mock) ----------------------------------------------
// Single-process, so the "atomic" debit is trivially atomic under JS's
// run-to-completion: nothing can interleave between the conflict check and the
// balance mutation. The Postgres impl is what makes it survive concurrency +
// multiple processes; this mirrors its CONTRACT exactly (exactly-once on
// duplicate idempotencyKey, never double-debit).

function walletKey(tenantId: string, period: string): string {
  return `${tenantId}:${period}`;
}

const wallet = {
  async get(tenantId: string): Promise<WalletRecord | null> {
    return store().wallets.get(tenantId) ?? null;
  },
  async getBalance(tenantId: string): Promise<bigint> {
    return store().wallets.get(tenantId)?.balanceMicro ?? 0n;
  },
  async credit(tenantId: string, amountMicro: bigint): Promise<bigint> {
    const s = store();
    const existing = s.wallets.get(tenantId);
    const next: WalletRecord = {
      id: existing?.id ?? nextId("wallet"),
      tenantId,
      balanceMicro: (existing?.balanceMicro ?? 0n) + amountMicro,
      updatedAt: new Date().toISOString(),
    };
    s.wallets.set(tenantId, next);
    return next.balanceMicro;
  },
  async debit(tenantId: string, input: UsageRecordInput): Promise<DebitResult> {
    const s = store();
    // Exactly-once: a prior row with the same (tenantId, idempotencyKey) makes
    // this a no-op returning the prior record + current balance.
    const prior = s.usage.find(
      (u) => u.tenantId === tenantId && u.idempotencyKey === input.idempotencyKey,
    );
    if (prior) {
      return {
        applied: false,
        balanceMicro: s.wallets.get(tenantId)?.balanceMicro ?? 0n,
        record: prior,
      };
    }
    // Append the usage row.
    const record: UsageRecordRow = {
      id: nextId("usage"),
      tenantId,
      kind: input.kind,
      quantity: input.quantity,
      unitCostMicro: input.unitCostMicro,
      unitPriceMicro: input.unitPriceMicro,
      amountMicro: input.amountMicro,
      period: input.period,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    s.usage.push(record);
    // Debit the wallet (create it at zero first if needed) in the same "tx".
    const existing = s.wallets.get(tenantId);
    const w: WalletRecord = {
      id: existing?.id ?? nextId("wallet"),
      tenantId,
      balanceMicro: (existing?.balanceMicro ?? 0n) - input.amountMicro,
      updatedAt: new Date().toISOString(),
    };
    s.wallets.set(tenantId, w);
    return { applied: true, balanceMicro: w.balanceMicro, record };
  },
};

const usage = {
  async append(
    tenantId: string,
    input: UsageRecordInput,
  ): Promise<UsageRecordRow> {
    const record: UsageRecordRow = {
      id: nextId("usage"),
      tenantId,
      kind: input.kind,
      quantity: input.quantity,
      unitCostMicro: input.unitCostMicro,
      unitPriceMicro: input.unitPriceMicro,
      amountMicro: input.amountMicro,
      period: input.period,
      idempotencyKey: input.idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    store().usage.push(record);
    return record;
  },
  async listByPeriod(
    tenantId: string,
    period: string,
  ): Promise<UsageRecordRow[]> {
    return store()
      .usage.filter((u) => u.tenantId === tenantId && u.period === period)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async listRecent(tenantId: string, limit = 20): Promise<UsageRecordRow[]> {
    return store()
      .usage.filter((u) => u.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
};

const invoices = {
  async get(tenantId: string, period: string): Promise<InvoiceRecord | null> {
    return store().invoices.get(walletKey(tenantId, period)) ?? null;
  },
  async upsert(
    tenantId: string,
    period: string,
    totalMicro: bigint,
    status: InvoiceStatus = "open",
    providerInvoiceId: string | null = null,
  ): Promise<InvoiceRecord> {
    const s = store();
    const key = walletKey(tenantId, period);
    const existing = s.invoices.get(key);
    const now = new Date().toISOString();
    const record: InvoiceRecord = {
      id: existing?.id ?? nextId("inv"),
      tenantId,
      period,
      totalMicro,
      status,
      providerInvoiceId:
        providerInvoiceId ?? existing?.providerInvoiceId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    s.invoices.set(key, record);
    return record;
  },
  async list(tenantId: string): Promise<InvoiceRecord[]> {
    return [...store().invoices.values()]
      .filter((i) => i.tenantId === tenantId)
      .sort((a, b) => b.period.localeCompare(a.period));
  },
};

// --- W8 GBP listings (mock) --------------------------------------------------

const localListings = {
  async list(tenantId: string): Promise<LocalListingRecord[]> {
    return store()
      .localListings.filter((l) => l.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((l) => ({ ...l, categories: [...l.categories] }));
  },
  async get(tenantId: string, id: string): Promise<LocalListingRecord | null> {
    const found = store().localListings.find(
      (l) => l.id === id && l.tenantId === tenantId,
    );
    return found ? { ...found, categories: [...found.categories] } : null;
  },
  async getPrimary(tenantId: string): Promise<LocalListingRecord | null> {
    const found = store()
      .localListings.filter((l) => l.tenantId === tenantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return found ? { ...found, categories: [...found.categories] } : null;
  },
  async create(
    tenantId: string,
    input: LocalListingInput,
  ): Promise<LocalListingRecord> {
    const now = new Date().toISOString();
    const record: LocalListingRecord = {
      id: nextId("gbp"),
      tenantId,
      businessId: input.businessId ?? null,
      name: input.name,
      area: input.area,
      phone: input.phone,
      categories: input.categories ? [...input.categories] : [],
      hours: input.hours ?? null,
      status: input.status ?? "draft",
      googleLocationId: input.googleLocationId ?? null,
      operationId: input.operationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store().localListings.push(record);
    return { ...record, categories: [...record.categories] };
  },
  async update(
    tenantId: string,
    id: string,
    update: LocalListingUpdate,
  ): Promise<LocalListingRecord> {
    const existing = store().localListings.find(
      (l) => l.id === id && l.tenantId === tenantId,
    );
    if (!existing) throw new Error(`Listing ${id} not found for tenant`);
    if (update.name !== undefined) existing.name = update.name;
    if (update.area !== undefined) existing.area = update.area;
    if (update.phone !== undefined) existing.phone = update.phone;
    if (update.categories !== undefined)
      existing.categories = [...update.categories];
    if (update.hours !== undefined) existing.hours = update.hours;
    if (update.status !== undefined) existing.status = update.status;
    if (update.googleLocationId !== undefined)
      existing.googleLocationId = update.googleLocationId;
    if (update.operationId !== undefined)
      existing.operationId = update.operationId;
    existing.updatedAt = new Date().toISOString();
    return { ...existing, categories: [...existing.categories] };
  },
};

// --- W8 WhatsApp catalog products (mock) ------------------------------------

const products = {
  async list(tenantId: string): Promise<ProductRecord[]> {
    return store()
      .products.filter((p) => p.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ ...p }));
  },
  async get(tenantId: string, id: string): Promise<ProductRecord | null> {
    const found = store().products.find(
      (p) => p.id === id && p.tenantId === tenantId,
    );
    return found ? { ...found } : null;
  },
  async create(tenantId: string, input: ProductInput): Promise<ProductRecord> {
    const now = new Date().toISOString();
    const record: ProductRecord = {
      id: nextId("prod"),
      tenantId,
      businessId: input.businessId ?? null,
      name: input.name,
      description: input.description ?? "",
      priceCents: input.priceCents,
      imageUrl: input.imageUrl ?? null,
      available: input.available ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store().products.push(record);
    return { ...record };
  },
  async update(
    tenantId: string,
    id: string,
    update: ProductUpdate,
  ): Promise<ProductRecord> {
    const existing = store().products.find(
      (p) => p.id === id && p.tenantId === tenantId,
    );
    if (!existing) throw new Error(`Product ${id} not found for tenant`);
    if (update.name !== undefined) existing.name = update.name;
    if (update.description !== undefined) existing.description = update.description;
    if (update.priceCents !== undefined) existing.priceCents = update.priceCents;
    if (update.imageUrl !== undefined) existing.imageUrl = update.imageUrl;
    if (update.available !== undefined) existing.available = update.available;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  },
};

// --- W8 WhatsApp orders (mock) ----------------------------------------------

const whatsappOrders = {
  async list(tenantId: string): Promise<WhatsappOrderRecord[]> {
    return store()
      .whatsappOrders.filter((o) => o.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) }));
  },
  async get(tenantId: string, id: string): Promise<WhatsappOrderRecord | null> {
    const found = store().whatsappOrders.find(
      (o) => o.id === id && o.tenantId === tenantId,
    );
    return found
      ? { ...found, items: found.items.map((i) => ({ ...i })) }
      : null;
  },
  async create(
    tenantId: string,
    input: WhatsappOrderInput,
  ): Promise<WhatsappOrderRecord> {
    const now = new Date().toISOString();
    const record: WhatsappOrderRecord = {
      id: nextId("word"),
      tenantId,
      businessId: input.businessId ?? null,
      customerContact: input.customerContact,
      items: input.items.map((i) => ({ ...i })),
      totalCents: input.totalCents,
      status: input.status ?? "draft",
      paymentLinkRef: input.paymentLinkRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store().whatsappOrders.push(record);
    return { ...record, items: record.items.map((i) => ({ ...i })) };
  },
  async update(
    tenantId: string,
    id: string,
    update: WhatsappOrderUpdate,
  ): Promise<WhatsappOrderRecord> {
    const existing = store().whatsappOrders.find(
      (o) => o.id === id && o.tenantId === tenantId,
    );
    if (!existing) throw new Error(`Order ${id} not found for tenant`);
    if (update.items !== undefined)
      existing.items = update.items.map((i) => ({ ...i }));
    if (update.totalCents !== undefined) existing.totalCents = update.totalCents;
    if (update.status !== undefined) existing.status = update.status;
    if (update.paymentLinkRef !== undefined)
      existing.paymentLinkRef = update.paymentLinkRef;
    existing.updatedAt = new Date().toISOString();
    return { ...existing, items: existing.items.map((i) => ({ ...i })) };
  },
};

// --- W6 GitHub repos + Vercel deployments (mock) ----------------------------

const siteRepos = {
  async list(tenantId: string): Promise<SiteRepoRecord[]> {
    return store()
      .siteRepos.filter((r) => r.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  },
  async getBySlug(
    tenantId: string,
    slug: string,
  ): Promise<SiteRepoRecord | null> {
    const found = store().siteRepos.find(
      (r) => r.tenantId === tenantId && r.slug === slug,
    );
    return found ? { ...found } : null;
  },
  async ensure(
    tenantId: string,
    input: SiteRepoInput,
  ): Promise<SiteRepoRecord> {
    // Idempotent on (tenant, slug): one repo per customer site.
    const existing = store().siteRepos.find(
      (r) => r.tenantId === tenantId && r.slug === input.slug,
    );
    if (existing) return { ...existing };
    const now = new Date().toISOString();
    const record: SiteRepoRecord = {
      id: nextId("repo"),
      tenantId,
      slug: input.slug,
      repoRef: input.repoRef,
      repoUrl: input.repoUrl,
      defaultBranch: input.defaultBranch ?? "main",
      lastCommitSha: input.lastCommitSha ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store().siteRepos.push(record);
    return { ...record };
  },
  async update(
    tenantId: string,
    id: string,
    update: SiteRepoUpdate,
  ): Promise<SiteRepoRecord> {
    const existing = store().siteRepos.find(
      (r) => r.id === id && r.tenantId === tenantId,
    );
    if (!existing) throw new Error(`SiteRepo ${id} not found for tenant`);
    if (update.repoRef !== undefined) existing.repoRef = update.repoRef;
    if (update.repoUrl !== undefined) existing.repoUrl = update.repoUrl;
    if (update.defaultBranch !== undefined)
      existing.defaultBranch = update.defaultBranch;
    if (update.lastCommitSha !== undefined)
      existing.lastCommitSha = update.lastCommitSha;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  },
  async resolveByRepoRef(
    repoRef: string,
  ): Promise<{ tenantId: string; slug: string } | null> {
    // Cross-tenant (no session) — the GitHub webhook resolver. Single process in
    // mock mode; Postgres routes through a SECURITY DEFINER fn.
    const found = store().siteRepos.find((r) => r.repoRef === repoRef);
    return found ? { tenantId: found.tenantId, slug: found.slug } : null;
  },
};

const deployments = {
  async list(tenantId: string): Promise<DeploymentRecord[]> {
    return store()
      .deployments.filter((d) => d.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({ ...d }));
  },
  async listBySlug(
    tenantId: string,
    slug: string,
  ): Promise<DeploymentRecord[]> {
    return store()
      .deployments.filter((d) => d.tenantId === tenantId && d.slug === slug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({ ...d }));
  },
  async getLatestBySlug(
    tenantId: string,
    slug: string,
  ): Promise<DeploymentRecord | null> {
    const list = await this.listBySlug(tenantId, slug);
    return list[0] ?? null;
  },
  async get(tenantId: string, id: string): Promise<DeploymentRecord | null> {
    const found = store().deployments.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    return found ? { ...found } : null;
  },
  async create(
    tenantId: string,
    input: DeploymentInput,
  ): Promise<DeploymentRecord> {
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      id: nextId("dep"),
      tenantId,
      slug: input.slug,
      target: input.target ?? "static",
      status: input.status ?? "queued",
      url: input.url ?? null,
      operationId: input.operationId ?? null,
      version: input.version ?? null,
      providerDeploymentId: input.providerDeploymentId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store().deployments.push(record);
    return { ...record };
  },
  async update(
    tenantId: string,
    id: string,
    update: DeploymentUpdate,
  ): Promise<DeploymentRecord> {
    const existing = store().deployments.find(
      (d) => d.id === id && d.tenantId === tenantId,
    );
    if (!existing) throw new Error(`Deployment ${id} not found for tenant`);
    if (update.status !== undefined) existing.status = update.status;
    if (update.url !== undefined) existing.url = update.url;
    if (update.operationId !== undefined)
      existing.operationId = update.operationId;
    if (update.providerDeploymentId !== undefined)
      existing.providerDeploymentId = update.providerDeploymentId;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  },
  async getByOperationId(
    tenantId: string,
    operationId: string,
  ): Promise<DeploymentRecord | null> {
    const found = store().deployments.find(
      (d) => d.tenantId === tenantId && d.operationId === operationId,
    );
    return found ? { ...found } : null;
  },
  async resolveByProviderDeploymentId(
    providerDeploymentId: string,
  ): Promise<{ tenantId: string; deploymentId: string } | null> {
    // Cross-tenant (no session) — the webhook resolver. In mock mode a scan is
    // safe (single process); Postgres routes through a SECURITY DEFINER fn.
    const found = store().deployments.find(
      (d) => d.providerDeploymentId === providerDeploymentId,
    );
    return found ? { tenantId: found.tenantId, deploymentId: found.id } : null;
  },
};

// --- W7 agent jobs + policy (mock) ------------------------------------------

const agentJobs = {
  async list(tenantId: string): Promise<AgentJobRecord[]> {
    return store()
      .agentJobs.filter((j) => j.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => ({ ...j }));
  },
  async listRecent(tenantId: string, limit = 20): Promise<AgentJobRecord[]> {
    return (await this.list(tenantId)).slice(0, limit);
  },
  async get(tenantId: string, id: string): Promise<AgentJobRecord | null> {
    const found = store().agentJobs.find(
      (j) => j.id === id && j.tenantId === tenantId,
    );
    return found ? { ...found } : null;
  },
  async listByStatus(
    tenantId: string,
    status: AgentJobStatus,
  ): Promise<AgentJobRecord[]> {
    return store()
      .agentJobs.filter((j) => j.tenantId === tenantId && j.status === status)
      // FIFO for the queue processor: oldest queued first.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((j) => ({ ...j }));
  },
  async create(tenantId: string, input: AgentJobInput): Promise<AgentJobRecord> {
    const now = new Date().toISOString();
    const record: AgentJobRecord = {
      id: nextId("ajob"),
      tenantId,
      role: input.role,
      trigger: input.trigger,
      status: input.status ?? "queued",
      riskTier: input.riskTier ?? "review",
      inputRef: input.inputRef ?? null,
      resultRef: input.resultRef ?? null,
      prUrl: input.prUrl ?? null,
      parentJobId: input.parentJobId ?? null,
      costMicro: input.costMicro ?? 0n,
      createdAt: now,
      updatedAt: now,
    };
    store().agentJobs.push(record);
    return { ...record };
  },
  async update(
    tenantId: string,
    id: string,
    update: AgentJobUpdate,
  ): Promise<AgentJobRecord> {
    const existing = store().agentJobs.find(
      (j) => j.id === id && j.tenantId === tenantId,
    );
    if (!existing) throw new Error(`AgentJob ${id} not found for tenant`);
    if (update.status !== undefined) existing.status = update.status;
    if (update.riskTier !== undefined) existing.riskTier = update.riskTier;
    if (update.resultRef !== undefined) existing.resultRef = update.resultRef;
    if (update.prUrl !== undefined) existing.prUrl = update.prUrl;
    if (update.costMicro !== undefined) existing.costMicro = update.costMicro;
    existing.updatedAt = new Date().toISOString();
    return { ...existing };
  },
};

function defaultPolicy(tenantId: string): AgentPolicyRecord {
  const now = new Date().toISOString();
  return {
    id: `apol_${tenantId}`,
    tenantId,
    pausedByOwner: false,
    autoApproveContent: true,
    monthlySpendCapMicro: 0n,
    createdAt: now,
    updatedAt: now,
  };
}

const agentPolicies = {
  async get(tenantId: string): Promise<AgentPolicyRecord> {
    const s = store();
    let policy = s.agentPolicies.get(tenantId);
    if (!policy) {
      policy = defaultPolicy(tenantId);
      s.agentPolicies.set(tenantId, policy);
    }
    return { ...policy };
  },
  async update(
    tenantId: string,
    update: AgentPolicyUpdate,
  ): Promise<AgentPolicyRecord> {
    const current = await this.get(tenantId);
    const next: AgentPolicyRecord = {
      ...current,
      pausedByOwner: update.pausedByOwner ?? current.pausedByOwner,
      autoApproveContent:
        update.autoApproveContent ?? current.autoApproveContent,
      monthlySpendCapMicro:
        update.monthlySpendCapMicro ?? current.monthlySpendCapMicro,
      updatedAt: new Date().toISOString(),
    };
    store().agentPolicies.set(tenantId, next);
    return { ...next };
  },
};

export const memoryRepositories: Repositories = {
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
  agentJobs,
  agentPolicies,
};

// Exposed for tests so they can run against a fresh store.
export function __resetMemoryStore(): void {
  globalStore.__launchDeskStore = createStore();
}
