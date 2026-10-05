// ============================================================================
// Unit tests for src/lib/auth/password.js.
//
// This file is the authentication root: every login and every register goes
// through it. At 50% coverage the untested half was exactly the security-
// sensitive part — verifyPassword's type guard and its try/catch (which must
// return false, never throw, so a malformed hash cannot take down login), the
// timing equalisation that prevents email enumeration, and the strength rules
// that gate registration.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  equaliseTiming,
  assessPasswordStrength,
  DUMMY_HASH,
} from "@/lib/auth/password.js";

describe("hashPassword + verifyPassword round-trip", () => {
  it("verifies a password it hashed", async () => {
    const hash = await hashPassword("CorrectHorse42!");
    expect(hash).not.toBe("CorrectHorse42!");
    expect(await verifyPassword("CorrectHorse42!", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("CorrectHorse42!");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a bcrypt hash with a cost prefix", async () => {
    const hash = await hashPassword("CorrectHorse42!");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("salts: the same password hashes differently each time", async () => {
    const a = await hashPassword("SamePassword1!");
    const b = await hashPassword("SamePassword1!");
    expect(a).not.toBe(b);
    // ...and both still verify.
    expect(await verifyPassword("SamePassword1!", a)).toBe(true);
    expect(await verifyPassword("SamePassword1!", b)).toBe(true);
  });
});

describe("verifyPassword input handling — must never throw", () => {
  it("returns false for non-string inputs", async () => {
    expect(await verifyPassword(null, DUMMY_HASH)).toBe(false);
    expect(await verifyPassword(undefined, DUMMY_HASH)).toBe(false);
    expect(await verifyPassword(12345, DUMMY_HASH)).toBe(false);
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    // bcrypt.compare throws on garbage; the wrapper must swallow it. If it
    // propagated, a single corrupted row would 500 the whole login endpoint.
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

describe("hashPassword rejects empty input", () => {
  it("throws on empty / non-string", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword(null)).rejects.toThrow();
  });
});

describe("equaliseTiming — the email-enumeration guard", () => {
  it("resolves without throwing against the dummy hash", async () => {
    // The point is that it burns the same ~cost as a real comparison. It must
    // not reject: a failure here would be silent, and the timing oracle it
    // guards would reopen.
    await expect(equaliseTiming()).resolves.toBeUndefined();
  });
});

describe("assessPasswordStrength", () => {
  it("accepts a strong password", () => {
    expect(assessPasswordStrength("CorrectHorse42!")).toEqual({ ok: true });
  });

  it("rejects too-short passwords", () => {
    const r = assessPasswordStrength("Ab1!");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/minimal 8 karakter/i);
  });

  it("rejects over-long passwords", () => {
    const r = assessPasswordStrength("A".repeat(129) + "1!");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/maksimal 128 karakter/i);
  });

  it("rejects a single character class", () => {
    expect(assessPasswordStrength("abcdefghij").ok).toBe(false);
    expect(assessPasswordStrength("1234567890").ok).toBe(false);
  });

  it("accepts two character classes (letters + digits)", () => {
    // NB: the blocklist is case-insensitive, so "Password123" is caught by it
    // ("password123") and is NOT a valid strength example. Use a string that
    // only exercises the character-class rule.
    expect(assessPasswordStrength("KudaBermotor88").ok).toBe(true);
  });

  it("rejects common passwords from the blocklist", () => {
    // Every entry below contains BOTH letters and digits, so it clears the
    // character-class rule and the blocklist is the ONLY thing rejecting it —
    // that isolation is what this test proves. Pure-letter entries like
    // "iloveyou" hit the class rule first and are covered there instead.
    for (const bad of ["Password123", "password123", "Admin123", "qwerty123", "itopup123"]) {
      const r = assessPasswordStrength(bad);
      expect(r.ok, `${bad} should be rejected`).toBe(false);
      expect(r.message).toMatch(/terlalu mudah/i);
    }
  });

  it("rejects non-strings", () => {
    expect(assessPasswordStrength(null).ok).toBe(false);
    expect(assessPasswordStrength(undefined).ok).toBe(false);
    expect(assessPasswordStrength(12345678).ok).toBe(false);
  });
});
