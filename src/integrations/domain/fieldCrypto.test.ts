// W4 — authCode field encryption (AES-256-GCM). Mock / DB-free (dev key).

import { describe, expect, it } from "vitest";
import {
  encryptAuthCode,
  decryptAuthCode,
  isEncryptedAuthCode,
} from "./fieldCrypto";

describe("authCode field encryption", () => {
  it("round-trips plaintext through encrypt → decrypt", () => {
    const secret = "EPP-AUTH-Info-9f3!x";
    const wire = encryptAuthCode(secret);
    expect(wire).not.toContain(secret); // ciphertext, not plaintext
    expect(isEncryptedAuthCode(wire)).toBe(true);
    expect(decryptAuthCode(wire)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptAuthCode("same");
    const b = encryptAuthCode("same");
    expect(a).not.toBe(b);
    expect(decryptAuthCode(a)).toBe("same");
    expect(decryptAuthCode(b)).toBe("same");
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const wire = encryptAuthCode("secret");
    const parts = wire.split(":");
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    expect(() => decryptAuthCode(parts.join(":"))).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => decryptAuthCode("not-a-ciphertext")).toThrow();
    expect(isEncryptedAuthCode("plain")).toBe(false);
    expect(isEncryptedAuthCode(null)).toBe(false);
  });
});
