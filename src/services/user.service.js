// ============================================================================
// User service.
//
// All mutations that touch a credential or a security flag live here, so there
// is exactly one code path per security-sensitive operation.
//
// Never returns `passwordHash`. Every read goes through a projection that omits
// it. The type system cannot help in plain JS, so the discipline is structural.
// ============================================================================
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { AUDIT, ROLES } from "../lib/constants.js";
import {
  parse, registerSchema, loginSchema, profileUpdateSchema, changePasswordSchema, registerOtpSchema,
} from "../lib/validation.js";
import {
  issueOtp, sendOtpEmail, verifyOtp,
} from "./otp.service.js";
import {
  assessPasswordStrength, equaliseTiming, hashPassword, verifyPassword,
} from "../lib/auth/password.js";
import {
  createSession, destroyAllSessions, getSessionUser, invalidateAllSessions,
  PUBLIC_USER_SELECT,
} from "../lib/auth/session.js";
import { writeAudit } from "./audit.service.js";

/** Projection used everywhere a user is returned to a caller. */
const SAFE_USER = PUBLIC_USER_SELECT;

// ── Registration / login ────────────────────────────────────────────────────

/**
 * Stage one of registration: validate the form and send a code.
 *
 * The account is NOT created here. The form is held on the OTP row (already
 * server-side, already the thing the code guards) and committed only when the
 * code is confirmed by `confirmRegistration`. This keeps registration a single
 * secret-gated step: nothing exists to log into until the email is proven
 * reachable.
 *
 * @returns {Promise<{ sent: boolean }>} false when SMTP refused the message
 */
export async function requestRegistration(input, request = {}) {
  const { name, email, password, phone } = parse(registerSchema, input);

  const strength = assessPasswordStrength(password);
  if (!strength.ok) {
    throw new AppError("ITP_VALIDATION_ERROR", strength.message, {
      details: [{ field: "password", message: strength.message }],
    });
  }

  // Check before sending, so a typo'd address does not cost an email and a
  // code. Generic on purpose, same as the duplicate check below.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await writeAudit({
      action: AUDIT.REGISTER,
      metadata: { email, outcome: "duplicate" },
      request,
    });
    throw new AppError("ITP_CONFLICT", "Email sudah terdaftar. Silakan masuk atau gunakan email lain.");
  }

  const code = await issueOtp({
    subject: email,
    purpose: "REGISTER",
    ip: request.ip ?? null,
    // passwordHash, not password: the row is already a hashed-credential store.
    payload: { name, email, passwordHash: await hashPassword(password), phone: phone ?? null },
  });

  const sent = await sendOtpEmail({ to: email, code });
  if (!sent) {
    // The code exists but the user cannot receive it, so it is useless. Remove
    // it rather than leaving a row that would let a later /verify-otp call
    // create an account the owner cannot sign into.
    await prisma.emailOtp.deleteMany({ where: { subject: email, purpose: "REGISTER" } });
    throw new AppError("ITP_OTP_MAIL_UNAVAILABLE");
  }

  await writeAudit({
    action: AUDIT.REGISTER,
    metadata: { email, outcome: "otp_sent" },
    request,
  });

  return { sent };
}

/**
 * Stage two: confirm the code and create the account.
 *
 * The caller has already parsed and strength-checked the password in stage one;
 * here we only trust what the OTP row carries, which is server-authored.
 *
 * @returns {Promise<Object>} the created user, public projection
 */
export async function confirmRegistration(input, request = {}) {
  const { email, code } = parse(registerOtpSchema, input);

  const row = await verifyOtp({ subject: email, purpose: "REGISTER", code });
  const payload = row.payload ?? {};

  // The account must not already exist by the time the code is confirmed: a
  // user could have registered the same address through another path while the
  // code was outstanding.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new AppError("ITP_CONFLICT", "Email sudah terdaftar. Silakan masuk.");
  }

  if (!payload.name || !payload.passwordHash) {
    // The row predates this flow or was created by a different one. The user
    // must re-request: guessing at a partial payload would create a broken
    // account.
    throw new AppError("ITP_OTP_NOT_SENT", "Pendaftaran sudah kedaluwarsa. Silakan daftar ulang.");
  }

  const user = await prisma.user.create({
    data: {
      name: payload.name,
      email,
      phone: payload.phone ?? null,
      passwordHash: payload.passwordHash,
      role: ROLES.MEMBER,
      // The code reached the address, so it is verified by construction.
      emailVerified: true,
    },
    select: SAFE_USER,
  });

  await writeAudit({
    action: AUDIT.REGISTER,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: user.id,
    metadata: { email, outcome: "verified" },
    request,
  });

  return user;
}

