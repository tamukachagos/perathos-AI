// Prisma/Postgres reliability stores (B1/B7/B8).
//
// Selected by the factory only when DATABASE_URL is real. This module is loaded
// via dynamic import so `@prisma/client` is never evaluated in mock mode / at
// build time with no DB.
//
// Atomicity is the whole point: `consumeNonce` and `claimEvent` are single-
// statement atomic claims that survive concurrency AND multiple serverless
// processes:
//   * consumeNonce  → UPDATE approval_nonces SET consumedAt = now()
//                     WHERE nonce=$1 AND tenantId=$2 AND consumedAt IS NULL;
//                     the affected ROWCOUNT (1 vs 0) decides the single winner.
//   * claimEvent    → INSERT ... ON CONFLICT (provider,eventId) DO NOTHING;
//                     rowcount 1 = first time, 0 = redelivery.
// Tenant-owned writes (nonce ledger, operations) run inside withTenant() so the
// RLS policies scope them; the not-tenant-owned webhook ledger uses the base
// client.

import { Prisma } from "@prisma/client";
import { prisma, withTenant } from "@/lib/db/prisma/client";
import type {
  ApprovalNonceStore,
  ApprovalRecord,
  ConsumeResult,
  OperationRecord,
  OperationStatus,
  OperationStore,
  ReliabilityStores,
  StartOperationInput,
  WebhookDedupStore,
} from "./types";

