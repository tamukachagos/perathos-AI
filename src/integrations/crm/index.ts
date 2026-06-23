"use server";

// CRM adapter — contact management backed by the CrmContact Prisma model.
// Supports upsert-by-phone/email, pipeline stage tracking, and free-form notes.
// No external API key required; the adapter is always "configured".

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactData {
  name: string;
  phone?: string;
  email?: string;
  source?: string;
  stage?: string;
  tags?: string[];
}

export interface ContactRecord {
  id: string;
  tenantId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  source: string;
  stage: string;
  notes?: string | null;
  tags: string[];
  lastContactAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmProvider {
  upsertContact(tenantId: string, data: ContactData): Promise<ContactRecord>;
  listContacts(tenantId: string, stage?: string): Promise<ContactRecord[]>;
  updateStage(id: string, stage: string): Promise<ContactRecord>;
  addNote(id: string, note: string): Promise<ContactRecord>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): CrmProvider {
  const store = new Map<string, ContactRecord>();

  function findKey(tenantId: string, data: ContactData): string | undefined {
    for (const [k, v] of store.entries()) {
      if (v.tenantId !== tenantId) continue;
      if (data.phone && v.phone === data.phone) return k;
      if (data.email && v.email === data.email) return k;
    }
    return undefined;
  }

  return {
    async upsertContact(tenantId, data) {
      const existingKey = findKey(tenantId, data);
      if (existingKey) {
        const existing = store.get(existingKey)!;
        const updated: ContactRecord = {
          ...existing,
          ...data,
          tags: data.tags ?? existing.tags,
          updatedAt: new Date(),
        };
        store.set(existingKey, updated);
        console.log("[mock:crm] upsertContact (update)", updated.id);
        return updated;
      }
      const record: ContactRecord = {
        id: `mock-crm-${Date.now()}`,
        tenantId,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        source: data.source ?? "manual",
        stage: data.stage ?? "new",
        notes: null,
        tags: data.tags ?? [],
        lastContactAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(record.id, record);
      console.log("[mock:crm] upsertContact (create)", record.id);
      return record;
    },

    async listContacts(tenantId, stage) {
      const all = Array.from(store.values()).filter((c) => c.tenantId === tenantId);
      return stage ? all.filter((c) => c.stage === stage) : all;
    },

    async updateStage(id, stage) {
      const existing = store.get(id);
      if (!existing) throw new Error(`[mock:crm] Contact ${id} not found`);
      const updated = { ...existing, stage, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },

    async addNote(id, note) {
      const existing = store.get(id);
      if (!existing) throw new Error(`[mock:crm] Contact ${id} not found`);
      const combined = existing.notes ? `${existing.notes}\n${note}` : note;
      const updated = {
        ...existing,
        notes: combined,
        lastContactAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------

export function createRealAdapter(): CrmProvider {
  return {
    async upsertContact(tenantId, data) {
      // Try to find by phone first, then email.
      let existing = data.phone
        ? await prisma.crmContact.findFirst({ where: { tenantId, phone: data.phone } })
        : null;
      if (!existing && data.email) {
        existing = await prisma.crmContact.findFirst({ where: { tenantId, email: data.email } });
      }

      if (existing) {
        return prisma.crmContact.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            phone: data.phone,
            email: data.email,
            source: data.source,
            stage: data.stage,
            tags: data.tags,
          },
        }) as unknown as ContactRecord;
      }

      return prisma.crmContact.create({
        data: {
          tenantId,
          name: data.name,
          phone: data.phone,
          email: data.email,
          source: data.source ?? "manual",
          stage: data.stage ?? "new",
          tags: data.tags ?? [],
        },
      }) as unknown as ContactRecord;
    },

    async listContacts(tenantId, stage) {
      return prisma.crmContact.findMany({
        where: { tenantId, ...(stage ? { stage } : {}) },
        orderBy: { updatedAt: "desc" },
      }) as unknown as ContactRecord[];
    },

    async updateStage(id, stage) {
      return prisma.crmContact.update({
        where: { id },
        data: { stage },
      }) as unknown as ContactRecord;
    },

    async addNote(id, note) {
      const existing = await prisma.crmContact.findUniqueOrThrow({ where: { id } });
      const combined = existing.notes ? `${existing.notes}\n${note}` : note;
      return prisma.crmContact.update({
        where: { id },
        data: { notes: combined, lastContactAt: new Date() },
      }) as unknown as ContactRecord;
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

/** Always true — uses local DB, no external key required. */
export function isConfigured(): boolean {
  return true;
}

export function getProvider(): CrmProvider {
  if (isConfigured() && process.env.DATABASE_URL) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
