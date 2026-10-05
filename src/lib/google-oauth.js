// ============================================================================
// Google OAuth: sign in with Google.
//
// No next-auth. The flow is small enough to hold in one file, and hand-rolling
// it keeps the dependency surface at zero and makes the security properties
// readable instead of implicit in a library's defaults:
//
//   1. /api/auth/google/start issues an opaque `state` and a PKCE `verifier`,
//      stores both in a short-lived signed cookie, and redirects to Google.
//   2. Google redirects back with an authorization `code` and echoes `state`.
//   3. /api/auth/google/callback verifies state and exchanges code + verifier
//      for tokens, then reads the userinfo endpoint for the verified claims.
//
// WHY PKCE, WHEN THE CLIENT IS NOT PUBLIC
//
//   The client secret is server-side, so PKCE is not strictly required to
//   protect the token exchange. It is kept because it makes a intercepted
//   authorization code useless without the verifier, which never leaves this
//   process. Defense in depth for one extra hash.
//
// WHY `state` IS SIGNED, NOT JUST RANDOM
//
//   A random state proves the redirect came from us, but signing it also proves
//   it was not modified. The redirect URI and the intended next path ride along
//   in the state, so a state a attacker could rewrite would let them steer the
//   post-login redirect. The signature binds them.
//
// EMAIL VERIFICATION IS GOOGLE'S ASSERTION, NOT OURS
//
//   A Google account with an unverified email is not evidence the address is
//   reachable. `email_verified` must be true before the address may be treated
//   as a verified email.
// ============================================================================
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { optional, isProduction } from "./env.server.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { AUDIT, ROLES } from "./constants.js";
import { createSession } from "./auth/session.js";
import { writeAudit } from "../services/audit.service.js";
import { assessPasswordStrength, hashPassword } from "./auth/password.js";

const ALG = "HS256";
const ISSUER = "itopup";
const AUDIENCE = "itopup-oauth";
const STATE_TTL_SECONDS = 600;
// Shorter than the state cookie: the user only needs to type a password.
const TICKET_AUDIENCE = "itopup-oauth-ticket";
const TICKET_TTL_SECONDS = 600;
const SCOPES = ["openid", "email", "profile"].join(" ");

function secretKey() {
  const secret = optional("AUTH_SECRET");
  if (!secret || secret.length < 32) {
    throw new AppError(
      "ITP_INTERNAL_ERROR",
      "AUTH_SECRET belum diset atau kurang dari 32 karakter.",
    );
  }
  return new TextEncoder().encode(secret);
}

