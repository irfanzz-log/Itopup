// Unit tests for the email OTP service.
//
// What matters here is small and specific: codes are random, the stored form is
// a hash not the code, the code space is exhausted after MAX_ATTEMPTS, and each
// failure mode reports a distinct error so the API can return a distinct status.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/db.js", () => ({
  prisma: {
    emailOtp: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

// The mailer is mocked so tests never touch a network. isMailConfigured is the
// gate the register route checks, so it must be controllable per test.
vi.mock("../../src/lib/mail.js", () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  isMailConfigured: vi.fn().mockReturnValue(true),
}));

import { issueOtp, verifyOtp, generateOtp, __hashForTests } from "../../src/services/otp.service.js";
import { prisma } from "../../src/lib/db.js";
import { sendMail } from "../../src/lib/mail.js";

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockResolvedValue(true);
});

describe("generateOtp", () => {
  it("produces a zero-padded 6-digit string", () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("does not repeat in a sane sample", () => {
    // Not a uniqueness proof (1e6 space), but catches a constant-return bug.
    const seen = new Set(Array.from({ length: 200 }, generateOtp));
    expect(seen.size).toBeGreaterThan(190);
  });
});

describe("issueOtp", () => {
  it("upserts one row per subject+purpose and returns the plaintext", async () => {
    const code = await issueOtp({ subject: "a@b.c", purpose: "REGISTER" });

    expect(code).toMatch(/^\d{6}$/);
    expect(prisma.emailOtp.upsert).toHaveBeenCalledOnce();

    const args = prisma.emailOtp.upsert.mock.calls[0][0];
    expect(args.where.subject_purpose).toEqual({ subject: "a@b.c", purpose: "REGISTER" });
    // The stored hash must not equal the plaintext.
    expect(args.create.codeHash).not.toBe(code);
    expect(args.create.codeHash).toBe(__hashForTests(code));
  });

  it("carries the registration payload onto the row", async () => {
    await issueOtp({
      subject: "a@b.c",
      purpose: "REGISTER",
      payload: { name: "Budi", passwordHash: "hashed" },
    });

    const args = prisma.emailOtp.upsert.mock.calls[0][0];
    expect(args.create.payload).toEqual({ name: "Budi", passwordHash: "hashed" });
  });
});

describe("verifyOtp", () => {
  function rowWith(code, overrides = {}) {
    return {
      id: "row-1",
      subject: "a@b.c",
      purpose: "REGISTER",
      codeHash: __hashForTests(code),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      payload: { name: "Budi", passwordHash: "hashed" },
      ...overrides,
    };
  }

  it("accepts the correct code and returns the consumed row", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowWith("123456"));
    prisma.emailOtp.update.mockResolvedValue({});

    const row = await verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "123456" });

    expect(row.id).toBe("row-1");
    // One update records the attempt, one burns the code.
    expect(prisma.emailOtp.update).toHaveBeenCalledTimes(2);
    const last = prisma.emailOtp.update.mock.calls.at(-1)[0];
    expect(last.data.consumedAt).toBeInstanceOf(Date);
  });

  it("throws NOT_SENT when no code was ever issued", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(null);
    await expect(
      verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "123456" }),
    ).rejects.toThrow(/Belum ada kode/);
  });

  it("throws EXPIRED when the window has passed", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(
      rowWith("123456", { expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(
      verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "123456" }),
    ).rejects.toThrow(/kedaluwarsa/);
  });

  it("throws ALREADY_USED when the code was consumed", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(
      rowWith("123456", { consumedAt: new Date() }),
    );
    await expect(
      verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "123456" }),
    ).rejects.toThrow(/sudah pernah dipakai/);
  });

  it("throws INVALID on a wrong code", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowWith("123456"));
    prisma.emailOtp.update.mockResolvedValue({});
    await expect(
      verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "999999" }),
    ).rejects.toThrow(/Kode salah/);
  });

  it("counts attempts and burns the code after the ceiling", async () => {
    // attempts is already at the ceiling from a previous submission.
    prisma.emailOtp.findUnique.mockResolvedValue(rowWith("123456", { attempts: 5 }));
    prisma.emailOtp.update.mockResolvedValue({});

    await expect(
      verifyOtp({ subject: "a@b.c", purpose: "REGISTER", code: "123456" }),
    ).rejects.toThrow(/Terlalu banyak percobaan/);
  });
});
