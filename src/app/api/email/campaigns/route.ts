// Email campaigns CRUD API — tenant-scoped.
//
// GET   /api/email/campaigns           — list campaigns for tenant
// POST  /api/email/campaigns           — create campaign
// PATCH /api/email/campaigns?id=<id>   — update campaign (subject, body, schedule)
//
// Auth required. tenantId is always from session, never from body.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { prisma } from "@/lib/db/prisma/client";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — list campaigns for the authenticated tenant
// ---------------------------------------------------------------------------

export async function GET() {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const campaigns = await prisma.emailCampaign.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ ok: true, campaigns });
}

// ---------------------------------------------------------------------------
// POST — create a campaign
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml : "";
  const scheduledAt =
    typeof body.scheduledAt === "string" && body.scheduledAt
      ? new Date(body.scheduledAt)
      : null;

  if (!name || !subject || !bodyHtml) {
    return NextResponse.json(
      { ok: false, error: "name, subject, and bodyHtml are required" },
      { status: 400 },
    );
  }

  const campaign = await prisma.emailCampaign.create({
    data: {
      tenantId: ctx.tenantId,
      name,
      subject,
      bodyHtml,
      status: scheduledAt ? "scheduled" : "draft",
      scheduledAt,
    },
  });

  return NextResponse.json({ ok: true, campaign }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PATCH — update a campaign
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  // Verify ownership
  const existing = await prisma.emailCampaign.findFirst({
    where: { id, tenantId: ctx.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (existing.status === "sent" || existing.status === "sending") {
    return NextResponse.json(
      { ok: false, error: "cannot_edit_sent_campaign" },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const updates: {
    name?: string;
    subject?: string;
    bodyHtml?: string;
    scheduledAt?: Date | null;
    status?: string;
  } = {};

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body.subject === "string" && body.subject.trim()) {
    updates.subject = body.subject.trim();
  }
  if (typeof body.bodyHtml === "string") {
    updates.bodyHtml = body.bodyHtml;
  }
  if (body.scheduledAt === null) {
    updates.scheduledAt = null;
    updates.status = "draft";
  } else if (typeof body.scheduledAt === "string" && body.scheduledAt) {
    updates.scheduledAt = new Date(body.scheduledAt);
    updates.status = "scheduled";
  }

  const campaign = await prisma.emailCampaign.update({
    where: { id },
    data: updates,
  });

  return NextResponse.json({ ok: true, campaign });
}
