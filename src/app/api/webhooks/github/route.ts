// W6 — GitHub webhook (STUB).
//
// W6 SCOPE NOTE: a GitHub webhook is optional for W6 — GitHub is the source of
// truth, but the deploy lifecycle the owner cares about is settled by the Vercel
// webhook (see ../vercel/route.ts), not GitHub. This route is a fail-closed STUB
// so the surface exists with the right security shape; it is wired up for real
// in Phase 3 (agent team: workflow_run / push events drive container/K8s
// builds + the CI Medic). It signature-verifies + acks; it applies nothing.
//
// Pattern (mirrors the Paystack/Vercel webhooks): GitHub signs the raw body with
// HMAC-SHA256 using the webhook secret, sent as `x-hub-signature-256`
// ("sha256=<hex>"). FAIL CLOSED: when GITHUB_WEBHOOK_SECRET is unset, the check
// accepts ONLY in dev/mock; in production-non-mock a missing secret REJECTS.

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  MissingProductionSecretError,
  requireProductionSecret,
} from "@/lib/env";

export const dynamic = "force-dynamic";

function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Verify the GitHub signature. FAIL CLOSED in production-non-mock. */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = requireProductionSecret("GITHUB_WEBHOOK_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  if (!signature) return false;
  const provided = signature.startsWith("sha256=")
    ? signature.slice(7)
    : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqualHex(expected, provided);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let signatureOk: boolean;
  try {
    signatureOk = verifySignature(rawBody, signature);
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("github.webhook.no_secret_in_prod", {});
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 401 },
      );
    }
    throw error;
  }
  if (!signatureOk) {
    return NextResponse.json(
      { ok: false, error: "bad_signature" },
      { status: 401 },
    );
  }

  // STUB: acknowledge without applying. Phase 3 wires push/workflow_run events
  // into the container/K8s build + the agent team here.
  const event = request.headers.get("x-github-event") ?? "unknown";
  logger.info("github.webhook.acked", { event });
  return NextResponse.json({ ok: true, stub: true });
}
