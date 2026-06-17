import { afterEach, describe, expect, it, vi } from "vitest";

// The factory selects the in-memory repo when there is no database, and only
// dynamically imports the Prisma impl when hasDatabase() is true. We verify
// selection without a real database by mocking the env gate.

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/env");
});

describe("getRepositories factory", () => {
  it("selects the in-memory repository when there is no database", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      hasDatabase: () => false,
      isMockMode: () => true,
      env: { adapterMode: "mock", appUrl: "http://localhost:3000" },
    }));

    const { getRepositories, isPersistent } = await import("./index");
    const { memoryRepositories } = await import("./memory");

    expect(isPersistent()).toBe(false);
    const repos = await getRepositories();
    expect(repos).toBe(memoryRepositories);
  });

  it("reports persistent mode when a database is configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      hasDatabase: () => true,
      isMockMode: () => false,
      env: { adapterMode: "mock", appUrl: "http://localhost:3000" },
    }));

    const { isPersistent } = await import("./index");
    expect(isPersistent()).toBe(true);
    // We do not call getRepositories() here: that would dynamically import the
    // Prisma impl, which needs a generated client + DB. Selection-by-flag is the
    // contract under test.
  });
});
