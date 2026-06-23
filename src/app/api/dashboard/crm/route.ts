// CRM contacts API — tenant-scoped CRUD for the pipeline view.
//
// GET  /api/dashboard/crm           — list contacts (?stage=new&q=jane)
// POST /api/dashboard/crm           — create a contact
// PATCH /api/dashboard/crm          — update stage or append a note
//
// All requests require an authenticated session. The tenantId is resolved
// from the session via requireTenant(); it is NEVER taken from the body.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/lib/authz";
import { getProvider } from "@/integrations/crm";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — list contacts for the authenticated tenant
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const stage = searchParams.get("stage") ?? undefined;
  const q = searchParams.get("q")?.toLowerCase() ?? "";

  const crm = getProvider();
  let contacts = await crm.listContacts(ctx.tenantId, stage);

  if (q) {
    contacts = contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }

  return NextResponse.json({ ok: true, contacts });
}

// ---------------------------------------------------------------------------
// POST — create a new contact
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
  if (!name) {
    return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
  }

  const crm = getProvider();
  const contact = await crm.upsertContact(ctx.tenantId, {
    name,
    phone: typeof body.phone === "string" ? body.phone.trim() || undefined : undefined,
    email: typeof body.email === "string" ? body.email.trim() || undefined : undefined,
    source: typeof body.source === "string" ? body.source : "manual",
    stage: typeof body.stage === "string" ? body.stage : "new",
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
  });

  return NextResponse.json({ ok: true, contact }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PATCH — update stage OR append a note
//   { id, stage }      — move to a pipeline stage
//   { id, note }       — append a note (+ sets lastContactAt)
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

  const crm = getProvider();

  // Verify ownership: list for this tenant and check the id is present.
  // (The real adapter's updateStage/addNote accept a bare id; this check
  //  prevents a tenant from patching another tenant's contact by guessing ids.)
  const all = await crm.listContacts(ctx.tenantId);
  const owned = all.find((c) => c.id === id);
  if (!owned) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  let contact;
  if (typeof body.note === "string" && body.note.trim()) {
    contact = await crm.addNote(id, body.note.trim());
  } else if (typeof body.stage === "string") {
    contact = await crm.updateStage(id, body.stage);
  } else {
    return NextResponse.json(
      { ok: false, error: "provide stage or note" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, contact });
}
