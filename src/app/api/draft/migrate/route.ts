// Draft migration endpoint.
//
// When a user signs in, the client posts their localStorage draft (from
// clientStore.ts) here. We persist it as the tenant's primary business via the
// repository — in mock mode against the in-memory repo, in Postgres mode via
// Prisma. Tenant scoping comes solely from requireTenant() (the session), never
// from the request body.

import { NextResponse } from "next/server";
import type { Business } from "@/lib/types";
import { initialBusiness } from "@/lib/platformData";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";

// Coerce arbitrary JSON into a well-formed Business (string fields only),
// falling back to the seed defaults for anything missing or wrong-typed.
function coerceBusiness(input: unknown): Business {
  const src = (input ?? {}) as Record<string, unknown>;
  const pick = (key: keyof Business): string =>
    typeof src[key] === "string" ? (src[key] as string) : initialBusiness[key];
  return {
    name: pick("name"),
    industry: pick("industry"),
    location: pick("location"),
    whatsapp: pick("whatsapp"),
    domain: pick("domain"),
    email: pick("email"),
    tone: pick("tone"),
    offer: pick("offer"),
    services: pick("services"),
  };
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body => migrate the seed defaults (no-op-ish).
  }

  const business = coerceBusiness((body as { draft?: unknown })?.draft ?? body);
  const repos = await getRepositories();

  // Only adopt the draft if the tenant has no business yet, so re-signing-in
  // does not clobber server-side edits with a stale local draft.
  const existing = await repos.businesses.getPrimary(ctx.tenantId);
  const record = existing ?? (await repos.businesses.upsertPrimary(ctx.tenantId, business));

  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: existing ? "draft.migrate.skipped" : "draft.migrate.adopted",
    targetType: "business",
    targetId: record.id,
  });

  return NextResponse.json({ ok: true, adopted: !existing, businessId: record.id });
}
