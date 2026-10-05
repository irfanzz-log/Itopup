// Unit tests for the Google OAuth identity resolution and set-password flow.
//
// The contract under test: a Google identity never yields a session until the
// local account has a password. A new Google user gets a placeholder + a signed
// ticket; the session comes only from completeGoogleSignup.
import { describe, it, expect, vi, beforeEach } from "vitest";

const FAKE_HASH = "$2a$12$hashedpasswordvalue";

vi.mock("../../src/lib/db.js", () => ({
  prisma: {
    oAuthAccount: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/lib/auth/session.js", () => ({
  createSession: vi.fn().mockResolvedValue({ token: "session-token" }),
  PUBLIC_USER_SELECT: { id: true, email: true },
}));

vi.mock("../../src/lib/auth/password.js", () => ({
  assessPasswordStrength: vi.fn().mockReturnValue({ ok: true }),
  hashPassword: vi.fn().mockResolvedValue(FAKE_HASH),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/services/audit.service.js", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// exchangeCode/fetchUserInfo are network calls; the tests decide what Google
// answered. isGoogleEnabled reads env, so force it on.
vi.mock("../../src/lib/env.server.js", () => ({
  optional: (key) => (key === "AUTH_SECRET" ? "a".repeat(48) : "configured"),
  isProduction: () => false,
}));

const { prisma } = await import("../../src/lib/db.js");
const { completeGoogleLogin, completeGoogleSignup } = await import("../../src/lib/google-oauth.js");
const { writeAudit } = await import("../../src/services/audit.service.js");

// The caller already verified state against the cookie. completeGoogleLogin
// signs the state with the same AUTH_SECRET the mocked env.server provides, so
// the tests sign a matching cookie instead of stubbing the verifier.
async function issueStateCookie(payload) {
  const { SignJWT } = await import("jose");
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("oauth-state")
    .setIssuer("itopup")
    .setAudience("itopup-oauth")
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(new TextEncoder().encode("a".repeat(48)));
}

// exchangeCode/fetchUserInfo are network calls; tests patch the module's own
// fetch instead of hand-rolling a token response.
const STATE_PAYLOAD = { state: "state-abc", verifier: "verifier-xyz", nonce: "nonce-123", nextPath: "/member" };
const GOOGLE_PROFILE = {
  sub: "google-sub-123",
  email: "newuser@example.com",
  email_verified: true,
  name: "New User",
};

let stateCookie = null;
beforeEach(async () => {
  stateCookie = await issueStateCookie(STATE_PAYLOAD);
});

async function loginFor(profile) {
  const cookie = await issueStateCookie({ ...STATE_PAYLOAD });
  return completeGoogleLogin({
    code: "auth-code",
    state: STATE_PAYLOAD.state,
    cookie,
    request: { ip: "127.0.0.1" },
  });
}

// exchangeCode + fetchUserInfo hit Google; a canned response per test replaces
// the network so the tests never touch accounts.google.com.
function givenGoogleReturns(profile) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("userinfo")) {
      return { ok: true, json: async () => profile };
    }
    return { ok: true, json: async () => ({ access_token: "fake-access-token" }) };
  });
}

function resetMocks() {
  prisma.oAuthAccount.findUnique.mockResolvedValue(null);
  prisma.oAuthAccount.create.mockResolvedValue({});
  prisma.oAuthAccount.update.mockResolvedValue({});
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue({ id: "u1", email: GOOGLE_PROFILE.email, passwordHash: null });
  prisma.user.update.mockResolvedValue({ id: "u1", email: GOOGLE_PROFILE.email });
  writeAudit.mockClear();
}

describe("google-oauth: account with a password logs in directly", () => {
  beforeEach(resetMocks);

  it("signs in an already-linked account without creating anything", async () => {
    prisma.oAuthAccount.findUnique.mockResolvedValue({
      id: "oa1",
      email: GOOGLE_PROFILE.email,
      user: { id: "u-existing", email: GOOGLE_PROFILE.email, passwordHash: FAKE_HASH },
    });

    givenGoogleReturns(GOOGLE_PROFILE);
  const result = await loginFor(GOOGLE_PROFILE);

    expect(result.needsPassword).toBeFalsy();
    expect(result.token).toBe("session-token");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("links a matching password account and logs in (no second account)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u-by-email",
      email: GOOGLE_PROFILE.email,
      passwordHash: FAKE_HASH,
    });

    givenGoogleReturns(GOOGLE_PROFILE);
  const result = await loginFor(GOOGLE_PROFILE);

    expect(result.needsPassword).toBeFalsy();
    expect(prisma.oAuthAccount.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("google-oauth: passwordless account never gets a session", () => {
  beforeEach(resetMocks);

  it("creates a NULL-password placeholder and returns a ticket, not a session", async () => {
    givenGoogleReturns(GOOGLE_PROFILE);
  const result = await loginFor(GOOGLE_PROFILE);

    expect(result.needsPassword).toBe(true);
    expect(result.oauthTicket).toBeTypeOf("string");

    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.passwordHash).toBeNull();
    expect(createCall.data.emailVerified).toBe(true);

    // The placeholder is created, but no session is opened for it here.
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REGISTER",
        metadata: expect.objectContaining({ outcome: "password_required" }),
      }),
    );
  });

  it("asks for a password when a returning Google user has none", async () => {
    prisma.oAuthAccount.findUnique.mockResolvedValue({
      id: "oa1",
      email: GOOGLE_PROFILE.email,
      user: { id: "u-returning", email: GOOGLE_PROFILE.email, passwordHash: null },
    });

    givenGoogleReturns(GOOGLE_PROFILE);
  const result = await loginFor(GOOGLE_PROFILE);

    expect(result.needsPassword).toBe(true);
    expect(result.oauthTicket).toBeTypeOf("string");
  });
});

describe("google-oauth: completeGoogleSignup", () => {
  beforeEach(resetMocks);

  it("rejects a bogus ticket without touching the database", async () => {
    await expect(
      completeGoogleSignup({ ticket: "not-a-jwt", password: "ValidPass!1", request: {} }),
    ).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("requires a strong password before creating the account", async () => {
    const { assessPasswordStrength } = await import("../../src/lib/auth/password.js");
    assessPasswordStrength.mockReturnValueOnce({ ok: false, message: "Password minimal 8 karakter." });

    // Sign a real ticket so we get past the signature check.
    const ticket = await issueTicketFor({ subject: "google-sub-123", email: GOOGLE_PROFILE.email });

    await expect(
      completeGoogleSignup({ ticket, password: "short", request: {} }),
    ).rejects.toThrow(/Password minimal 8 karakter/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// Helper: produce a ticket the same way the module does, so the signup tests
// exercise the real signing/verification round-trip.
async function issueTicketFor(payload) {
  const { SignJWT } = await import("jose");
  return new SignJWT({ ...payload, nextPath: "/member" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("oauth-ticket")
    .setIssuer("itopup")
    .setAudience("itopup-oauth-ticket")
    .setIssuedAt()
    .setExpirationTime("600s")
    .sign(new TextEncoder().encode("a".repeat(48)));
}
