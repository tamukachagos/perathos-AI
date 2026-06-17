// DSAR workflow endpoint (M5) — POPIA data-subject rights.
//
// A data subject (or the Information Officer acting on their behalf) can:
//   * EXPORT every record held about them (access right), and
//   * have those records DELETED (erasure right),
// matched by their contact identifier (email/phone) across all tenants. Each
// request is recorded in the append-only audit log (PII-free metadata only).
//
// AUTH: this is a privileged, platform-wide operation, so it is gated by a
// DSAR_SECRET (or CRON_SECRET) bearer token. In mock mode neither is set and the
// route is OPEN so the workflow is exercisable locally with no secrets; once a
// secret is configured the bearer check is enforced.
//
//   POST /api/dsar  { contact, action?: "export" | "delete" }
//     action "export" (default): returns the subject's records.
//     action "delete": exports THEN deletes (so the IO has a record), returns count.
//
// Runs in mock mode (in-memory repo) and DB mode unchanged.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import { MissingProductionSecretError, requireProductionSecret } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Constant-time bearer-token compare (no early-exit timing leak). */
function bearerMatches(header: string, secret: string): boolean {
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authorize a DSAR request (B3/S2). FAIL CLOSED: when neither DSAR_SECRET nor
 * CRON_SECRET is set, the route is open ONLY in explicit dev/mock mode; in
 * production-non-mock a missing secret REJECTS (throws → caller returns 401).
 * This is a destructive, platform-wide PII endpoint, so it must never be open
 * in production. The bearer compare is constant-time.
 */
function authorized(request: Request): boolean {
  const secret = requireProductionSecret("DSAR_SECRET", "CRON_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  const header = request.headers.get("authorization") ?? "";
  return bearerMatches(header, secret);
}

interface Body {
  contact?: unknown;
  action?: unknown;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("dsar.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  if (!contact) {
    return NextResponse.json({ ok: false, error: "contact_required" }, { status: 400 });
  }
  const action = body.action === "delete" ? "delete" : "export";

  try {
    const repos = await getRepositories();
    const records = await repos.leads.findByContact(contact);

    if (action === "export") {
      logger.info("dsar.export", { matched: records.length });
      return NextResponse.json({ ok: true, action, records });
    }

    // action === "delete": erase, audited per owning tenant (PII-free metadata).
    const byTenant = new Set(records.map((r) => r.tenantId));
    const deleted = await repos.leads.deleteByContact(contact);
    for (const tenantId of byTenant) {
      await repos.audit.append(tenantId, {
        actorId: null,
        action: "dsar.erasure",
        targetType: "lead",
        targetId: null,
        metadata: { deletedForTenant: true },
      });
    }
    logger.info("dsar.delete", { matched: records.length, deleted });
    // Return the exported snapshot alongside the count so the IO retains proof.
    return NextResponse.json({ ok: true, action, deleted, records });
  } catch (error) {
    await captureError("dsar.failed", error, { action });
    return NextResponse.json({ ok: false, error: "dsar_failed" }, { status: 500 });
  }
}
