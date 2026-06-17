// Payload-bound, single-use, expiring approval tokens for the ActionRouter (M3).
//
// A token is a stateless HMAC over the fields that an approval authorises:
//
//     payload-to-sign = verb | payloadHash | idempotencyKey | nonce | expiresAt
//     token           = base64url(payload-to-sign) + "." + base64url(HMAC(payload))
//
// Binding properties this gives us:
//   * verb-bound        — a token approved for `domain.register` cannot redeem
//                         `payment.configure`.
//   * payload-bound      — `payloadHash` is the SHA-256 of the canonicalised
//                         payload, so swapping the payload after approval is
//                         rejected (signature no longer matches the new hash).
//   * idempotency-bound  — ties the approval to one logical attempt.
//   * expiring           — `expiresAt` is signed, so an expired token is both
//                         self-describing AND tamper-evident.
//   * single-use         — the `nonce` is recorded in a server-side store on
//                         first redemption; a replay with the same token is
//                         rejected even though the HMAC is still valid (see
//                         approvalStore.ts).
//
// The HMAC itself is verified with a constant-time comparison. Secrets are read
// only here, server-side, via env.approvalSecret() — in mock mode a stable dev
// key keeps the flow runnable with no secrets.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { approvalSecret } from "@/lib/env";

/** Default token lifetime: short, since approval-to-redeem is interactive. */
export const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface ApprovalClaims {
  /** The risky verb this approval authorises, e.g. "domain.register". */
  verb: string;
  /** SHA-256 (hex) of the canonicalised payload the approval is bound to. */
  payloadHash: string;
  /** Logical attempt id; replaying the same attempt is rejected. */
  idempotencyKey: string;
  /** Random, single-use marker recorded on redemption. */
  nonce: string;
  /** Absolute expiry (epoch ms), signed so it cannot be extended. */
  expiresAt: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Canonical JSON for hashing/signing: object keys sorted recursively so two
 * payloads that are structurally equal produce the SAME hash regardless of key
 * order. This is what makes `payloadHash` a stable binding target.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",")}}`;
}

/** SHA-256-equivalent payload hash (hex). Uses HMAC-less digest via createHmac. */
export function hashPayload(payload: unknown): string {
  // We use createHmac with an empty key as a portable SHA-256; the binding
  // security comes from the signed token, not from this digest being keyed.
  return createHmac("sha256", "payload-digest")
    .update(canonicalize(payload ?? {}))
    .digest("hex");
}

function sign(payloadToSign: string): Buffer {
  return createHmac("sha256", approvalSecret()).update(payloadToSign).digest();
}

/** Issue a signed token for a set of claims. */
export function issueToken(claims: ApprovalClaims): string {
  const header = [
    claims.verb,
    claims.payloadHash,
    claims.idempotencyKey,
    claims.nonce,
    String(claims.expiresAt),
  ].join("|");
  const sig = sign(header);
  return `${b64url(header)}.${b64url(sig)}`;
}

/** Mint a fresh nonce for a new approval. */
export function mintNonce(): string {
  return randomBytes(18).toString("hex");
}

export type VerifyResult =
  | { ok: true; claims: ApprovalClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/**
 * Verify a token's signature and expiry and return its claims. This does NOT
 * check single-use (that requires the store); the ActionRouter combines both.
 * Verification is stateless and side-effect-free.
 */
export function verifyToken(token: string, now = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [encHeader, encSig] = parts;

  let header: string;
  try {
    header = fromB64url(encHeader).toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const fields = header.split("|");
  if (fields.length !== 5) return { ok: false, reason: "malformed" };
  const [verb, payloadHash, idempotencyKey, nonce, expiresAtRaw] = fields;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "malformed" };

  // Constant-time signature check (recompute over the EXACT header bytes).
  const expected = sign(header);
  let provided: Buffer;
  try {
    provided = fromB64url(encSig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  if (now >= expiresAt) return { ok: false, reason: "expired" };

  return {
    ok: true,
    claims: { verb, payloadHash, idempotencyKey, nonce, expiresAt },
  };
}
