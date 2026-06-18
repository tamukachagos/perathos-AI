// W4 — Field-level encryption for the domain `authCode` (transfer auth-info).
//
// SERVER-ONLY. Uses node:crypto AES-256-GCM. The transfer/EPP auth code is a
// bearer secret: anyone holding it can move the domain, so it must never be
// stored in plaintext and never logged. We encrypt it at the field boundary
// before it reaches the repo, and decrypt only in the server action plane when a
// transfer is actually dispatched.
//
// Key resolution mirrors the approval-secret pattern (src/lib/env.ts): a real
// deployment sets DOMAIN_AUTHCODE_KEY (32-byte key, hex or base64). In dev/mock a
// stable dev key is used so the whole flow is exercisable with no secrets. In
// production-non-mock a missing key is a hard error (never the public dev key).
//
// Wire format (single string, ":"-joined base64): "v1:<iv>:<tag>:<ciphertext>".

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { isDevMockMode, MissingProductionSecretError } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = "v1";

// Public dev fallback — fine for mock/dev (open-source repo), NEVER production.
const DEV_KEY_MATERIAL = "launch-desk-dev-domain-authcode-key-not-for-production";

/**
 * Resolve the 32-byte AES key. A configured DOMAIN_AUTHCODE_KEY is accepted as
 * 32-byte hex (64 chars), 32-byte base64, or any other string (hashed to 32
 * bytes via SHA-256 so an operator can paste a passphrase). In dev/mock the dev
 * material is hashed to a stable key. Runtime-only (never at import) so
 * `next build` with no env never throws.
 */
function resolveKey(): Buffer {
  const configured = process.env.DOMAIN_AUTHCODE_KEY?.trim();
  if (configured) {
    // Accept raw 32-byte hex / base64 if it decodes to exactly 32 bytes;
    // otherwise derive a 32-byte key from the string with SHA-256.
    const asHex =
      /^[0-9a-fA-F]{64}$/.test(configured) ? Buffer.from(configured, "hex") : null;
    if (asHex && asHex.length === 32) return asHex;
    const asB64 = tryBase64(configured);
    if (asB64 && asB64.length === 32) return asB64;
    return createHash("sha256").update(configured, "utf8").digest();
  }
  if (isDevMockMode()) {
    return createHash("sha256").update(DEV_KEY_MATERIAL, "utf8").digest();
  }
  throw new MissingProductionSecretError("DOMAIN_AUTHCODE_KEY");
}

function tryBase64(value: string): Buffer | null {
  try {
    const buf = Buffer.from(value, "base64");
    // Round-trip check: base64 of arbitrary text can silently truncate.
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** Encrypt a plaintext auth code. Returns the opaque wire string. */
export function encryptAuthCode(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a wire string back to the auth code. Throws on tamper (GCM tag
 * mismatch) or malformed input — a corrupt/forged value must never decrypt to
 * usable plaintext. Callers treat a throw as "auth code unavailable".
 */
export function decryptAuthCode(wire: string): string {
  const parts = wire.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("authCode ciphertext is malformed.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** True when a stored value is a W4 auth-code ciphertext (not plaintext). */
export function isEncryptedAuthCode(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}
