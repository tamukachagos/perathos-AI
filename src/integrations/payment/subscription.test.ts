import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectBillingProvider,
  paystackBillingProvider,
  mockBillingProvider,
} from "./subscription";

const ORIGINAL = {
  key: process.env.PAYSTACK_SECRET_KEY,
  growth: process.env.PAYSTACK_PLAN_GROWTH,
  pro: process.env.PAYSTACK_PLAN_PRO,
};

beforeEach(() => {
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_PLAN_GROWTH;
  delete process.env.PAYSTACK_PLAN_PRO;
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const [env, val] of [
    ["PAYSTACK_SECRET_KEY", ORIGINAL.key],
    ["PAYSTACK_PLAN_GROWTH", ORIGINAL.growth],
    ["PAYSTACK_PLAN_PRO", ORIGINAL.pro],
  ] as const) {
    if (val === undefined) delete process.env[env];
    else process.env[env] = val;
  }
  vi.restoreAllMocks();
});

/** Build a fetch mock that returns the given Paystack-shaped JSON body. */
function mockFetchOnce(data: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => ({ status: ok, data }),
  });
}

describe("selectBillingProvider — dormant without a key", () => {
  it("returns the mock provider when PAYSTACK_SECRET_KEY is absent", () => {
    const provider = selectBillingProvider();
    expect(provider.name).toBe("mock");
    expect(provider.charges).toBe(false);
  });

  it("returns the real Paystack provider when PAYSTACK_SECRET_KEY is set", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const provider = selectBillingProvider();
    expect(provider.name).toBe("paystack");
    expect(provider.charges).toBe(true);
  });

  it("the mock provider does not call fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const session = await mockBillingProvider().createCheckout({
      tenantId: "t1",
      plan: "growth",
      callbackUrl: "https://app.test/return",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session.checkoutUrl).toContain("reference=");
  });
});

describe("paystackBillingProvider — REST integration (fetch mocked)", () => {
  it("createCheckout initializes a transaction and returns the hosted URL", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    process.env.PAYSTACK_PLAN_GROWTH = "PLN_growth123";
    const fetchSpy = mockFetchOnce({
      authorization_url: "https://checkout.paystack.com/abc123",
      reference: "ref_abc123",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const session = await paystackBillingProvider().createCheckout({
      tenantId: "tenant-7",
      plan: "growth",
      callbackUrl: "https://app.test/return",
      customerEmail: "owner@example.com",
    });

    expect(session.checkoutUrl).toBe("https://checkout.paystack.com/abc123");
    expect(session.reference).toBe("ref_abc123");

    // Verify the request: endpoint, auth header, and metadata payload.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_test_x");
    const body = JSON.parse(init.body);
    expect(body.metadata).toEqual({ tenantId: "tenant-7", plan: "growth" });
    expect(body.plan).toBe("PLN_growth123"); // env-mapped plan code
    expect(body.amount).toBe(14900); // ZAR cents from the catalog
    expect(body.currency).toBe("ZAR");
  });

  it("fetchStatus maps a Paystack 'active' subscription to our shape", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    process.env.PAYSTACK_PLAN_PRO = "PLN_pro999";
    const fetchSpy = mockFetchOnce({
      status: "active",
      next_payment_date: "2026-07-17T00:00:00.000Z",
      plan: { plan_code: "PLN_pro999" },
    });
    vi.stubGlobal("fetch", fetchSpy);

    const status = await paystackBillingProvider().fetchStatus("SUB_xyz");
    expect(status).not.toBeNull();
    expect(status!.status).toBe("active");
    expect(status!.plan).toBe("pro");
    expect(status!.currentPeriodEnd).toBe("2026-07-17T00:00:00.000Z");
    expect(status!.providerSubscriptionId).toBe("SUB_xyz");
  });

  it("fetchStatus returns null when Paystack errors", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ status: false, message: "not found" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const status = await paystackBillingProvider().fetchStatus("SUB_missing");
    expect(status).toBeNull();
  });

  it("createCheckout never leaks the secret key in a thrown error", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_supersecret";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ status: false, message: "invalid amount" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      paystackBillingProvider().createCheckout({
        tenantId: "t1",
        plan: "growth",
        callbackUrl: "https://app.test/return",
      }),
    ).rejects.toThrow(/paystack_error/);
    await expect(
      paystackBillingProvider().createCheckout({
        tenantId: "t1",
        plan: "growth",
        callbackUrl: "https://app.test/return",
      }),
    ).rejects.not.toThrow(/supersecret/);
  });
});
