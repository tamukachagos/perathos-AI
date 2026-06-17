// Async-operation polling endpoint (M3).
//
//   GET /api/operations/:id  — read an OperationRef's current state. Reading
//   triggers the mock reconciliation, so a few polls settle a pending op to a
//   terminal state with no external scheduler. In M4 a signed vendor webhook /
//   Cron drives the SAME settlement via operationStore.settleOperation().
//
// Tenant-scoped: an op is only readable by the tenant that started it.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { readOperation } from "@/integrations/core/actionRouter";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const op = readOperation(id, ctx.tenantId);
  if (!op) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    operation: {
      id: op.id,
      verb: op.verb,
      target: op.target,
      status: op.status,
      detail: op.detail,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      result: op.result,
    },
  });
}
