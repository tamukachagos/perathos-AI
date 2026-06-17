import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_TENANT_ID } from "./db/seed";

// authz is the single app-layer tenant-scoping point. We mock the session
// (@/lib/auth) and the env gate (@/lib/env) so the test never loads next-auth or
// touches a database.

const authMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

afterEach(() => {
  authMock.mockReset();
  vi.resetModules();
  vi.doUnmock("@/lib/env");
});

describe("getCurrentTenant / requireTenant (mock mode)", () => {
  async function loadAuthz() {
    // Preserve the real module surface (env, isMockMode, …) and only force the
    // database gate off, so transitively-loaded modules (e.g. the adapter
    // registry) still see a complete @/lib/env.
    vi.doMock("@/lib/env", async () => {
      const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
      return { ...actual, hasDatabase: () => false };
    });
    return import("./authz");
  }

  it("returns null when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const { getCurrentTenant } = await loadAuthz();
    expect(await getCurrentTenant()).toBeNull();
  });

  it("resolves the seeded dev tenant for an authenticated session", async () => {
    authMock.mockResolvedValue({
      user: { id: "u1", email: "owner@example.com" },
    });
    const { getCurrentTenant } = await loadAuthz();
    const ctx = await getCurrentTenant();
    expect(ctx).toEqual({
      tenantId: DEV_TENANT_ID,
      userId: "u1",
      email: "owner@example.com",
    });
  });

  it("requireTenant throws when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const { requireTenant } = await loadAuthz();
    await expect(requireTenant()).rejects.toThrow(/Unauthorized/);
  });

  it("requireTenant returns the context when authenticated", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "a@b.com" } });
    const { requireTenant } = await loadAuthz();
    const ctx = await requireTenant();
    expect(ctx.tenantId).toBe(DEV_TENANT_ID);
  });
});
