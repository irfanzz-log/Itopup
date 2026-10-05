// Crypto for stored game credentials: the round trip, tamper detection, and the
// guarantee that a plaintext never appears in what gets stored.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `server-only` is stubbed for the whole suite (tests/stubs/server-only.js);
// the alias is what lets this module load outside a Next build.
import { encryptCredential, decryptCredential } from "../../src/lib/crypto.js";

// AUTH_SECRET is read through env.server's `optional()`, which caches per
// process, set it before the module reads it and clear the cache after.
const ORIGINAL_SECRET = process.env.AUTH_SECRET;

describe("game credential crypto", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "x".repeat(48);
  });

  afterEach(() => {
    process.env.AUTH_SECRET = ORIGINAL_SECRET;
  });

  it("round-trips a game password", () => {
    const secret = "my-konami-password!";
    const stored = encryptCredential(secret);

    expect(stored.cipher).not.toBe(secret);
    expect(decryptCredential(stored)).toBe(secret);
  });

  it("produces a different ciphertext for the same plaintext", () => {
    // A random IV per encryption is what keeps GCM safe. Encrypting the same
    // secret twice must not yield the same stored bytes.
    const a = encryptCredential("same-secret");
    const b = encryptCredential("same-secret");

    expect(a.cipher).not.toBe(b.cipher);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptCredential(a)).toBe("same-secret");
    expect(decryptCredential(b)).toBe("same-secret");
  });

  it("never contains the plaintext", () => {
    const secret = "plaintext-marker-123456";
    const { cipher, iv } = encryptCredential(secret);

    expect(cipher).not.toContain(secret);
    expect(iv).not.toContain(secret);
    // A base64 of the ciphertext must not be trivially reversible either.
    expect(Buffer.from(cipher, "base64").toString("utf8")).not.toContain(secret);
  });

  it("detects a tampered ciphertext", () => {
    const { cipher, iv } = encryptCredential("gcm-auth-tag-matters");

    const tampered = cipher.slice(0, -4) + "AAAA";
    expect(() => decryptCredential({ cipher: tampered, iv })).toThrow();
  });

  it("rejects a ciphertext that is too short to carry a tag", () => {
    const { iv } = encryptCredential("short");
    const tiny = Buffer.from("12345").toString("base64");

    expect(() => decryptCredential({ cipher: tiny, iv })).toThrow();
  });

  it("rejects an IV of the wrong length", () => {
    const { cipher } = encryptCredential("iv-length");
    const badIv = Buffer.from("only-nine").toString("base64");

    expect(() => decryptCredential({ cipher, iv: badIv })).toThrow();
  });

  it("refuses to encrypt an empty secret", () => {
    expect(() => encryptCredential("")).toThrow();
    expect(() => encryptCredential(undefined)).toThrow();
  });

  it("fails closed when AUTH_SECRET is missing or too short", async () => {
    // The key is derived per process and memoised (see crypto.js), so exercise
    // the validation against a freshly derived key, not the cached one.
    process.env.AUTH_SECRET = "short";
    vi.resetModules();
    const { encryptCredential: freshEncrypt } = await import("../../src/lib/crypto.js");

    expect(() => freshEncrypt("a-secret")).toThrow(/AUTH_SECRET/);
  });

  it("does not decrypt under a different AUTH_SECRET", async () => {
    const stored = encryptCredential("rotated-secret");

    // Re-derive under a new secret: the memoised key is per-process, so the
    // fresh module state is what a rotated deployment would have.
    process.env.AUTH_SECRET = "y".repeat(48);
    vi.resetModules();
    const { decryptCredential: freshDecrypt } = await import("../../src/lib/crypto.js");

    // A rotation invalidates stored credentials rather than silently reading
    // them, that is the property that makes rotating the secret meaningful.
    expect(() => freshDecrypt(stored)).toThrow();
  });
});
