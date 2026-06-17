// POPIA-compliant leads capture endpoint.
//
// The published site's LeadForm (a client island) POSTs here. The request is
// PUBLIC (no session): the lead's owning tenant + business are resolved from the
// site `slug`, never from the request body, so a caller cannot write into
// another tenant. A lead is ONLY persisted when consent is explicitly true; the
// consent timestamp, processing purpose, marketing opt-in, and a retention/
// expiry date (per the M1 schema, drives the M5 purge Cron) are recorded.
//
// Runs in mock mode (in-memory repo) and DB mode unchanged.

import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { sanitizeText } from "@/lib/sanitize";
import { PROCESSING_PURPOSE, retentionUntil } from "@/lib/popia";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// --- Basic in-memory rate limiting (per-process, best-effort) ----------------
// A real deployment uses a shared store (e.g. Upstash) behind the same shape;
// this keeps the endpoint from being trivially flooded in mock/single-instance
// mode and is intentionally simple (no external dependency).
const RATE_LIMIT = 5; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per client key
const globalForRate = globalThis as unknown as {
  __leadRate?: Map<string, { count: number; resetAt: number }>;
};
const rateMap = (globalForRate.__leadRate ??= new Map());

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

function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? "anon").trim() || "anon";
}

// --- Input validation --------------------------------------------------------

interface LeadBody {
  slug?: unknown;
  name?: unknown;
  contact?: unknown;
  message?: unknown;
  consent?: unknown;
  marketingOptIn?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  if (rateLimited(clientKey(request))) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429 },
    );
  }

  let body: LeadBody;
  try {
    body = (await request.json()) as LeadBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  // POPIA gate: no consent => no storage. This is the FIRST check after parsing.
  if (body.consent !== true) {
    return NextResponse.json(
      { ok: false, error: "consent_required" },
      { status: 422 },
    );
  }

  const slug = asString(body.slug).trim();
  // Sanitize free-text before it is stored (defence in depth; leads may later be
  // shown in the dashboard).
  const name = sanitizeText(asString(body.name)).slice(0, 200);
  const contact = sanitizeText(asString(body.contact)).slice(0, 200);
  const message = sanitizeText(asString(body.message)).slice(0, 2000);

  if (!slug || !name || !contact) {
    return NextResponse.json(
      { ok: false, error: "missing_fields" },
      { status: 400 },
    );
  }

  const repos = await getRepositories();
  // Resolve the owning tenant + business from the published site (NOT the body).
  const site = await repos.sites.getBySlug(slug);
  if (!site) {
    return NextResponse.json(
      { ok: false, error: "site_not_found" },
      { status: 404 },
    );
  }

  const now = new Date();
  const lead = await repos.leads.create(site.tenantId, {
    businessId: site.businessId,
    name,
    contact,
    message,
    purpose: PROCESSING_PURPOSE,
    consent: true,
    consentAt: now.toISOString(),
    marketingOptIn: body.marketingOptIn === true,
    retentionUntil: retentionUntil(now).toISOString(),
  });

  // PII-free audit entry under the owning tenant.
  await repos.audit.append(site.tenantId, {
    actorId: null,
    action: "lead.captured",
    targetType: "lead",
    targetId: lead.id,
    metadata: { slug, marketingOptIn: lead.marketingOptIn },
  });

  // PII-free structured log (the logger scrubs values defensively too).
  logger.info("lead.captured", {
    slug,
    leadId: lead.id,
    marketingOptIn: lead.marketingOptIn,
  });

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
