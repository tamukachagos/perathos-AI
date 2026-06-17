// Phase 0 — fail-closed privileged endpoints (B3/S1/S2).
//
// Webhook (Paystack), cron purge, and DSAR must:
//   * REJECT (401) in production with NO mock opt-in when their secret is unset,
//   * ACCEPT (current dev behaviour) in mock/dev mode when the secret is unset.
//
// Everything runs against the in-memory repo (no DB). Production mode is
// simulated by setting NODE_ENV=production and clearing LAUNCH_DESK_MOCK; the
// secret checks are runtime (inside the handlers), so this is safe.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as paystackPOST } from "./webhooks/paystack/route";
import { GET as cronGET } from "./cron/purge/route";
import { POST as dsarPOST } from "./dsar/route";
import { __resetMemoryStore } from "@/lib/db/memory";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_MOCK = process.env.LAUNCH_DESK_MOCK;

function prodNoMock() {
  (process.env as Record<string, string>).NODE_ENV = "production";
  delete process.env.LAUNCH_DESK_MOCK;
  // Ensure the relevant secrets are unset.
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.CRON_SECRET;
  delete process.env.DSAR_SECRET;
}

function devMock() {
  (process.env as Record<string, string>).NODE_ENV = "test";
  delete process.env.LAUNCH_DESK_MOCK;
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.CRON_SECRET;
  delete process.env.DSAR_SECRET;
}

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined)
    delete (process.env as Record<string, unknown>).NODE_ENV;
  else (process.env as Record<string, string>).NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_MOCK === undefined) delete process.env.LAUNCH_DESK_MOCK;
  else process.env.LAUNCH_DESK_MOCK = ORIGINAL_MOCK;
});

beforeEach(() => {
  __resetMemoryStore();
});

function paystackReq(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/paystack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cronReq(): Request {
  return new Request("http://localhost/api/cron/purge", { method: "GET" });
}

function dsarReq(body: unknown): Request {
  return new Request("http://localhost/api/dsar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Paystack webhook — fail closed (B3/S1)", () => {
  it("REJECTS (401) in production with no secret and no mock opt-in", async () => {
    prodNoMock();
    const res = await paystackPOST(
      paystackReq({ event: "charge.success", data: {} }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("ACCEPTS in mock/dev when no secret is set (exercisable locally)", async () => {
    devMock();
    const res = await paystackPOST(
      paystackReq({ event: "subscription.create", data: {} }),
    );
    // No secret in dev => signature stub passes; unresolved tenant acks 200.
    expect(res.status).toBe(200);
  });
});

describe("Cron purge — fail closed (B3/S2)", () => {
  it("REJECTS (401) in production with no secret and no mock opt-in", async () => {
    prodNoMock();
    const res = await cronGET(cronReq());
    expect(res.status).toBe(401);
  });

  it("ACCEPTS in mock/dev when no secret is set", async () => {
    devMock();
    const res = await cronGET(cronReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});

describe("DSAR — fail closed (B3/S2)", () => {
  it("REJECTS (401) in production with no secret and no mock opt-in", async () => {
    prodNoMock();
    const res = await dsarPOST(dsarReq({ contact: "x@y.com" }));
    expect(res.status).toBe(401);
  });

  it("ACCEPTS in mock/dev when no secret is set (export path)", async () => {
    devMock();
    const res = await dsarPOST(
      dsarReq({ contact: "nobody@example.com", action: "export" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.action).toBe("export");
  });
});
