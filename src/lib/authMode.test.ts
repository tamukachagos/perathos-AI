import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = {
  nodeEnv: process.env.NODE_ENV,
  mock: process.env.LAUNCH_DESK_MOCK,
  databaseUrl: process.env.DATABASE_URL,
  emailServer: process.env.EMAIL_SERVER,
};

async function loadAuthMode(env: {
  nodeEnv?: string;
  mock?: string;
  databaseUrl?: string;
  emailServer?: string;
}) {
  vi.resetModules();
  for (const key of [
    "LAUNCH_DESK_MOCK",
    "DATABASE_URL",
    "EMAIL_SERVER",
  ] as const) {
    delete process.env[key];
  }
  if (env.nodeEnv === undefined) {
    delete (process.env as Record<string, unknown>).NODE_ENV;
  } else {
    (process.env as Record<string, string>).NODE_ENV = env.nodeEnv;
  }
  if (env.mock !== undefined) process.env.LAUNCH_DESK_MOCK = env.mock;
  if (env.databaseUrl !== undefined) process.env.DATABASE_URL = env.databaseUrl;
  if (env.emailServer !== undefined) process.env.EMAIL_SERVER = env.emailServer;
  return import("./authMode");
}

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL.nodeEnv === undefined) {
    delete (process.env as Record<string, unknown>).NODE_ENV;
  } else {
    (process.env as Record<string, string>).NODE_ENV = ORIGINAL.nodeEnv;
  }
  for (const [key, value] of [
    ["LAUNCH_DESK_MOCK", ORIGINAL.mock],
    ["DATABASE_URL", ORIGINAL.databaseUrl],
    ["EMAIL_SERVER", ORIGINAL.emailServer],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getAuthMode", () => {
  it("uses mock mode outside production", async () => {
    const { getAuthMode } = await loadAuthMode({ nodeEnv: "test" });
    expect(getAuthMode()).toBe("mock");
  });

  it("uses email mode only when production has both DB and EMAIL_SERVER", async () => {
    const { getAuthMode } = await loadAuthMode({
      nodeEnv: "production",
      databaseUrl: "postgresql://app:pw@db.example/launchdesk",
      emailServer: "smtp://user:pass@mail.example:587",
    });
    expect(getAuthMode()).toBe("email");
  });

  it("fails closed to unconfigured production instead of dev sign-in", async () => {
    const { getAuthMode } = await loadAuthMode({
      nodeEnv: "production",
      databaseUrl: "postgresql://app:pw@db.example/launchdesk",
    });
    expect(getAuthMode()).toBe("unconfigured");
  });
});
