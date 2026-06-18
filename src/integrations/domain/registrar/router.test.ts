// W4 — RegistrarRouter picks the right backend per TLD. Mock / DB-free.

import { describe, expect, it } from "vitest";
import {
  selectRegistrar,
  registrarKindForTld,
  backendForKind,
} from "./router";

describe("RegistrarRouter — TLD → backend selection", () => {
  it("routes *.za to the ZACR (za) backend", () => {
    const sel = selectRegistrar("joes.co.za");
    expect(sel).not.toBeNull();
    expect(sel?.kind).toBe("za");
    expect(sel?.backend.kind).toBe("za");
    expect(sel?.tld).toBe("co.za");
  });

  it("routes .com (and other gTLDs) to the gtld backend", () => {
    expect(selectRegistrar("example.com")?.kind).toBe("gtld");
    expect(selectRegistrar("example.io")?.kind).toBe("gtld");
    expect(selectRegistrar("example.net")?.kind).toBe("gtld");
  });

  it("returns null for an invalid / internal / disallowed host (never falls through)", () => {
    expect(selectRegistrar("localhost")).toBeNull();
    expect(selectRegistrar("http://evil.com")).toBeNull();
    expect(selectRegistrar("foo.xyz")).toBeNull();
  });

  it("registrarKindForTld maps every SA suffix to za and gTLDs to gtld", () => {
    expect(registrarKindForTld("co.za")).toBe("za");
    expect(registrarKindForTld("org.za")).toBe("za");
    expect(registrarKindForTld("com")).toBe("gtld");
    expect(registrarKindForTld("africa")).toBe("gtld");
  });

  it("backendForKind returns the matching mock backend", () => {
    expect(backendForKind("za").kind).toBe("za");
    expect(backendForKind("gtld").kind).toBe("gtld");
  });
});

describe("Mock backends — deterministic availability + ZAR pricing", () => {
  it("za backend quotes the .co.za retail price", async () => {
    const q = await backendForKind("za").checkAvailability("joes.co.za");
    expect(q.currency).toBe("ZAR");
    expect(q.priceCents).toBe(14900); // R149 default
    expect(q.costCents).toBe(8000); // R80 default
    expect(typeof q.available).toBe("boolean");
  });

  it("gtld backend quotes the .com retail price", async () => {
    const q = await backendForKind("gtld").checkAvailability("example.com");
    expect(q.priceCents).toBe(24900); // R249 default
  });

  it("availability is deterministic for the same hostname", async () => {
    const a = await backendForKind("za").checkAvailability("repeat.co.za");
    const b = await backendForKind("za").checkAvailability("repeat.co.za");
    expect(a.available).toBe(b.available);
  });

  it("a reserved demo name is reliably taken, and register rejects it", async () => {
    const q = await backendForKind("za").checkAvailability("taken.co.za");
    expect(q.available).toBe(false);
    const reg = await backendForKind("za").register({ hostname: "taken.co.za" });
    expect(reg.ok).toBe(false);
  });

  it("transfer requires an auth code", async () => {
    const noCode = await backendForKind("gtld").transfer({
      hostname: "example.com",
      authCode: "",
    });
    expect(noCode.ok).toBe(false);
    const withCode = await backendForKind("gtld").transfer({
      hostname: "example.com",
      authCode: "AUTH-123",
    });
    expect(withCode.ok).toBe(true);
    expect(withCode.registrarRef).toBeTruthy();
  });
});
