// W6 — Vercel deploy webhook (§5.3).
//
// Receives Vercel deployment lifecycle events and settles the corresponding
// async W1 operation + Deployment row:
//   * deployment.succeeded → operation `succeeded`, deployment `live` + url
//   * deployment.error      → operation `failed`,    deployment `failed`
//
// Reuses the M6/Paystack webhook PATTERN exactly:
//   * SIGNATURE VERIFY — Vercel signs the raw body with HMAC-SHA1 using the
//     webhook secret, sent as `x-vercel-signature`. Constant-time compare.
//     FAIL CLOSED: when VERCEL_WEBHOOK_SECRET is unset, the check accepts ONLY in
//     dev/mock; in production-non-mock a missing secret REJECTS (401).
//   * IDEMPOTENCY — events de-duped via the W1 webhook store (atomic exactly-once
//     on (provider, eventId)); a redelivery is a no-op.
//   * AUDIT — every handled/ignored event appends a PII-free audit entry under
//     the owning tenant, resolved from the Deployment (NOT a session).
//   * SETTLE — via settleOperation (the single async settlement entry point).

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRepositories } from "@/lib/db";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import {
  MissingProductionSecretError,
  requireProductionSecret,
} from "@/lib/env";
import { getStores } from "@/integrations/core/stores";
import { settleOperation } from "@/integrations/core/operationStore";
import { settleDeployment } from "@/integrations/hosting/service";

export const dynamic = "force-dynamic";

const PROVIDER = "vercel";

/** Constant-time hex-string compare (no early-exit length leak beyond length). */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify the Vercel signature. FAIL CLOSED: when VERCEL_WEBHOOK_SECRET is unset,
 * the request is ACCEPTED only in dev/mock; in production-non-mock a missing
 * secret REJECTS (requireProductionSecret throws → 401). With the key set, the
 * HMAC-SHA1 of the raw body must match `x-vercel-signature`.
 */
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = requireProductionSecret("VERCEL_WEBHOOK_SECRET");
  if (!secret) return true; // dev/mock only — throws in production-non-mock
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  return constantTimeEqualHex(expected, signature);
}

interface VercelEvent {
  /** Vercel event id (used for idempotency); falls back to a body hash. */
  id?: string;
  /** e.g. "deployment.succeeded" | "deployment.error". */
  type?: string;
  payload?: {
    deployment?: { id?: string; url?: string };
    /** Some Vercel shapes nest the deployment id directly. */
    deploymentId?: string;
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-vercel-signature");

  let signatureOk: boolean;
  try {
    signatureOk = verifySignature(rawBody, signature);
  } catch (error) {
    if (error instanceof MissingProductionSecretError) {
      logger.info("vercel.webhook.no_secret_in_prod", {});
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

  let event: VercelEvent;
  try {
    event = JSON.parse(rawBody) as VercelEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Dedup id: prefer Vercel's own event id; else a SHA-256 of the raw body so
  // two distinct same-length events never collide.
  const eventId = String(
    event.id ??
      `${event.type ?? "?"}:${createHash("sha256").update(rawBody).digest("hex")}`,
  );

  const stores = await getStores();
  if (await stores.webhookDedup.hasEvent(PROVIDER, eventId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    const repos = await getRepositories();
    const providerDeploymentId =
      event.payload?.deployment?.id ?? event.payload?.deploymentId ?? null;

    if (!providerDeploymentId) {
      logger.info("vercel.webhook.no_deployment_id", { type: event.type });
      await stores.webhookDedup.claimEvent(PROVIDER, eventId);
      return NextResponse.json({ ok: true, unresolved: true });
    }

    // Resolve the owning tenant + Deployment from the vendor deployment id
    // (cross-tenant, no session — the W1 SECURITY DEFINER pattern).
    const resolved = await repos.deployments.resolveByProviderDeploymentId(
      providerDeploymentId,
    );
    if (!resolved) {
      logger.info("vercel.webhook.unresolved", { type: event.type });
      await stores.webhookDedup.claimEvent(PROVIDER, eventId);
      return NextResponse.json({ ok: true, unresolved: true });
    }
    const { tenantId, deploymentId } = resolved;

    // ATOMIC exactly-once claim BEFORE applying the side effect.
    const claimed = await stores.webhookDedup.claimEvent(PROVIDER, eventId);
    if (!claimed) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const deployment = await repos.deployments.get(tenantId, deploymentId);
    const opId = deployment?.operationId ?? null;

    switch (event.type) {
      case "deployment.succeeded":
      case "deployment-ready":
      case "deployment.ready": {
        if (opId) {
          await settleOperation(
            opId,
            "succeeded",
            "Site deployed and live.",
            { settledBy: "vercel-webhook" },
            tenantId,
          );
        }
        await settleDeployment(repos, tenantId, deploymentId, "live");
        break;
      }
      case "deployment.error":
      case "deployment.canceled": {
        if (opId) {
          await settleOperation(
            opId,
            "failed",
            "The deploy did not complete.",
            { settledBy: "vercel-webhook" },
            tenantId,
          );
        }
        await settleDeployment(repos, tenantId, deploymentId, "failed");
        break;
      }
      default:
        logger.info("vercel.webhook.ignored", { type: event.type });
    }

    await repos.audit.append(tenantId, {
      actorId: null,
      action: "hosting.deploy.webhook",
      targetType: "deployment",
      targetId: deploymentId,
      metadata: { type: event.type, eventId, provider: PROVIDER },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await captureError("vercel.webhook.failed", error);
    return NextResponse.json(
      { ok: false, error: "webhook_failed" },
      { status: 500 },
    );
  }
}