/**
 * Authenticate and open a session.
 *
 * Every failure branch costs the same wall-clock time (see `equaliseTiming`) so
 * the response time cannot be used to discover which emails are registered.
 */
export async function loginUser(input, request = {}) {
  const { email, password } = parse(loginSchema, input);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...SAFE_USER, passwordHash: true, sessionVersion: true },
  });

  if (!user || !user.passwordHash) {
    // No password on the account: it was created via Google OAuth and the user
    // never finished the set-password step. bcrypt.compare() would also throw
    // on null, so this guard is what keeps the timing equalisation below
    // running instead of a 500. The message is the same as a wrong password on
    // purpose: "which emails are registered" is not the login page's to tell.
    await equaliseTiming();
    await writeAudit({
      action: AUDIT.LOGIN_FAILED,
      metadata: user ? { email, reason: "passwordless_account" } : { email, reason: "no_such_user" },
      request,
    });
    throw new AppError("ITP_INVALID_CREDENTIALS");
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    await writeAudit({
      action: AUDIT.LOGIN_FAILED,
      actor: { id: user.id, role: user.role },
      targetType: "User",
      targetId: user.id,
      metadata: { reason: "bad_password" },
      request,
    });
    throw new AppError("ITP_INVALID_CREDENTIALS");
  }

  // Blocked accounts authenticate successfully and are then refused, so the
  // member sees "your account is blocked" rather than a misleading bad password.
  if (user.status === "BLOCKED") {
    await writeAudit({
      action: AUDIT.LOGIN_FAILED,
      actor: { id: user.id, role: user.role },
      targetType: "User",
      targetId: user.id,
      metadata: { reason: "blocked" },
      request,
    });
    throw new AppError("ITP_ACCOUNT_BLOCKED");
  }

  const { token, expiresAt } = await createSession(user, {
    ip: request.ip,
    userAgent: request.userAgent,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await writeAudit({
    action: AUDIT.LOGIN_SUCCESS,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: user.id,
    request,
  });

  const { passwordHash: _omit, sessionVersion: _sv, ...safe } = user;
  return { user: safe, token, expiresAt };
}

// ── Profile ─────────────────────────────────────────────────────────────────

export async function getUserById(id) {
  return prisma.user.findUnique({ where: { id }, select: SAFE_USER });
}

export async function updateProfile(userId, input, request = {}) {
  const data = parse(profileUpdateSchema, input);

  if (Object.keys(data).length === 0) {
    throw new AppError("ITP_VALIDATION_ERROR", "Tidak ada perubahan yang dikirim.");
  }

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, phone: true },
  });
  if (!before) throw new AppError("ITP_NOT_FOUND", "Akun tidak ditemukan.");

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: SAFE_USER,
  });

  await writeAudit({
    action: AUDIT.PROFILE_UPDATED,
    actor: { id: user.id, role: user.role },
    targetType: "User",
    targetId: userId,
    // Only the fields that changed, and only their old values (the new ones are
    // already on the row).
    metadata: {
      changed: Object.keys(data),
      before: { name: before.name, phone: before.phone },
    },
    request,
  });

  return user;
}

/**
 * Change your own password.
 *
 * Invalidates every OTHER session but keeps the current one usable. Otherwise,
 * the member is logged out of the tab they just used to change it, which reads
 * as a bug.
 */
