// W6/W7 — GitHub webhook.
//
// W6 shipped this as a fail-closed STUB; W7 wires the `workflow_run` FAILURE
// event to the agent team: a failed CI run enqueues a CI Medic job for that
// tenant's repo (still fail-closed + W1-deduped). Everything risky the CI Medic
// later proposes still flows through the queue + ActionRouter; this route only
// SPAWNS the run. Other events (push, etc.) are still acked without applying.
//
// Pattern (mirrors the Paystack/Vercel webhooks): GitHub signs the raw body with
// HMAC-SHA256 using the webhook secret, sent as `x-hub-signature-256`
// ("sha256=<hex>"). FAIL CLOSED: when GITHUB_WEBHOOK_SECRET is unset, the check
// accepts ONLY in dev/mock; in production-non-mock a missing secret REJECTS.
// IDEMPOTENCY: events are de-duped via the W1 webhook store (atomic exactly-once
// on (provider, eventId)); a redelivery is a no-op. The tenant is resolved from
// the repo via the SECURITY DEFINER resolver (no session), then the run is
// enqueued INSIDE that tenant's scope.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/observability";
import {
  MissingProductionSecretError,
  requireProductionSecret,
} from "@/lib/env";
import { getRepositories } from "@/lib/db";
import { getStores } from "@/integrations/core/stores";
import { handleCiFailure } from "@/integrations/agentTeam/triggers";

export const dynamic = "force-dynamic";

const PROVIDER = "github";

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

  const event = request.headers.get("x-github-event") ?? "unknown";

  // Only `workflow_run` failures spawn an agent run; everything else is acked.
  if (event !== "workflow_run") {
    logger.info("github.webhook.acked", { event });
    return NextResponse.json({ ok: true, ignored: true });
  }

  let payload: WorkflowRunEvent;
  try {
    payload = JSON.parse(rawBody) as WorkflowRunEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const run = payload.workflow_run;
  const repoRef = payload.repository?.full_name ?? null;
  // We only act on a COMPLETED run that FAILED. Anything else is acked.
  if (
    payload.action !== "completed" ||
    run?.conclusion !== "failure" ||
    !repoRef
  ) {
    logger.info("github.webhook.workflow_run.ignored", {
      action: payload.action,
      conclusion: run?.conclusion ?? null,
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Dedup id: prefer GitHub's run id; else a SHA-256 of the raw body so two
  // distinct same-length events never collide.
  const eventId = String(
    run.id ?? createHash("sha256").update(rawBody).digest("hex"),
  );

  try {
    const stores = await getStores();
    if (await stores.webhookDedup.hasEvent(PROVIDER, eventId)) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    // ATOMIC exactly-once claim BEFORE enqueuing the run.
    const claimed = await stores.webhookDedup.claimEvent(PROVIDER, eventId);
    if (!claimed) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    const repos = await getRepositories();
    const outcome = await handleCiFailure(repos, {
      repoRef,
      conclusion: "failure",
      // The run name / branch is UNTRUSTED data — handed off as data, hashed by
      // the queue, never parsed for instructions.
      triggerData: `${run.name ?? ""}@${run.head_branch ?? ""}`,
    });

    logger.info("github.webhook.ci_failure", {
      enqueued: outcome.enqueued,
      reason: outcome.reason,
      jobs: outcome.jobCount,
    });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    await captureError("github.webhook.failed", error);
    return NextResponse.json(
      { ok: false, error: "webhook_failed" },
      { status: 500 },
    );
  }
}

interface WorkflowRunEvent {
  action?: string;
  workflow_run?: {
    id?: number | string;
    name?: string;
    conclusion?: string;
    head_branch?: string;
  };
  repository?: { full_name?: string };
}
