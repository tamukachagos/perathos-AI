import "server-only";

// Pages adapter — multi-page site management backed by the SitePage Prisma model.
// No external API key required; the adapter is always "configured".
// A page is identified by (siteSlug, path). Blocks are stored as JSON.

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageBlock {
  type: string;
  props?: Record<string, unknown>;
}

export interface PageData {
  path: string;   // e.g. "/about" or "/"
  title: string;
  metaDesc?: string;
  blocks: PageBlock[];
}

export interface PageRecord {
  id: string;
  tenantId: string;
  siteSlug: string;
  path: string;
  title: string;
  metaDesc?: string | null;
  blocks: PageBlock[];
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PagesProvider {
  createPage(tenantId: string, siteSlug: string, data: PageData): Promise<PageRecord>;
  listPages(tenantId: string, siteSlug: string): Promise<PageRecord[]>;
  getPage(siteSlug: string, path: string): Promise<PageRecord | null>;
  updatePage(id: string, blocks: PageBlock[]): Promise<PageRecord>;
  publishPage(id: string): Promise<PageRecord>;
  deletePage(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): PagesProvider {
  const store = new Map<string, PageRecord>();

  function slugPath(siteSlug: string, path: string): string {
    return `${siteSlug}::${path}`;
  }

  return {
    async createPage(tenantId, siteSlug, data) {
      const key = slugPath(siteSlug, data.path);
      if (store.has(key)) {
        throw new Error(`[mock:pages] Page "${data.path}" already exists in site "${siteSlug}"`);
      }
      const record: PageRecord = {
        id: `mock-page-${Date.now()}`,
        tenantId,
        siteSlug,
        path: data.path,
        title: data.title,
        metaDesc: data.metaDesc ?? null,
        blocks: data.blocks,
        published: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(key, record);
      console.log("[mock:pages] createPage", siteSlug, data.path);
      return record;
    },

    async listPages(tenantId, siteSlug) {
      return Array.from(store.values()).filter(
        (p) => p.tenantId === tenantId && p.siteSlug === siteSlug,
      );
    },

    async getPage(siteSlug, path) {
      return store.get(slugPath(siteSlug, path)) ?? null;
    },

    async updatePage(id, blocks) {
      for (const [key, page] of store.entries()) {
        if (page.id === id) {
          const updated = { ...page, blocks, updatedAt: new Date() };
          store.set(key, updated);
          return updated;
        }
      }
      throw new Error(`[mock:pages] Page ${id} not found`);
    },

    async publishPage(id) {
      for (const [key, page] of store.entries()) {
        if (page.id === id) {
          const updated = { ...page, published: true, updatedAt: new Date() };
          store.set(key, updated);
          return updated;
        }
      }
      throw new Error(`[mock:pages] Page ${id} not found`);
    },

    async deletePage(id) {
      for (const [key, page] of store.entries()) {
        if (page.id === id) {
          store.delete(key);
          return;
        }
      }
      throw new Error(`[mock:pages] Page ${id} not found`);
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------

export function createRealAdapter(): PagesProvider {
  return {
    async createPage(tenantId, siteSlug, data) {
      return prisma.sitePage.create({
        data: {
          tenantId,
          siteSlug,
          path: data.path,
          title: data.title,
          metaDesc: data.metaDesc,
          blocks: data.blocks as never,
        },
      }) as unknown as PageRecord;
    },

    async listPages(tenantId, siteSlug) {
      return prisma.sitePage.findMany({
        where: { tenantId, siteSlug },
        orderBy: { path: "asc" },
      }) as unknown as PageRecord[];
    },

    async getPage(siteSlug, path) {
      return prisma.sitePage.findUnique({
        where: { siteSlug_path: { siteSlug, path } },
      }) as unknown as PageRecord | null;
    },

    async updatePage(id, blocks) {
      return prisma.sitePage.update({
        where: { id },
        data: { blocks: blocks as never },
      }) as unknown as PageRecord;
    },

    async publishPage(id) {
      return prisma.sitePage.update({
        where: { id },
        data: { published: true },
      }) as unknown as PageRecord;
    },

    async deletePage(id) {
      await prisma.sitePage.delete({ where: { id } });
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

export function getProvider(): PagesProvider {
  if (isConfigured() && process.env.DATABASE_URL) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
