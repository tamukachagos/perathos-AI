// Public booking API — no session required.
//
// POST /api/book/[slug]   — create a booking
// GET  /api/book/[slug]   — available time slots for a date
//                           (also ?meta=1 to get site info for the booking page)
//
// Tenant is resolved from the published site's slug (same as /api/leads), never
// from the request body. Rate limit: 10 bookings per IP per day.

import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { sanitizeText } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import {
  isWhatsappBspConfigured,
  bspSendText,
} from "@/integrations/messaging/bspAdapter";

export const dynamic = "force-dynamic";

// --- Rate limiting (in-process, best-effort — same pattern as /api/leads) ----
const RATE_LIMIT = 10; // bookings
const RATE_WINDOW_MS = 86_400_000; // per 24 h per IP

const globalForRate = globalThis as unknown as {
  __bookingRate?: Map<string, { count: number; resetAt: number }>;
};
const rateMap = (globalForRate.__bookingRate ??= new Map());

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function clientIp(request: NextRequest): string {
  const platformIp =
    request.headers.get("x-vercel-forwarded-for")?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  if (platformIp) return platformIp.split(",")[0].trim();
  return "anon";
}

// Allowed time slots (same list as the booking page)
const ALLOWED_SLOTS = new Set([
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00",
]);

// Validate YYYY-MM-DD
function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface BookingBody {
  name?: unknown;
  phone?: unknown;
  service?: unknown;
  date?: unknown;
  time?: unknown;
}

// --- GET: available slots for a date, or site meta for the booking page UI ---
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = new URL(request.url);

  // ?meta=1 — return the published site info for the booking page to render
  if (url.searchParams.get("meta") === "1") {
    try {
      const repos = await getRepositories();
      const siteRecord = await repos.sites.getBySlug(slug);
      if (!siteRecord) {
        return NextResponse.json({ error: "site_not_found" }, { status: 404 });
      }
      return NextResponse.json({ site: siteRecord.site });
    } catch {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  }

  // ?date=YYYY-MM-DD — return taken slots for that date
  const date = url.searchParams.get("date") ?? "";
  if (!isValidDate(date)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  try {
    const repos = await getRepositories();
    const siteRecord = await repos.sites.getBySlug(slug);
    if (!siteRecord) {
      return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    }

    // We access the Booking model directly through Prisma (not the high-level
    // repos which don't have a bookings surface yet). In mock mode with no DB
    // we return an empty taken list — the page still works.
    let takenSlots: string[] = [];
    if (process.env.DATABASE_URL) {
      const { prisma } = await import("@/lib/db/prisma/client");
      const rows = await prisma.booking.findMany({
        where: { siteSlug: slug, date },
        select: { time: true },
      });
      takenSlots = rows.map((r) => r.time);
    }

    return NextResponse.json({ takenSlots });
  } catch {
    return NextResponse.json({ takenSlots: [] });
  }
}

// --- POST: create a booking -----------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Rate limit before any parsing
  const ip = clientIp(request);
  if (rateLimited(`${ip}:${slug}`)) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429 },
    );
  }

  let body: BookingBody;
  try {
    body = (await request.json()) as BookingBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const name = sanitizeText(asString(body.name)).slice(0, 200).trim();
  const phone = sanitizeText(asString(body.phone)).slice(0, 50).trim();
  const service = sanitizeText(asString(body.service)).slice(0, 200).trim();
  const date = asString(body.date).trim();
  const time = asString(body.time).trim();

  if (!name || !phone || !service || !date || !time) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ ok: false, error: "invalid_date" }, { status: 400 });
  }

  if (!ALLOWED_SLOTS.has(time)) {
    return NextResponse.json({ ok: false, error: "invalid_time" }, { status: 400 });
  }

  const repos = await getRepositories();
  const siteRecord = await repos.sites.getBySlug(slug);
  if (!siteRecord) {
    return NextResponse.json({ ok: false, error: "site_not_found" }, { status: 404 });
  }

  const tenantId = siteRecord.tenantId;

  // In mock/no-DB mode we skip the actual Prisma write but still return success
  // so the booking page works during development.
  if (!process.env.DATABASE_URL) {
    logger.info("booking.mock_created", {
      slug,
      date,
      time,
      service,
      tenantId,
    });
    return NextResponse.json({ ok: true, bookingId: `mock_${Date.now()}` }, { status: 201 });
  }

  const { prisma } = await import("@/lib/db/prisma/client");

  // Conflict check: reject double-booking the same slot
  const existing = await prisma.booking.findFirst({
    where: { siteSlug: slug, date, time },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "slot_taken" },
      { status: 409 },
    );
  }

  // Create the booking record
  const booking = await prisma.booking.create({
    data: {
      tenantId,
      siteSlug: slug,
      customerName: name,
      customerPhone: phone,
      service,
      date,
      time,
      status: "pending",
    },
  });

  // Upsert a CRM contact (source: "booking") — best effort, never block the
  // booking if the CRM write fails. We search by (tenantId, phone) first, then
  // create if not found (no unique index on phone in the schema yet).
  try {
    const existingContact = await prisma.crmContact.findFirst({
      where: { tenantId, phone },
      select: { id: true },
    });
    if (existingContact) {
      await prisma.crmContact.update({
        where: { id: existingContact.id },
        data: { name, lastContactAt: new Date() },
      });
    } else {
      await prisma.crmContact.create({
        data: { tenantId, name, phone, source: "booking" },
      });
    }
  } catch {
    // CRM table may not exist yet in all environments — fail gracefully.
    logger.warn("booking.crm_upsert_failed", { bookingId: booking.id, slug });
  }

  // Attempt WhatsApp confirmation — best effort
  let whatsappSent = false;
  if (isWhatsappBspConfigured()) {
    try {
      const msg =
        `Hi ${name}! Your booking at ${siteRecord.site.name} is confirmed.\n` +
        `Service: ${service}\nDate: ${date}\nTime: ${time}\n\nSee you then!`;
      await bspSendText(phone, msg);
      whatsappSent = true;
      await prisma.booking.update({
        where: { id: booking.id },
        data: { whatsappSent: true },
      });
    } catch {
      logger.warn("booking.whatsapp_failed", { bookingId: booking.id });
    }
  }

  logger.info("booking.created", {
    bookingId: booking.id,
    slug,
    date,
    time,
    service,
    tenantId,
    whatsappSent,
  });

  return NextResponse.json({ ok: true, bookingId: booking.id }, { status: 201 });
}