interface NonceRow {
  nonce: string;
  tenantId: string;
  verb: string;
  payloadHash: string;
  idempotencyKey: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

function toApprovalRecord(row: NonceRow): ApprovalRecord {
  return {
    nonce: row.nonce,
    tenantId: row.tenantId,
    verb: row.verb,
    payloadHash: row.payloadHash,
    idempotencyKey: row.idempotencyKey,
    issuedAt: row.issuedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    consumedAt: row.consumedAt ? row.consumedAt.getTime() : null,
  };
}

const approvals: ApprovalNonceStore = {
  async recordIssued(record: Omit<ApprovalRecord, "consumedAt">): Promise<void> {
    await withTenant(record.tenantId, (tx) =>
      tx.approvalNonce.create({
        data: {
          nonce: record.nonce,
          tenantId: record.tenantId,
          verb: record.verb,
          payloadHash: record.payloadHash,
          idempotencyKey: record.idempotencyKey,
          issuedAt: new Date(record.issuedAt),
          expiresAt: new Date(record.expiresAt),
        },
      }),
    );
  },
  async getApproval(nonce: string): Promise<ApprovalRecord | undefined> {
    // No tenant context here (observability path); RLS would hide the row, so we
    // resolve the tenant from the row itself via a tenant-less raw read on the
    // base client. The base client is non-bypass, but this table also needs a
    // lookup-by-nonce; we scope it by reading then verifying in callers. For the
    // ledger we instead expose getApproval scoped through the consume path, so
    // this is best-effort and returns undefined under RLS when unscoped.
    const rows = await prisma.$queryRaw<NonceRow[]>`
      SELECT "nonce","tenantId","verb","payloadHash","idempotencyKey","issuedAt","expiresAt","consumedAt"
      FROM "approval_nonces" WHERE "nonce" = ${nonce} LIMIT 1`;
    const row = rows[0];
    return row ? toApprovalRecord(row) : undefined;
  },
  async consumeNonce(nonce: string, tenantId: string): Promise<ConsumeResult> {
    return withTenant(tenantId, async (tx) => {
      // ATOMIC single-use claim: flip consumedAt from NULL → now() for THIS
      // tenant's nonce. The affected rowcount is the arbiter.
      const affected = await tx.$executeRaw`
        UPDATE "approval_nonces"
        SET "consumedAt" = now()
        WHERE "nonce" = ${nonce}
          AND "tenantId" = ${tenantId}
          AND "consumedAt" IS NULL`;
      if (affected === 1) return { ok: true };

      // No row updated — distinguish unknown vs already-consumed vs tenant
      // mismatch for a precise denial reason. (RLS already hid other tenants'
      // rows, so a row visible here with a different tenant is impossible; we
      // still check defensively.)
      const rows = await tx.$queryRaw<Pick<NonceRow, "tenantId" | "consumedAt">[]>`
        SELECT "tenantId","consumedAt" FROM "approval_nonces"
        WHERE "nonce" = ${nonce} LIMIT 1`;
      const row = rows[0];
      if (!row) return { ok: false, reason: "unknown_nonce" };
      if (row.tenantId !== tenantId) return { ok: false, reason: "tenant_mismatch" };
      return { ok: false, reason: "already_consumed" };
    });
  },
};

interface OperationRow {
  id: string;
  tenantId: string;
  verb: string;
  target: string;
  status: string;
  detail: string;
  idempotencyKey: string;
  settleAt: Date;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function toOperationRecord(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    verb: row.verb,
    target: row.target,
    status: row.status as OperationStatus,
    detail: row.detail,
    idempotencyKey: row.idempotencyKey,
    settleAt: row.settleAt.getTime(),
    result: (row.result as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const operations: OperationStore = {
  async startOperation(input: StartOperationInput): Promise<OperationRecord> {
    return withTenant(input.tenantId, async (tx) => {
      // Idempotent on (tenantId, idempotencyKey): a retry returns the existing
      // op rather than duplicating the side effect.
      const existing = await tx.operation.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return toOperationRecord(existing as OperationRow);

      const now = Date.now();
      const id = `op_${Math.floor(now).toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const created = await tx.operation.create({
        data: {
          id,
          tenantId: input.tenantId,
          verb: input.verb,
          target: input.target,
          status: "pending",
          detail: `${input.verb} for "${input.target}" is in progress.`,
          idempotencyKey: input.idempotencyKey,
          settleAt: new Date(input.settleAt),
        },
      });
      return toOperationRecord(created as OperationRow);
    });
  },
  async settleOperation(
    id,
    status,
    detail,
    result = null,
    tenantId,
  ): Promise<OperationRecord | null> {
    // A tenantId is required to satisfy RLS; the reconcile cron and the router
    // always pass it. Without it we cannot scope, so we cannot settle.
    if (!tenantId) return null;
    return withTenant(tenantId, async (tx) => {
      // Atomic terminal transition: only flip a still-pending op (terminal
      // states are immutable). `updateMany ... WHERE status='pending'` returns
      // the count so a concurrent settle cannot double-apply.
      const affected = await tx.operation.updateMany({
        where: { id, tenantId, status: "pending" },
        data: {
          status,
          detail,
          result: (result ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      const row = await tx.operation.findFirst({ where: { id, tenantId } });
      if (!row) return null;
      // affected===0 means it was already terminal; we still return the row.
      void affected;
      return toOperationRecord(row as OperationRow);
    });
  },
  async getOperation(id, tenantId): Promise<OperationRecord | null> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.operation.findFirst({ where: { id, tenantId } });
      return row ? toOperationRecord(row as OperationRow) : null;
    });
  },
  async listOperations(tenantId): Promise<OperationRecord[]> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.operation.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => toOperationRecord(r as OperationRow));
    });
  },
  async listPending(now, tenantId): Promise<OperationRecord[]> {
    // The reconcile cron runs platform-wide (no tenant session). When no
    // tenantId is given we read on the base client; RLS makes this safe only for
    // a BYPASSRLS/maintenance role, so the cron resolves operations per-tenant.
    // When a tenantId IS given we scope through withTenant.
    if (tenantId) {
      return withTenant(tenantId, async (tx) => {
        const rows = await tx.operation.findMany({
          where: { tenantId, status: "pending", settleAt: { lte: new Date(now) } },
        });
        return rows.map((r) => toOperationRecord(r as OperationRow));
      });
    }
    const rows = await prisma.$queryRaw<OperationRow[]>`
      SELECT "id","tenantId","verb","target","status","detail","idempotencyKey","settleAt","result","createdAt","updatedAt"
      FROM "operations"
      WHERE "status" = 'pending' AND "settleAt" <= ${new Date(now)}`;
    return rows.map(toOperationRecord);
  },
  async reconcileAll(now): Promise<number> {
    // Platform-wide sweep via the SECURITY DEFINER maintenance function so the
    // non-bypass cron role can settle across tenants without a tenant session.
    const rows = await prisma.$queryRaw<{ reconcile_pending_operations: number }[]>`
      SELECT reconcile_pending_operations(${new Date(now)}) AS reconcile_pending_operations`;
    return Number(rows[0]?.reconcile_pending_operations ?? 0);
  },
};

const webhookDedup: WebhookDedupStore = {
  async claimEvent(provider: string, eventId: string): Promise<boolean> {
    // Atomic exactly-once via the unique (provider, eventId) constraint:
    // INSERT ... ON CONFLICT DO NOTHING; rowcount 1 = first time, 0 = redelivery.
    const id = `wh_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const affected = await prisma.$executeRaw`
      INSERT INTO "webhook_events" ("id","provider","eventId","createdAt")
      VALUES (${id}, ${provider}, ${eventId}, now())
      ON CONFLICT ("provider","eventId") DO NOTHING`;
    return affected === 1;
  },
  async hasEvent(provider: string, eventId: string): Promise<boolean> {
    const row = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });
    return row !== null;
  },
};

export const prismaStores: ReliabilityStores = {
  approvals,
  operations,
  webhookDedup,
};
