import "server-only";

// Booking adapter — appointment scheduling backed by the local Booking Prisma
// model. No external API key needed for V1; the adapter is always "configured".
// WhatsApp confirmation delegates to the messaging layer (click-to-chat link).

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BookingData {
  siteSlug: string;
  customerName: string;
  customerPhone: string;
  service: string;
  date: string;   // ISO date string YYYY-MM-DD
  time: string;   // HH:MM
  notes?: string;
}

export interface BookingRecord {
  id: string;
  tenantId: string;
  siteSlug: string;
  customerName: string;
  customerPhone: string;
  service: string;
  date: string;
  time: string;
  status: string;
  notes?: string | null;
  whatsappSent: boolean;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingProvider {
  createBooking(tenantId: string, data: BookingData): Promise<BookingRecord>;
  listBookings(tenantId: string, date?: string): Promise<BookingRecord[]>;
  updateStatus(id: string, status: string): Promise<BookingRecord>;
  sendWhatsAppConfirmation(booking: BookingRecord, waNumber: string): Promise<{ url: string }>;
}

// ---------------------------------------------------------------------------
// Mock adapter — safe no-op, no DB required
// ---------------------------------------------------------------------------

export function createMockAdapter(): BookingProvider {
  const store = new Map<string, BookingRecord>();

  return {
    async createBooking(tenantId, data) {
      const record: BookingRecord = {
        id: `mock-booking-${Date.now()}`,
        tenantId,
        ...data,
        status: "pending",
        notes: data.notes ?? null,
        whatsappSent: false,
        reminderSent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(record.id, record);
      console.log("[mock:booking] createBooking", record);
      return record;
    },

    async listBookings(tenantId, date) {
      const all = Array.from(store.values()).filter((b) => b.tenantId === tenantId);
      return date ? all.filter((b) => b.date === date) : all;
    },

    async updateStatus(id, status) {
      const existing = store.get(id);
      if (!existing) throw new Error(`[mock:booking] Booking ${id} not found`);
      const updated = { ...existing, status, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },

    async sendWhatsAppConfirmation(booking, waNumber) {
      const text = encodeURIComponent(
        `Hi ${booking.customerName}, your booking for "${booking.service}" on ${booking.date} at ${booking.time} is confirmed.`,
      );
      const url = `https://wa.me/${waNumber}?text=${text}`;
      console.log("[mock:booking] sendWhatsAppConfirmation →", url);
      return { url };
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — reads/writes the Booking Prisma model directly
// ---------------------------------------------------------------------------

export function createRealAdapter(): BookingProvider {
  return {
    async createBooking(tenantId, data) {
      return prisma.booking.create({
        data: { tenantId, ...data },
      }) as unknown as BookingRecord;
    },

    async listBookings(tenantId, date) {
      return prisma.booking.findMany({
        where: { tenantId, ...(date ? { date } : {}) },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      }) as unknown as BookingRecord[];
    },

    async updateStatus(id, status) {
      return prisma.booking.update({
        where: { id },
        data: { status },
      }) as unknown as BookingRecord;
    },

    async sendWhatsAppConfirmation(booking, waNumber) {
      const text = encodeURIComponent(
        `Hi ${booking.customerName}, your booking for "${booking.service}" on ${booking.date} at ${booking.time} is confirmed.`,
      );
      const url = `https://wa.me/${waNumber}?text=${text}`;
      // Mark whatsappSent so callers can track delivery attempts.
      await prisma.booking.update({
        where: { id: booking.id },
        data: { whatsappSent: true },
      });
      return { url };
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

/** Returns the real adapter when a DATABASE_URL is present, mock otherwise. */
export function getProvider(): BookingProvider {
  if (isConfigured() && process.env.DATABASE_URL) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
