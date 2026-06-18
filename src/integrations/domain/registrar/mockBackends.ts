// W4 — Mock registrar backends (deterministic, no network, no keys).
//
// Two backends mirror the live split: a ZACR-style SA registrar for *.za and an
// international gTLD reseller for .com & friends. The MOCK implementations:
//   * checkAvailability — deterministic availability from a hash of the
//     hostname (so the same name is always "taken" or "free" in tests + dev),
//     priced from pricing.ts (the §8 resale spread).
//   * register/transfer/renew — return ok with a synthetic registrarRef; the
//     async settlement (pending → succeeded) is driven by the operation store's
//     reconcile/webhook exactly like every other async verb.
//
// SERVER-ONLY (the live versions hold keys / do outbound). The router never
// imports the live backends in W4; they are documented as dormant env-gated.

import { createHash } from "node:crypto";
import type {
  AvailabilityQuote,
  RegisterInput,
  RegistrarBackend,
  RegistrarOpResult,
  RenewInput,
  TransferInput,
} from "./types";
import {
  gtldCostCents,
  gtldRetailCents,
  zaCostCents,
  zaRetailCents,
} from "./pricing";

/**
 * Deterministic pseudo-availability: a stable hash of the hostname decides. ~70%
 * of names read as available so the demo/test almost always has an option, but
 * specific names ("taken.co.za") can be reliably unavailable. Pure function of
 * the input → identical across processes and test runs.
 */
function deterministicallyAvailable(hostname: string): boolean {
  const digest = createHash("sha256").update(hostname).digest();
  // Reserve a couple of well-known demo names as taken regardless of the hash.
  if (hostname.startsWith("taken.") || hostname.startsWith("google.")) {
    return false;
  }
  return digest[0] % 10 < 7; // ~70% available
}

function synthRef(prefix: string, hostname: string): string {
  const h = createHash("sha256").update(hostname).digest("hex").slice(0, 10);
  return `${prefix}_${h}`;
}

/** Mock ZACR-accredited SA registrar (.co.za / *.za). */
export const mockZaBackend: RegistrarBackend = {
  kind: "za",
  label: "ZACR registrar (mock)",
  async checkAvailability(hostname: string): Promise<AvailabilityQuote> {
    return {
      hostname,
      available: deterministicallyAvailable(hostname),
      priceCents: zaRetailCents(),
      costCents: zaCostCents(),
      registrar: "za",
      currency: "ZAR",
    };
  },
  async register(input: RegisterInput): Promise<RegistrarOpResult> {
    // A taken name cannot be registered — surface a terminal rejection so the
    // ActionRouter settles the operation to `failed` (never silent success).
    if (!deterministicallyAvailable(input.hostname)) {
      return {
        ok: false,
        detail: `[mock:za] ${input.hostname} is not available for registration.`,
      };
    }
    return {
      ok: true,
      detail: `[mock:za] register accepted for ${input.hostname} (settles via reconcile/webhook).`,
      registrarRef: synthRef("za", input.hostname),
    };
  },
  async transfer(input: TransferInput): Promise<RegistrarOpResult> {
    // A mock backend does not actually verify the auth code, but a MISSING one
    // is rejected so the gated flow's contract (auth-code required) is real.
    if (!input.authCode) {
      return { ok: false, detail: "[mock:za] transfer requires an auth-info code." };
    }
    return {
      ok: true,
      detail: `[mock:za] transfer accepted for ${input.hostname} (ZACR auth-info).`,
      registrarRef: synthRef("za-xfer", input.hostname),
    };
  },
  async renew(input: RenewInput): Promise<RegistrarOpResult> {
    return {
      ok: true,
      detail: `[mock:za] renew accepted for ${input.hostname}.`,
      registrarRef: synthRef("za-renew", input.hostname),
    };
  },
};

/** Mock international gTLD reseller (.com / .net / .io / …). */
export const mockGtldBackend: RegistrarBackend = {
  kind: "gtld",
  label: "gTLD reseller (mock)",
  async checkAvailability(hostname: string): Promise<AvailabilityQuote> {
    return {
      hostname,
      available: deterministicallyAvailable(hostname),
      priceCents: gtldRetailCents(),
      costCents: gtldCostCents(),
      registrar: "gtld",
      currency: "ZAR",
    };
  },
  async register(input: RegisterInput): Promise<RegistrarOpResult> {
    if (!deterministicallyAvailable(input.hostname)) {
      return {
        ok: false,
        detail: `[mock:gtld] ${input.hostname} is not available for registration.`,
      };
    }
    return {
      ok: true,
      detail: `[mock:gtld] register accepted for ${input.hostname} (near-instant).`,
      registrarRef: synthRef("gtld", input.hostname),
    };
  },
  async transfer(input: TransferInput): Promise<RegistrarOpResult> {
    if (!input.authCode) {
      return { ok: false, detail: "[mock:gtld] transfer requires an auth code." };
    }
    // gTLD transfers are the slow path (60-day lock, 5-day ACK) — mock still
    // accepts; the operation stays pending until settled (reconcile/webhook).
    return {
      ok: true,
      detail: `[mock:gtld] transfer accepted for ${input.hostname} (ICANN 5-day ACK).`,
      registrarRef: synthRef("gtld-xfer", input.hostname),
    };
  },
  async renew(input: RenewInput): Promise<RegistrarOpResult> {
    return {
      ok: true,
      detail: `[mock:gtld] renew accepted for ${input.hostname}.`,
      registrarRef: synthRef("gtld-renew", input.hostname),
    };
  },
};
