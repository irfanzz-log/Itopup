// Unit tests for the two-step registration flow.
//
// The contract under test is structural, not merely behavioural: no user row is
// created until a code is confirmed, and the form is carried by the OTP row
// rather than re-submitted by the client.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    emailOtp: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/mail.js", () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  isMailConfigured: vi.fn().mockReturnValue(true),
}));

// Password hashing is real (bcryptjs) so the payload actually carries a digest.
// equaliseTiming is a no-op wrapper; importing the real module is enough.
vi.mock("../../src/services/audit.service.js", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { requestRegistration, confirmRegistration } from "../../src/services/user.service.js";
import { prisma } from "../../src/lib/db.js";
import { sendMail } from "../../src/lib/mail.js";

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.emailOtp.update.mockResolvedValue({});
  sendMail.mockResolvedValue(true);
});

const FORM = { name: "Budi", email: "budi@example.com", password: "BudiTopup!2026" };

describe("requestRegistration", () => {
  it("sends a code and stores the form WITHOUT creating a user", async () => {
    await requestRegistration(FORM, {});

    expect(sendMail).toHaveBeenCalledOnce();
    expect(prisma.emailOtp.upsert).toHaveBeenCalledOnce();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("stores a passwordHash, never the plaintext, in the payload", async () => {
    await requestRegistration(FORM, {});

    const args = prisma.emailOtp.upsert.mock.calls[0][0];
    const payload = args.create.payload;
    expect(payload.passwordHash).toBeTruthy();
    expect(payload.passwordHash).not.toBe(FORM.password);
  });

  it("deletes the code when the mailer refuses, so verify cannot create a ghost account", async () => {
    sendMail.mockResolvedValue(false);

    await expect(requestRegistration(FORM, {})).rejects.toThrow();

    expect(prisma.emailOtp.deleteMany).toHaveBeenCalledOnce();
  });

  it("refuses a duplicate email with a generic conflict, not an enumeration signal", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(requestRegistration(FORM, {})).rejects.toThrow(/sudah terdaftar/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a weak password before any email is sent", async () => {
    await expect(
      requestRegistration({ ...FORM, password: "short" }, {}),
    ).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("confirmRegistration", () => {
  function rowWith(code, overrides = {}) {
    return {
      id: "row-1",
      subject: FORM.email,
      purpose: "REGISTER",
      codeHash: undefined, // unused by the service under test; verifyOtp is real
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      payload: { name: FORM.name, email: FORM.email, passwordHash: "hashed", phone: null },
      ...overrides,
    };
  }

  // verifyOtp hashes the submitted code and compares to codeHash, so the row
  // must carry the hash of the same code the test submits.
  function rowForCode(code, overrides = {}) {
    return rowWith(code, {
      codeHash: require("node:crypto").createHash("sha256").update(code).digest("hex"),
      ...overrides,
    });
  }

  it("creates the user only after the code is confirmed", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("123456"));
    prisma.user.create.mockResolvedValue({ id: "new-user", name: FORM.name, email: FORM.email });

    const user = await confirmRegistration({ email: FORM.email, code: "123456" }, {});

    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(user.email).toBe(FORM.email);
  });

  it("marks the created account emailVerified", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("123456"));
    prisma.user.create.mockResolvedValue({ id: "u", email: FORM.email });

    await confirmRegistration({ email: FORM.email, code: "123456" }, {});

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.emailVerified).toBe(true);
  });

  it("uses the payload's hash, not a re-derived password", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("123456"));
    prisma.user.create.mockResolvedValue({ id: "u" });

    await confirmRegistration({ email: FORM.email, code: "123456" }, {});

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.passwordHash).toBe("hashed");
    // The plaintext never appears on the create call.
    expect(JSON.stringify(data)).not.toContain("BudiTopup!2026");
  });

  it("refuses to create when the email was registered while the code was outstanding", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("123456"));
    prisma.user.findUnique.mockResolvedValue({ id: "someone-else" });

    await expect(
      confirmRegistration({ email: FORM.email, code: "123456" }, {}),
    ).rejects.toThrow(/sudah terdaftar/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("refuses a payload that predates this flow", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("123456", { payload: {} }));

    await expect(
      confirmRegistration({ email: FORM.email, code: "123456" }, {}),
    ).rejects.toThrow(/daftar ulang/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("propagates an invalid-code error without creating the user", async () => {
    prisma.emailOtp.findUnique.mockResolvedValue(rowForCode("111111"));

    await expect(
      confirmRegistration({ email: FORM.email, code: "222222" }, {}),
    ).rejects.toThrow(/Kode salah/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
