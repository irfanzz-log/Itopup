// ============================================================================
// Session management.
//
// Design:
//   * The cookie carries a signed JWT (jose, HS256). The JWT's only payload is
//     the session row id (`sid`) plus the user id as `sub`, never a role, never
//     an email, so a leaked token reveals nothing about the account.
//   * The database stores sha256(JWT), NOT the JWT. A database dump therefore
//     cannot be replayed as a live session, because the attacker would need the
//     preimage of the hash.
//   * Verification requires BOTH a valid signature and a matching, unexpired
//     session row, and the row's `userVersion` must equal the user's current
//     `sessionVersion`. That last check is what makes "force logout every
//     device" instant, without waiting for tokens to expire.
//   * Cookie flags: HttpOnly, SameSite=Lax, Secure in production, Path=/.
//     SameSite=Lax (not Strict) is deliberate: Strict drops the cookie on the
//     return leg of an OAuth/magic-link redirect, and Lax already blocks
//     cross-site POST, which is the CSRF vector that matters.
// ============================================================================
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";

export const SESSION_COOKIE = "itp_session";

const ALG = "HS256";
const ISSUER = "itopup";
const AUDIENCE = "itopup-web";

function maxAgeSeconds() {
  const n = parseInt(process.env.SESSION_MAX_AGE || "604800", 10);
  return Number.isFinite(n) && n > 0 ? n : 604800;
}

/** The cookie lifetime in seconds, for the OAuth callback to mirror exactly. */
export const SESSION_MAX_AGE_SECONDS = maxAgeSeconds();

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET belum diset atau kurang dari 32 karakter. " +
        'Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  return new TextEncoder().encode(secret);
}

/** sha256 hex, the only form of the token that ever reaches the database. */
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/** Public shape of a user, safe to serialise. Never includes passwordHash. */
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
};

/**
 * Create a session row and return the signed cookie value.
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(user, { ip = null, userAgent = null } = {}) {
  const id = randomUUID();
  const maxAge = maxAgeSeconds();
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  const token = await new SignJWT({ sid: id })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secretKey());

  await prisma.session.create({
    data: {
      id,
      tokenHash: hashToken(token),
      userId: user.id,
      userVersion: user.sessionVersion,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      expiresAt,
    },
  });

  return { token, expiresAt, maxAge };
}

/**
 * Resolve the user behind a raw cookie value, or null.
 * Never throws on a bad/expired/forged token; callers decide what to do.
 */
export async function userFromToken(token) {
  if (!token || typeof token !== "string") return null;

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    }));
  } catch {
    return null;
  }

  if (!payload?.sid || !payload?.sub) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { select: { ...PUBLIC_USER_SELECT, sessionVersion: true } } },
  });

  if (!session) return null;

  // Constant-time-ish comparison of the stored hash. Values are fixed-length
  // hex digests, so a length mismatch already means "different".
  if (session.tokenHash !== hashToken(token)) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const { sessionVersion, ...user } = session.user;

  // Password changed / forced logout after this session was issued.
  if (session.userVersion !== sessionVersion) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // A blocked member keeps their session row but is refused at the guard.
  // Returning the user here lets the guard produce a precise error message
  // instead of a generic "not logged in".
  return user;
}

/** Extract the cookie value from a route-handler request. */
export function tokenFromRequest(req) {
  const raw = req?.headers?.get?.("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Resolve the user from a route-handler request. */
export async function getSessionUser(req) {
  return userFromToken(tokenFromRequest(req));
}

/**
 * Resolve the user inside a server component / layout / server action.
 *
 * A component cannot be handed a `Request`, and `cookies()` is only reachable
 * from the request scope, hence two entry points over one verifier.
 */
export async function getCurrentUser() {
  // Imported lazily so this module stays loadable from plain Node scripts
  // (seed, cron) that have no Next request context.
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return userFromToken(store.get(SESSION_COOKIE)?.value);
}

/** Delete one session row (logout). Idempotent. */
export async function destroySession(req) {
  const token = tokenFromRequest(req);
  if (!token) return;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (payload?.sid) {
      await prisma.session.delete({ where: { id: payload.sid } }).catch(() => {});
    }
  } catch {
    /* token already invalid; nothing to revoke */
  }
}

/** Delete every session for a user (password change, admin force logout). */
export async function destroyAllSessions(userId) {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}

/**
 * Invalidate every session and every token already in flight for a user.
 * Bumping sessionVersion is what catches tokens that were minted a moment ago
 * and are still valid by signature.
 */
export async function invalidateAllSessions(userId, tx = prisma) {
  await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  return tx.session.deleteMany({ where: { userId } });
}

/**
 * Revoke every session EXCEPT the one making the request.
 *
 * Deliberately does NOT bump sessionVersion: that would invalidate the current
 * session too (its `userVersion` snapshot would no longer match), logging the
 * member out of the tab they just used, which reads as a bug. Deleting the
 * other rows is sufficient and leaves the current device working.
 *
 * @returns {Promise<number>} how many other sessions were ended
 */
export async function revokeOtherSessions(req, userId) {
  const token = tokenFromRequest(req);
  let currentSid = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, secretKey(), {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      currentSid = payload?.sid ?? null;
    } catch {
      /* An unverifiable token cannot identify the current session. */
    }
  }

  const { count } = await prisma.session.deleteMany({
    where: { userId, ...(currentSid ? { id: { not: currentSid } } : {}) },
  });
  return count;
}

/** Housekeeping: drop expired rows. Called by the maintenance job. */
export async function pruneExpiredSessions() {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

/** Cookie attributes, shared by set and clear so they cannot drift apart. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds(),
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

export { maxAgeSeconds };
