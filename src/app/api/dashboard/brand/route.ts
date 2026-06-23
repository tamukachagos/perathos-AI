// Brand kit CRUD endpoint.
//
//   GET   /api/dashboard/brand   — fetch the tenant's BrandKit row
//   PATCH /api/dashboard/brand   — update one or more BrandKit fields
//
// Auth required for both methods.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { prisma } from "@/lib/db/prisma/client";

export const dynamic = "force-dynamic";

// --- GET: fetch brand kit for tenant -----------------------------------------

export async function GET() {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const brandKit = await prisma.brandKit.findUnique({
    where: { tenantId: ctx.tenantId },
  });

  return NextResponse.json({ ok: true, brandKit: brandKit ?? null });
}

// --- PATCH: update brand kit fields ------------------------------------------

interface PatchBody {
  logoUrl?: unknown;
  logoPrompt?: unknown;
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
  fontFamily?: unknown;
  tagline?: unknown;
}

const ALLOWED_STRING_FIELDS = [
  "logoUrl",
  "logoPrompt",
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "fontFamily",
  "tagline",
] as const;

type AllowedField = (typeof ALLOWED_STRING_FIELDS)[number];

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Only accept the known string fields; strip anything else
  const update: Partial<Record<AllowedField, string | null>> = {};
  for (const field of ALLOWED_STRING_FIELDS) {
    const val = body[field];
    if (val === undefined) continue;
    if (val === null) {
      update[field] = null;
    } else if (typeof val === "string") {
      update[field] = val.trim() || null;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_valid_fields" },
      { status: 400 },
    );
  }

  const brandKit = await prisma.brandKit.upsert({
    where: { tenantId: ctx.tenantId },
    create: { tenantId: ctx.tenantId, ...update },
    update,
  });

  return NextResponse.json({ ok: true, brandKit });
}
