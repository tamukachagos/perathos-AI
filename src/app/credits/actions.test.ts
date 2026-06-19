import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMemoryStore, memoryRepositories } from "@/lib/db/memory";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireTenant: vi.fn(async () => ({
    tenantId: "tenant-credits-test",
    userId: "user-credits-test",
    email: "owner@credits.test",
  })),
}));

const ORIGINAL_PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY;

beforeEach(() => {
  delete process.env.PAYSTACK_SECRET_KEY;
  __resetMemoryStore();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_PAYSTACK_KEY === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = ORIGINAL_PAYSTACK_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("credit top-up actions", () => {
  it("credits directly only in mock mode", async () => {
    const { topUpAction } = await import("./actions");

    const result = await topUpAction(30);

    expect(result.kind).toBe("credited");
    if (result.kind === "credited") {
      expect(result.state.balanceMicro).toBe("3000000");
    }
  });

  it("starts hosted checkout in live mode and does not mint credits", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.com/topup",
          reference: "topup_ref",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { topUpAction } = await import("./actions");

    const result = await topUpAction(75);

    expect(result).toEqual({
      kind: "checkout",
      checkoutUrl: "https://checkout.paystack.com/topup",
      reference: "topup_ref",
    });
    expect(
      await memoryRepositories.wallet.getBalance("tenant-credits-test"),
    ).toBe(0n);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.amount).toBe(7500);
    expect(body.metadata).toMatchObject({
      tenantId: "tenant-credits-test",
      kind: "token_topup",
      amountMicro: "7500000",
    });
  });
});