export async function changeOwnPassword(userId, input, request = {}) {
  const { currentPassword, newPassword } = parse(changePasswordSchema, input);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, passwordHash: true },
  });
  if (!user) throw new AppError("ITP_NOT_FOUND", "Akun tidak ditemukan.");

  if (!user.passwordHash) {
    // The account has no password to change because it was created via Google
    // and the set-password step was never completed. Tell the member how to
    // fix it instead of crashing on a null compare.
    throw new AppError(
      "ITP_INVALID_ACCOUNT",
      "Akun Anda belum memiliki password. Masuk dengan Google lalu buat password dari halaman pendaftaran.",
    );
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("ITP_INVALID_CREDENTIALS", "Password saat ini salah.");
  }

  const strength = assessPasswordStrength(newPassword);
  if (!strength.ok) {
    throw new AppError("ITP_VALIDATION_ERROR", strength.message, {
      details: [{ field: "newPassword", message: strength.message }],
    });
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new AppError("ITP_VALIDATION_ERROR", "Password baru tidak boleh sama dengan yang lama.", {
      details: [{ field: "newPassword", message: "Password baru tidak boleh sama dengan yang lama." }],
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // Bumping sessionVersion inside the same transaction means a token minted a
    // millisecond ago is already dead.
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit({
      action: AUDIT.PASSWORD_CHANGED,
      actor: { id: userId, role: user.role },
      targetType: "User",
      targetId: userId,
      tx,
      strict: true,
      request,
    });
  });

  return { ok: true, sessionsRevoked: true };
}

// ── Session helpers re-exported for route handlers ──────────────────────────

export async function currentUser(req) {
  return getSessionUser(req);
}

export async function revokeAllSessions(userId, request = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) throw new AppError("ITP_NOT_FOUND", "Akun tidak ditemukan.");

  await invalidateAllSessions(userId);
  await writeAudit({
    action: AUDIT.SESSIONS_INVALIDATED,
    actor: user,
    targetType: "User",
    targetId: userId,
    request,
  });
  return { ok: true };
}

// ── Admin operations ────────────────────────────────────────────────────────

/**
 * Block a member.
 *
 * Deletes their sessions in the same transaction: "blocked" must take effect
 * immediately, not at token expiry.
 */
export async function blockMember({ actor, userId, reason, request = {} }) {
  if (actor.id === userId) {
    throw new AppError("ITP_FORBIDDEN", "Anda tidak dapat memblokir akun sendiri.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, email: true },
  });
  if (!target) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");

  // Privilege-escalation guard: staff cannot block other staff unless they are
  // a SUPERADMIN, and nobody may block a SUPERADMIN.
  const rank = { MEMBER: 10, DEV: 20, SUPERADMIN: 30 };
  if ((rank[target.role] ?? 0) >= (rank[actor.role] ?? 0)) {
    throw new AppError("ITP_FORBIDDEN", "Anda tidak dapat memblokir akun dengan role setara atau lebih tinggi.");
  }
  if (target.status === "BLOCKED") {
    throw new AppError("ITP_CONFLICT", "Member sudah diblokir.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        status: "BLOCKED",
        blockedReason: reason,
        blockedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    });
    await tx.session.deleteMany({ where: { userId } });
    await tx.userBlock.create({
      data: { userId, reason, blockedById: actor.id },
    });
    await writeAudit({
      action: AUDIT.MEMBER_BLOCKED,
      actor,
      targetType: "User",
      targetId: userId,
      metadata: { reason, email: target.email },
      tx,
      strict: true,
      request,
    });
  });

  return { ok: true };
}

export async function unblockMember({ actor, userId, request = {} }) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, email: true, role: true },
  });
  if (!target) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");
  if (target.status !== "BLOCKED") {
    throw new AppError("ITP_CONFLICT", "Member tidak sedang diblokir.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status: "ACTIVE", blockedReason: null, blockedAt: null },
    });
    // Close the open block record so the block history stays queryable.
    await tx.userBlock.updateMany({
      where: { userId, unblockedAt: null },
      data: { unblockedAt: new Date(), unblockedById: actor.id },
    });
    await writeAudit({
      action: AUDIT.MEMBER_UNBLOCKED,
      actor,
      targetType: "User",
      targetId: userId,
      metadata: { email: target.email },
      tx,
      strict: true,
      request,
    });
  });

  return { ok: true };
}