export function isGoogleEnabled() {
  return Boolean(
    optional("GOOGLE_OAUTH_CLIENT_ID") &&
      optional("GOOGLE_OAUTH_CLIENT_SECRET") &&
      optional("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

/** The redirect URI registered in the Google Cloud console, base + path. */
function redirectUri() {
  const explicit = optional("GOOGLE_OAUTH_REDIRECT_URI");
  if (explicit) return explicit;
  const base = optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

/**
 * Build the Google authorization URL and the cookie value that binds the
 * request together. The cookie is a signed JWT so it cannot be tampered with
 * client-side; the verifier inside it is the PKCE secret.
 *
 * @param {Object} input
 * @param {string} input.nextPath  where to land after a successful login
 * @returns {Promise<{ url: string, cookie: string }>}
 */
export async function buildAuthorizationUrl({ nextPath = "/member" }) {
  if (!isGoogleEnabled()) {
    throw new AppError("ITP_PROVIDER_NOT_CONFIGURED", "Login dengan Google belum dikonfigurasi.");
  }

  // PKCE: verifier is the secret, challenge is what Google sees.
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");

  const cookie = await signState({ state, verifier, nonce, nextPath });

  const params = new URLSearchParams({
    client_id: optional("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    access_type: "offline",
    prompt: "select_account",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return { url, cookie };
}

async function signState(payload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setSubject("oauth-state")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(secretKey());
}

/**
 * A ticket lets the set-password page finish a Google sign-up.
 *
 * It is deliberately a SEPARATE audience from `signState`: a state cookie must
 * never be accepted as a ticket (and vice versa), because a state is only proof
 * the user came from our start route, not that they completed the Google side.
 */
async function signTicket(payload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setSubject("oauth-ticket")
    .setIssuer(ISSUER)
    .setAudience(TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(secretKey());
}

async function verifyTicket(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: TICKET_AUDIENCE,
      subject: "oauth-ticket",
    });
    if (!payload?.subject || !payload?.email) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Same payload as `verifyTicket`, exposed for a server component that only
 * needs to READ the identity (to render the page), not to consume it.
 */
export async function verifyTicketForPage(token) {
  return verifyTicket(token);
}

async function verifyState(cookie) {
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, secretKey(), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload?.state || !payload?.verifier) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Exchange an authorization code for tokens, then read the verified userinfo.
 *
 * @param {Object} input
 * @param {string} input.code
 * @param {string} input.state
 * @param {string} input.cookie  the oauth cookie from the start step
 * @param {Object} input.request
 * @returns {Promise<({ user: Object, token: string, nextPath: string } | { needsPassword: true, oauthTicket: string })>}
 */
export async function completeGoogleLogin({ code, state, cookie, request = {} }) {
  if (!isGoogleEnabled()) {
    throw new AppError("ITP_PROVIDER_NOT_CONFIGURED", "Login dengan Google belum dikonfigurasi.");
  }

  const payload = await verifyState(cookie);
  // state must match what we signed, and the cookie must still be valid. This
  // is the CSRF protection for the whole flow.
  if (!payload || payload.state !== state) {
    throw new AppError("ITP_UNAUTHORIZED", "Sesi login Google tidak valid. Coba lagi.");
  }

  const tokens = await exchangeCode({ code, verifier: payload.verifier });
  const profile = await fetchUserInfo(tokens.access_token);

  if (!profile?.sub || !profile?.email) {
    throw new AppError("ITP_PROVIDER_ERROR", "Google tidak mengembalikan data akun.");
  }

  // Google's own assertion that the address is verified. Without it, linking
  // this email to an existing account would let a Google user with an
  // unverified address take over a password account.
  if (profile.email_verified !== true) {
    throw new AppError(
      "ITP_EMAIL_NOT_VERIFIED",
      "Email Google Anda belum diverifikasi. Verifikasi email di Google terlebih dahulu.",
    );
  }

  const email = profile.email.toLowerCase();
  const name = profile.name || profile.given_name || profile.email.split("@")[0];

  const { user, linked } = await upsertGoogleUser({ subject: profile.sub, email, name, request });

  // A Google identity only gets a session when the account already has a
  // password. An account created by this flow (or linked from an OAuth-only
  // one) has none, and it must set one before it can log in: see the
  // needsPassword branch below.
  if (user.passwordHash) {
    const { token } = await createSession(user, {
      ip: request.ip ?? null,
      userAgent: request.userAgent ?? null,
    });
    return { user, token, linked, nextPath: payload.nextPath ?? "/member" };
  }

  // A short-lived signed ticket carries the resolved identity to the set-
  // password page. It is NOT a session: it only proves "this Google identity
  // passed the checks above and is allowed to finish setting up this account".
  const oauthTicket = await signTicket({
    subject: profile.sub,
    email,
    name,
    nextPath: payload.nextPath ?? "/member",
  });

  await writeAudit({
    action: AUDIT.LOGIN_SUCCESS,
    actor: { id: user.id, role: user.role },
    metadata: { method: "google", outcome: "password_required" },
    request,
  });

  return { needsPassword: true, oauthTicket };
}

/**
 * Verify a ticket issued by `completeGoogleLogin` and set the account's
 * password, completing a Google sign-up.
 *
 * The ticket is what makes this safe: the password page never trusts a query
 * param, only a signed token that already carries the verified Google identity.
 *
 * @returns {Promise<{ user: Object, token: string, nextPath: string }>}
 */
export async function completeGoogleSignup({ ticket, password, request = {} }) {
  const payload = await verifyTicket(ticket);
  if (!payload) {
    throw new AppError("ITP_UNAUTHORIZED", "Tiket pendaftaran tidak valid atau sudah kedaluwarsa.");
  }

  const { subject, email, name, nextPath } = payload;

  const strength = assessPasswordStrength(password);
  if (!strength.ok) {
    throw new AppError("ITP_VALIDATION_ERROR", strength.message, {
      details: [{ field: "password", message: strength.message }],
    });
  }

  // Re-resolve the identity from the database rather than trusting the ticket's
  // email alone: the state of the account may have changed since the ticket was
  // issued (e.g. the user finished setting a password in another tab).
  const account = await prisma.oAuthAccount.findUnique({
    where: { provider_subject: { provider: "google", subject } },
    include: { user: { select: { ...PUBLIC_USER_SELECT_NEEDED, passwordHash: true } } },
  });

  if (!account || account.email !== email || !account.user) {
    throw new AppError("ITP_UNAUTHORIZED", "Akun Google ini tidak ditemukan.");
  }

  if (account.user.passwordHash) {
    // Already completed elsewhere. Do not let a replayed ticket overwrite the
    // existing password; just sign the user in.
    const { token } = await createSession(account.user, {
      ip: request.ip ?? null,
      userAgent: request.userAgent ?? null,
    });
    return { user: account.user, token, nextPath };
  }

  const user = await prisma.user.update({
    where: { id: account.user.id },
    data: { passwordHash: await hashPassword(password) },
    select: PUBLIC_USER_SELECT_NEEDED,
  });

  await writeAudit({
    action: AUDIT.PASSWORD_SET_FROM_OAUTH,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: user.id,
    metadata: { email, method: "google" },
    request,
  });

  const { token } = await createSession(user, {
    ip: request.ip ?? null,
    userAgent: request.userAgent ?? null,
  });

  return { user, token, nextPath };
}

async function exchangeCode({ code, verifier }) {
  const body = new URLSearchParams({
    code,
    client_id: optional("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: optional("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new AppError("ITP_PROVIDER_ERROR", "Gagal menukar kode otorisasi Google.");
  }

  const tokens = await response.json();
  if (!tokens?.access_token) {
    throw new AppError("ITP_PROVIDER_ERROR", "Google tidak mengembalikan token akses.");
  }
  return tokens;
}

async function fetchUserInfo(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new AppError("ITP_PROVIDER_ERROR", "Gagal mengambil profil Google.");
  }
  return response.json();
}

/**
 * Resolve a Google identity to a local user.
 *
 * Two cases, in the order they must be checked:
 *   1. The Google account is already linked to a user -> sign that user in.
 *   2. No link, but the email matches an existing password account -> link it,
 *      so the member gets one account instead of two. Requires Google's
 *      verified-email assertion, which the caller has already enforced.
 *
 * The brand-new case (no user, no matching email) deliberately does NOT create
 * an account here. It creates a *placeholder*: a User with no password and a
 * linked OAuthAccount, and the caller must then route the user to set a
 * password. The account cannot be logged into with a password until then, and
 * the OAuth link is the only way in — which is correct, the owner just proved
 * the Google identity. `passwordHash` in the returned user tells the caller
 * which situation it is.
 *
 * @returns {Promise<{ user: Object & { passwordHash: string | null }, linked: boolean }>}
 */
async function upsertGoogleUser({ subject, email, name, request = {} }) {
  const existing = await prisma.oAuthAccount.findUnique({
    where: { provider_subject: { provider: "google", subject } },
    include: { user: { select: { ...PUBLIC_USER_SELECT_NEEDED, passwordHash: true } } },
  });

  if (existing) {
    await prisma.oAuthAccount.update({
      where: { id: existing.id },
      data: { lastLoginAt: new Date() },
    });

    await writeAudit({
      action: AUDIT.LOGIN_SUCCESS,
      actor: { id: existing.user.id, role: existing.user.role },
      metadata: { method: "google", linked: true },
      request,
    });

    return { user: existing.user, linked: true };
  }

  // Case 2: link to an existing password account with the same address.
  const byEmail = await prisma.user.findUnique({
    where: { email },
    select: { ...PUBLIC_USER_SELECT_NEEDED, passwordHash: true },
  });
  if (byEmail) {
    await prisma.oAuthAccount.create({
      data: {
        userId: byEmail.id,
        provider: "google",
        subject,
        email,
      },
    });

    await writeAudit({
      action: AUDIT.LOGIN_SUCCESS,
      actor: { id: byEmail.id, role: byEmail.role },
      metadata: { method: "google", linked: true, merged: true },
      request,
    });

    return { user: byEmail, linked: true };
  }

  // Case 3: brand new. Create a password-less placeholder plus the OAuth link.
  // No session is issued for this: the caller sends the user to set a password.
  const user = await prisma.user.create({
    data: {
      name,
      email,
      // NULL, not a sentinel string: it must read as "no password" to the
      // caller and to `loginUser` (which would otherwise accept the sentinel).
      passwordHash: null,
      role: ROLES.MEMBER,
      emailVerified: true,
      oauthAccounts: {
        create: { provider: "google", subject, email },
      },
    },
    select: { ...PUBLIC_USER_SELECT_NEEDED, passwordHash: true },
  });

  await writeAudit({
    action: AUDIT.REGISTER,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: user.id,
    metadata: { email, method: "google", outcome: "password_required" },
    request,
  });

  return { user, linked: false };
}

const PUBLIC_USER_SELECT_NEEDED = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
};
