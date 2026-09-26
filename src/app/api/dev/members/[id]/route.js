// ============================================================================
// POST /api/dev/members/[id] — staff actions on a member account.
//
// Same shape and same reasoning as /api/dev/orders/[id]: explicit named actions,
// never a generic PATCH. Each one has a different precondition and a different
// audit trail, and role changes are SUPERADMIN-only because a DEV promoting
// themselves is a privilege escalation.
//
// Actions:
//   block          — suspend the account and kill its sessions  (DEV+)
//   unblock        — restore access                             (DEV+)
//   reset_password — set a new password, kill all sessions      (DEV+)
//   change_role    — promote/demote                             (SUPERADMIN only)
//
// A staff member may not act on THEMSELVES for block/role — locking yourself out
// is not a business operation.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff, requireSuperadmin, ROLE_RANK } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { blockMember, unblockMember, adminResetPassword, changeMemberRole } from "@/services/user.service.js";
import { ROLES } from "@/lib/constants.js";

const schema = z
  .object({
    action: z.enum(["block", "unblock", "reset_password", "change_role"]),
    reason: z.string().trim().max(300).optional(),
    newPassword: z.string().min(10).max(200).optional(),
    role: z.enum(Object.values(ROLES)).optional(),
  })
  .strict()
  .refine((v) => v.action !== "reset_password" || Boolean(v.newPassword), {
    message: "Password baru wajib diisi.",
    path: ["newPassword"],
  })
  .refine((v) => v.action !== "change_role" || Boolean(v.role), {
    message: "Peran baru wajib dipilih.",
    path: ["role"],
  });

export const POST = route(async (req, ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 8 * 1024 });

  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const { id } = await ctx.params;
  const userId = uuid.parse(id);
  const { action, reason, newPassword, role } = parse(schema, body);

  // ── Self-protection: no staff member may block or demote themselves. ─────
  if (userId === actor.id && (action === "block" || action === "change_role")) {
    throw new AppError(
      "ITP_FORBIDDEN",
      "Anda tidak dapat memblokir atau mengubah peran akun Anda sendiri."
    );
  }

  // ── Role changes are SUPERADMIN-only. ───────────────────────────────────
  // A DEV must not be able to grant itself or anyone else more authority.
  if (action === "change_role") {
    await requireSuperadmin(req);
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!target) throw new AppError("ITP_NOT_FOUND", "Member tidak ditemukan.");

  log.info("dev.member_action", { targetId: userId, action, actorId: actor.id });

  switch (action) {
    case "block": {
      // Refuse to block the last remaining superadmin — that is how a business
      // loses access to its own admin panel.
      if (target.role === ROLES.SUPERADMIN) {
        const remaining = await prisma.user.count({
          where: { role: ROLES.SUPERADMIN, status: "ACTIVE", id: { not: userId } },
        });
        if (remaining === 0) {
          throw new AppError(
            "ITP_FORBIDDEN",
            "Tidak dapat memblokir super admin terakhir yang masih aktif."
          );
        }
      }

      const result = await blockMember({ actor, userId, reason: reason ?? null, request: requestCtx });
      return ok(result, { req });
    }

    case "unblock": {
      const result = await unblockMember({ actor, userId, request: requestCtx });
      return ok(result, { req });
    }

    case "reset_password": {
      const result = await adminResetPassword({
        actor,
        userId,
        newPassword,
        reason: reason ?? null,
        request: requestCtx,
      });
      return ok(result, { req });
    }

    case "change_role": {
      // A staff member may not promote anyone above their own rank. Without
      // this, a DEV could mint a SUPERADMIN and then use it.
      if ((ROLE_RANK[role] ?? 0) > (ROLE_RANK[actor.role] ?? 0)) {
        throw new AppError(
          "ITP_FORBIDDEN",
          "Anda tidak dapat memberikan peran yang lebih tinggi dari peran Anda."
        );
      }

      const result = await changeMemberRole({ actor, userId, role, request: requestCtx });
      return ok(result, { req });
    }

    default:
      throw new AppError("ITP_INVALID_INPUT", "Aksi tidak dikenal.");
  }
});
