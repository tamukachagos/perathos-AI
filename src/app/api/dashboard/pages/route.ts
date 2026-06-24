// Pages management API (tenant-scoped).
//
//   GET    /api/dashboard/pages          — list all SitePages for the tenant's site
//   POST   /api/dashboard/pages          — create a new SitePage
//   PATCH  /api/dashboard/pages          — update a SitePage (id in body)
//   DELETE /api/dashboard/pages?id=<id>  — delete a SitePage by id
//
// Tenant scoping via requireTenant(). The tenantId is never read from the body.
// The siteSlug is resolved from the tenant's primary GeneratedSite; if no site
// exists yet the write operations return a 409.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Resolve the primary published site slug for a tenant.
async function resolvePrimarySlug(tenantId: string): Promise<string | null> {
  const { prisma } = await import("@/lib/db/prisma/client");
  const site = await prisma.generatedSite.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { slug: true },
  });
  return site?.slug ?? null;
}

// Normalize a URL path: must start with /, no trailing slash except root.
function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // Strip trailing slash unless it is just "/"
  return withSlash.length > 1 ? withSlash.replace(/\/$/, "") : withSlash;
}

// Auto-generate a URL path from a title (slugified).
function pathFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `/${slug}`;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface CreateBody {
  title?: unknown;
  path?: unknown;
  blocks?: unknown;
  published?: unknown;
  metaDesc?: unknown;
  siteSlug?: unknown; // optional override; server resolves it if omitted
}

interface PatchBody {
  id?: unknown;
  title?: unknown;
  path?: unknown;
  blocks?: unknown;
  published?: unknown;
  metaDesc?: unknown;
}

// ---------------------------------------------------------------------------
// GET — list all pages for the tenant's primary site
// ---------------------------------------------------------------------------

export async function GET() {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");
    const pages = await prisma.sitePage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        siteSlug: true,
        path: true,
        title: true,
        metaDesc: true,
        blocks: true,
        published: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ ok: true, pages });
  } catch (err) {
    logger.error("pages.list.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a new page
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const title = asString(body.title).trim();
  if (!title) {
    return NextResponse.json({ ok: false, error: "title_required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");

    // Resolve siteSlug: use caller-provided if valid, else look up primary site.
    let siteSlug = asString(body.siteSlug).trim() || null;
    if (!siteSlug) {
      siteSlug = await resolvePrimarySlug(ctx.tenantId);
    }
    if (!siteSlug) {
      return NextResponse.json(
        { ok: false, error: "no_site_found" },
        { status: 409 },
      );
    }

    // Derive path from body or auto-generate from title.
    const rawPath = asString(body.path).trim();
    const pagePath = rawPath ? normalizePath(rawPath) : pathFromTitle(title);

    // Validate blocks: must be an array if provided.
    const rawBlocks = body.blocks;
    const blocks = Array.isArray(rawBlocks) ? rawBlocks : [];

    const published =
      body.published === true || body.published === "true" ? true : false;

    const page = await prisma.sitePage.create({
      data: {
        tenantId: ctx.tenantId,
        siteSlug,
        path: pagePath,
        title,
        metaDesc: asString(body.metaDesc).trim() || null,
        blocks,
        published,
      },
    });

    logger.info("page.created", { tenantId: ctx.tenantId, pageId: page.id, siteSlug, path: pagePath });

    return NextResponse.json({ ok: true, page }, { status: 201 });
  } catch (err: unknown) {
    // Unique constraint violation on (siteSlug, path)
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint") || msg.includes("unique constraint")) {
      return NextResponse.json({ ok: false, error: "path_conflict" }, { status: 409 });
    }
    logger.error("pages.create.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — update title, path, blocks, published, metaDesc
// ---------------------------------------------------------------------------

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

  const id = asString(body.id).trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");

    // Ensure the page belongs to this tenant.
    const existing = await prisma.sitePage.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    const title = asString(body.title).trim();
    if (title) updateData.title = title;

    const rawPath = asString(body.path).trim();
    if (rawPath) updateData.path = normalizePath(rawPath);

    if (body.metaDesc !== undefined) {
      updateData.metaDesc = asString(body.metaDesc).trim() || null;
    }

    if (body.blocks !== undefined) {
      updateData.blocks = Array.isArray(body.blocks) ? body.blocks : [];
    }

    if (body.published !== undefined) {
      updateData.published =
        body.published === true || body.published === "true";
    }

    const page = await prisma.sitePage.update({
      where: { id },
      data: updateData,
    });

    logger.info("page.updated", { tenantId: ctx.tenantId, pageId: id });

    return NextResponse.json({ ok: true, page });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint") || msg.includes("unique constraint")) {
      return NextResponse.json({ ok: false, error: "path_conflict" }, { status: 409 });
    }
    logger.error("pages.patch.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — delete a page by id
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db/prisma/client");

    // Ensure the page belongs to this tenant before deleting.
    const existing = await prisma.sitePage.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    await prisma.sitePage.delete({ where: { id } });

    logger.info("page.deleted", { tenantId: ctx.tenantId, pageId: id });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("pages.delete.error", { err });
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
