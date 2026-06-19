import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBillingStore } from "@/integrations/payment/subscription";
import { __resetMemoryStore } from "@/lib/db/memory";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireTenant: vi.fn(async () => ({
    tenantId: "tenant-billing-test",
    userId: "user-billing-test",
    email: "owner@billing.test",
  })),
}));

const ORIGINAL_PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY;

beforeEach(() => {
  delete process.env.PAYSTACK_SECRET_KEY;
  __resetMemoryStore();
  __resetBillingStore();
  vi.restoreAllMocks();
});

afterEach(() => {
  if (ORIGINAL_PAYSTACK_KEY === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = ORIGINAL_PAYSTACK_KEY;
  vi.restoreAllMocks();
});

describe("billing actions checkout trust boundary", () => {
  it("allows mock checkout activation only for a provider-issued reference", async () => {
    const { startUpgradeAction, confirmUpgradeAction } = await import("./actions");

    const checkout = await startUpgradeAction("pro");
    const state = await confirmUpgradeAction("pro", checkout.reference);

    expect(checkout.checkoutUrl).toContain("plan=pro");
    expect(state.plan).toBe("pro");
    expect(state.provider).toBe("mock");
  });

  it("rejects forged mock references", async () => {
    const { confirmUpgradeAction } = await import("./actions");

    await expect(
      confirmUpgradeAction("pro", "mock_sub_forged"),
    ).rejects.toThrow(/reference/i);
  });

  it("does not activate live Paystack checkouts from callback parameters", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_x";
    const { confirmUpgradeAction } = await import("./actions");

    await expect(confirmUpgradeAction("pro", "anything")).rejects.toThrow(
      /webhook/i,
    );
  });
});
