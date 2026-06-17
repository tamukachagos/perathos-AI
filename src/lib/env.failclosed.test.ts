// Phase 0 — fail-closed secret resolver (B3/S1/S2/B6/S4).
//
// Proves requireProductionSecret tolerates a missing secret in mock/dev but
// throws in production-non-mock, and that isDevMockMode honours the explicit
// LAUNCH_DESK_MOCK opt-in and NODE_ENV. All runtime (never import-time) checks.

import { afterEach, describe, expect, it } from "vitest";
import {
  isDevMockMode,
  MissingProductionSecretError,
  requireProductionSecret,
} from "./env";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_MOCK = process.env.LAUNCH_DESK_MOCK;

function setEnv(nodeEnv: string | undefined, mock: string | undefined) {
  if (nodeEnv === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
  else (process.env as Record<string, string>).NODE_ENV = nodeEnv;
  if (mock === undefined) delete process.env.LAUNCH_DESK_MOCK;
  else process.env.LAUNCH_DESK_MOCK = mock;
}

afterEach(() => {
  setEnv(ORIGINAL_NODE_ENV, ORIGINAL_MOCK);
  delete process.env.__TEST_SECRET__;
});

describe("requireProductionSecret / isDevMockMode", () => {
  it("dev (NODE_ENV!=='production'): missing secret returns undefined (stays open)", () => {
    setEnv("test", undefined);
    expect(isDevMockMode()).toBe(true);
    expect(requireProductionSecret("__TEST_SECRET__")).toBeUndefined();
  });

  it("production + no mock: missing secret THROWS (caller must reject)", () => {
    setEnv("production", undefined);
    expect(isDevMockMode()).toBe(false);
    expect(() => requireProductionSecret("__TEST_SECRET__")).toThrow(
      MissingProductionSecretError,
    );
  });

  it("production + LAUNCH_DESK_MOCK=1: missing secret tolerated (explicit opt-in)", () => {
    setEnv("production", "1");
    expect(isDevMockMode()).toBe(true);
    expect(requireProductionSecret("__TEST_SECRET__")).toBeUndefined();
  });

  it("returns the secret when set, in any mode (and honours fallbacks)", () => {
    setEnv("production", undefined);
    process.env.__TEST_SECRET__ = "  s3cr3t  ";
    expect(requireProductionSecret("__TEST_SECRET__")).toBe("s3cr3t");
    delete process.env.__TEST_SECRET__;
    process.env.__TEST_FALLBACK__ = "fb";
    expect(
      requireProductionSecret("__TEST_SECRET__", "__TEST_FALLBACK__"),
    ).toBe("fb");
    delete process.env.__TEST_FALLBACK__;
  });
});
