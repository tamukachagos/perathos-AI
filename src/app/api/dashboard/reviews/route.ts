// Reviews API — tenant-scoped CRUD for review management.
//
// GET  /api/dashboard/reviews  — list reviews for tenant + computed stats
// POST /api/dashboard/reviews  — create a manual review
// PATCH /api/dashboard/reviews — update review (response, featured toggle)
//
// All requests require an authenticated session. The tenantId is resolved
// from the session via requireTenant(); it is NEVER taken from the body.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getProvider } from "@/integrations/reviews";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStats(reviews: { rating: number }[]) {
  if (reviews.length === 0) {
    return { avgRating: 0, totalCount: 0, breakdown: {} as Record<number, number> };
  }
  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    sum += r.rating;
    const star = Math.min(5, Math.max(1, Math.round(r.rating)));
    breakdown[star] = (breakdown[star] ?? 0) + 1;
  }
  return {
    avgRating: Math.round((sum / reviews.length) * 10) / 10,
    totalCount: reviews.length,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// GET — list reviews + stats
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const provider = getProvider();
  const reviews = await provider.listReviews(ctx.tenantId);
  const stats = computeStats(reviews);

  return NextResponse.json({ ok: true, reviews, ...stats });
}

// ---------------------------------------------------------------------------
// POST — create a manual review
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

  const authorName =
    typeof body.authorName === "string" ? body.authorName.trim() : "";
  if (!authorName) {
    return NextResponse.json(
      { ok: false, error: "author_name_required" },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ ok: false, error: "text_required" }, { status: 400 });
  }

  const ratingRaw = Number(body.rating);
  const rating = Number.isFinite(ratingRaw)
    ? Math.min(5, Math.max(1, Math.round(ratingRaw)))
    : 5;

  const source =
    typeof body.source === "string" ? body.source.trim() : "manual";

  const provider = getProvider();
  const review = await provider.saveReview(ctx.tenantId, {
    authorName,
    text,
    rating,
    source,
    publishedAt: new Date(),
  });

  return NextResponse.json({ ok: true, review }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PATCH — update response or featured flag
//   { id, response }        — save/update reply text
//   { id, featured }        — toggle featured status
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
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

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  }

  // Ownership check: the review must belong to this tenant.
  const provider = getProvider();
  const all = await provider.listReviews(ctx.tenantId);
  const owned = all.find((r) => r.id === id);
  if (!owned) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // Route to the correct mutation.
  if (typeof body.response === "string") {
    const review = await provider.respondToReview(id, body.response.trim());
    return NextResponse.json({ ok: true, review });
  }

  if (typeof body.featured === "boolean") {
    // The reviews adapter does not have a toggleFeatured method; we reach
    // Prisma directly for this narrow field update when a real DB is present.
    // In mock mode, we update the in-memory record via saveReview.
    //
    // We use the prisma client conditionally so the mock adapter path still
    // works in local dev without DATABASE_URL.
    let review;
    if (process.env.DATABASE_URL) {
      const { prisma } = await import("@/lib/db/prisma/client");
      review = await prisma.reviewRecord.update({
        where: { id },
        data: { featured: body.featured },
      });
    } else {
      // Mock: return the updated record inline (no persistent mock store update
      // since the mock store is module-level; a refresh will reset it).
      review = { ...owned, featured: body.featured };
    }
    return NextResponse.json({ ok: true, review });
  }

  return NextResponse.json(
    { ok: false, error: "provide response or featured" },
    { status: 400 },
  );
}
