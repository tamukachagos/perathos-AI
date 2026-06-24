import "server-only";

// Invoice adapter — customer-facing invoices backed by the CustomerInvoice
// Prisma model. Invoice numbers follow an INV-001 sequence per tenant.
// PDF download is served at /api/invoice/[id]/pdf.
// No external API key required; the adapter is always "configured".

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitCents: number;
}

export interface InvoiceData {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  items: InvoiceItem[];
  subtotalCents: number;
  taxCents?: number;
  totalCents: number;
  dueDate?: string;
  notes?: string;
}

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  number: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  items: InvoiceItem[];
  subtotalCents: bigint;
  taxCents: bigint;
  totalCents: bigint;
  status: string;
  dueDate?: string | null;
  pdfUrl?: string | null;
  paymentRef?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceProvider {
  createInvoice(tenantId: string, data: InvoiceData): Promise<InvoiceRecord>;
  listInvoices(tenantId: string): Promise<InvoiceRecord[]>;
  markPaid(id: string, ref: string): Promise<InvoiceRecord>;
  generatePdfUrl(id: string): string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextInvoiceNumber(existing: string[]): string {
  if (existing.length === 0) return "INV-001";
  const nums = existing
    .map((n) => parseInt(n.replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `INV-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): InvoiceProvider {
  const store = new Map<string, InvoiceRecord>();

  return {
    async createInvoice(tenantId, data) {
      const existing = Array.from(store.values())
        .filter((i) => i.tenantId === tenantId)
        .map((i) => i.number);
      const number = nextInvoiceNumber(existing);
      const id = `mock-inv-${Date.now()}`;
      const record: InvoiceRecord = {
        id,
        tenantId,
        number,
        customerName: data.customerName,
        customerEmail: data.customerEmail ?? null,
        customerPhone: data.customerPhone ?? null,
        items: data.items,
        subtotalCents: BigInt(data.subtotalCents),
        taxCents: BigInt(data.taxCents ?? 0),
        totalCents: BigInt(data.totalCents),
        status: "draft",
        dueDate: data.dueDate ?? null,
        pdfUrl: `/api/invoice/${id}/pdf`,
        paymentRef: null,
        notes: data.notes ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(id, record);
      console.log("[mock:invoice] createInvoice", record.number);
      return record;
    },

    async listInvoices(tenantId) {
      return Array.from(store.values()).filter((i) => i.tenantId === tenantId);
    },

    async markPaid(id, ref) {
      const existing = store.get(id);
      if (!existing) throw new Error(`[mock:invoice] Invoice ${id} not found`);
      const updated = { ...existing, status: "paid", paymentRef: ref, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },

    generatePdfUrl(id) {
      return `/api/invoice/${id}/pdf`;
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter
// ---------------------------------------------------------------------------

export function createRealAdapter(): InvoiceProvider {
  return {
    async createInvoice(tenantId, data) {
      const existing = await prisma.customerInvoice.findMany({
        where: { tenantId },
        select: { number: true },
      });
      const number = nextInvoiceNumber(existing.map((e) => e.number));
      const id = crypto.randomUUID();
      const pdfUrl = `/api/invoice/${id}/pdf`;
      return prisma.customerInvoice.create({
        data: {
          id,
          tenantId,
          number,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone,
          items: data.items as never,
          subtotalCents: BigInt(data.subtotalCents),
          taxCents: BigInt(data.taxCents ?? 0),
          totalCents: BigInt(data.totalCents),
          dueDate: data.dueDate,
          pdfUrl,
          notes: data.notes,
        },
      }) as unknown as InvoiceRecord;
    },

    async listInvoices(tenantId) {
      return prisma.customerInvoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      }) as unknown as InvoiceRecord[];
    },

    async markPaid(id, ref) {
      return prisma.customerInvoice.update({
        where: { id },
        data: { status: "paid", paymentRef: ref },
      }) as unknown as InvoiceRecord;
    },

    generatePdfUrl(id) {
      return `/api/invoice/${id}/pdf`;
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

export function getProvider(): InvoiceProvider {
  if (isConfigured() && process.env.DATABASE_URL) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