/**
 * Admin-initiated password reset.
 *
 * The new password is never logged and never returned. The member must be told
 * out-of-band; the audit row records only that a reset happened and why.
 */
export async function adminResetPassword({ actor, userId, newPassword, reason, request = {} }) {
  const strength = assessPasswordStrength(newPassword);
  if (!strength.ok) {
    throw new AppError("ITP_VALIDATION_ERROR", strength.message, {
      details: [{ field: "newPassword", message: strength.message }],
    });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!target) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");

  const rank = { MEMBER: 10, DEV: 20, SUPERADMIN: 30 };
  if ((rank[target.role] ?? 0) >= (rank[actor.role] ?? 0) && actor.id !== userId) {
    throw new AppError("ITP_FORBIDDEN", "Anda tidak dapat mereset password akun dengan role setara atau lebih tinggi.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        sessionVersion: { increment: 1 },
      },
    });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit({
      action: AUDIT.PASSWORD_RESET_BY_ADMIN,
      actor,
      targetType: "User",
      targetId: userId,
      // `reason` is operator-supplied free text; sanitized by writeAudit.
      metadata: { reason, email: target.email },
      tx,
      strict: true,
      request,
    });
  });

  return { ok: true };
}

export async function changeMemberRole({ actor, userId, role, request = {} }) {
  if (actor.id === userId) {
    throw new AppError("ITP_FORBIDDEN", "Anda tidak dapat mengubah role akun sendiri.");
  }
  // Only a SUPERADMIN may hand out staff roles.
  if (actor.role !== "SUPERADMIN") {
    throw new AppError("ITP_FORBIDDEN", "Hanya Super Admin yang dapat mengubah role.");
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!target) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");
  if (target.role === role) {
    throw new AppError("ITP_CONFLICT", "Role tidak berubah.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { role, sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit({
      action: AUDIT.MEMBER_ROLE_CHANGED,
      actor,
      targetType: "User",
      targetId: userId,
      metadata: { from: target.role, to: role, email: target.email },
      tx,
      strict: true,
      request,
    });
  });

  return { ok: true };
}

// ── Admin queries ───────────────────────────────────────────────────────────

/**
 * Paginated member list with aggregate spend.
 * Search is a parameterised Prisma `contains`, never string-interpolated SQL.
 */
export async function listMembers({ page = 1, limit = 20, search = "", status = null, role = null } = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;

  const where = {};
  if (search) {
    const term = String(search).trim().slice(0, 100);
    where.OR = [
      { email: { contains: term, mode: "insensitive" } },
      { name: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
  }
  if (status) where.status = status;
  if (role) where.role = role;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        ...SAFE_USER,
        _count: { select: { orders: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  // Aggregate spend per member in one grouped query, not N queries.
  const ids = items.map((u) => u.id);
  const spend = ids.length
    ? await prisma.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, status: "SUCCESS" },
        _sum: { total: true },
        _count: { _all: true },
      })
    : [];
  const spendByUser = new Map(spend.map((row) => [row.userId, row]));

  return {
    items: items.map((user) => {
      const row = spendByUser.get(user.id);
      return {
        ...user,
        orderCount: user._count.orders,
        successCount: row?._count?._all ?? 0,
        totalSpend: row?._sum?.total ?? 0,
        _count: undefined,
      };
    }),
    pagination: { page: Math.max(1, Number(page) || 1), limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
  };
}

export async function getMemberDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...SAFE_USER,
      blockedReason: true,
      blockedAt: true,
      _count: { select: { orders: true } },
    },
  });
  if (!user) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");

  const [aggregate, recentOrders, blocks] = await Promise.all([
    prisma.order.aggregate({
      where: { userId, status: "SUCCESS" },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, invoice: true, status: true, total: true,
        gameName: true, variantName: true, createdAt: true,
      },
    }),
    prisma.userBlock.findMany({
      where: { userId },
      orderBy: { blockedAt: "desc" },
      take: 10,
    }),
  ]);

  const { _count, ...rest } = user;
  return {
    user: rest,
    stats: {
      orderCount: _count.orders,
      successCount: aggregate._count._all,
      totalSpend: aggregate._sum.total ?? 0,
    },
    recentOrders,
    blocks,
  };
}
