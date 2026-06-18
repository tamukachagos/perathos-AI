// W4 — Postgres-backed domain register. Runs in the db-tests CI job (DATABASE_URL
// set, app role non-superuser/non-BYPASSRLS so RLS is enforced). Asserts:
//   * domain.register creates a TENANT-SCOPED async operation under RLS,
//   * the wallet is debited EXACTLY ONCE (a retry of the same op key never
//     double-debits),
//   * the persisted Domain row is tenant-owned with the registrar + tld set,
//   * the authCode round-trips ENCRYPTED at rest (transfer path).

import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TENANT_A, TENANT_B } from "@/lib/db/testdb";
import { getRepositories } from "@/lib/db";
import { __resetStoreFactory } from "@/integrations/core/stores";
import { activatePlan } from "@/lib/billing/service";
import { initialBusiness } from "@/lib/platformData";
import { executeAction } from "@/integrations/core/actionRouter";
import {
  DEFAULT_TOKEN_TTL_MS,
  digestPayload,
  issueToken,
  mintNonce,
} from "@/integrations/core/approvalToken";
import { recordIssued } from "@/integrations/core/approvalStore";
import {
  meterDomainVerb,
  upsertDomainForRegister,
  upsertDomainForTransfer,
} from "./service";
import { decryptAuthCode } from "./fieldCrypto";

async function approve(
  tenantId: string,
  verb: string,
  payload: Record<string, unknown>,
  key: string,
): Promise<string> {
  const payloadHash = digestPayload(payload);
  const nonce = mintNonce();
  const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS;
  const token = issueToken({ verb, payloadHash, idempotencyKey: key, nonce, expiresAt });
  await recordIssued({
    nonce,
    tenantId,
    verb,
    payloadHash,
    idempotencyKey: key,
    issuedAt: Date.now(),
    expiresAt,
  });
  return token;
}

describe("domain.register (Postgres) — tenant-scoped op + exactly-once debit", () => {
  beforeEach(async () => {
    __resetStoreFactory();
    await resetDb();
  });

  it("creates a tenant-scoped operation, persists the domain, debits the wallet once", async () => {
    const repos = await getRepositories();
    await activatePlan(repos, TENANT_A, "pro");
    await repos.wallet.credit(TENANT_A, 100_000_000n); // R1000

    const hostname = "freshstore.co.za";
    const payload = { domain: hostname };
    const idem = "domreg-a-1";
    const token = await approve(TENANT_A, "domain.register", payload, idem);

    const outcome = await executeAction(
      { audit: repos.audit, subscriptions: repos.subscriptions, wallet: repos.wallet },
      {
        tenantId: TENANT_A,
        actorId: "user-a",
        verb: "domain.register",
        business: initialBusiness,
        payload,
        idempotencyKey: idem,
        approvalToken: token,
        settleDelayMs: 60_000,
      },
    );
    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;

    // Persist the domain + meter (what the server action does on accept).
    await upsertDomainForRegister(repos, {
      tenantId: TENANT_A,
      hostname,
      operationId: outcome.operation.id,
    });
    const balanceBefore = await repos.wallet.getBalance(TENANT_A);
    await meterDomainVerb(repos, {
      tenantId: TENANT_A,
      kind: "domain.register",
      hostname,
      idempotencyKey: idem,
    });
    const balanceAfter = await repos.wallet.getBalance(TENANT_A);
    expect(balanceAfter).toBeLessThan(balanceBefore); // debited once

    // A RETRY of the same op key must NOT debit again (exactly-once).
    await meterDomainVerb(repos, {
      tenantId: TENANT_A,
      kind: "domain.register",
      hostname,
      idempotencyKey: idem,
    });
    expect(await repos.wallet.getBalance(TENANT_A)).toBe(balanceAfter);

    // The domain row is tenant-owned with registrar routing set.
    const domain = await repos.domains.getByHostname(TENANT_A, hostname);
    expect(domain).not.toBeNull();
    expect(domain?.registrar).toBe("za");
    expect(domain?.tld).toBe("co.za");
    expect(domain?.status).toBe("pending_registration");

    // Tenant B cannot see tenant A's domain (RLS + app scope).
    expect(await repos.domains.getByHostname(TENANT_B, hostname)).toBeNull();
    expect(await repos.domains.list(TENANT_B)).toHaveLength(0);
  });

  it("authCode round-trips ENCRYPTED at rest (transfer)", async () => {
    const repos = await getRepositories();
    const record = await upsertDomainForTransfer(repos, {
      tenantId: TENANT_A,
      hostname: "moving.com",
      authCode: "AUTH-PLAIN-XYZ",
    });
    // The stored value is ciphertext, not the plaintext.
    expect(record.authCode).toBeTruthy();
    expect(record.authCode).not.toBe("AUTH-PLAIN-XYZ");

    // Re-read from the DB and decrypt back to the original.
    const reread = await repos.domains.getByHostname(TENANT_A, "moving.com");
    expect(reread?.authCode).toBeTruthy();
    expect(decryptAuthCode(reread!.authCode as string)).toBe("AUTH-PLAIN-XYZ");
    expect(reread?.status).toBe("transfer_pending");
  });
});
