// ============================================================================
// GET /api/orders/[id], one order, scoped to its owner.
//
// The `userId` filter is part of the QUERY, not a post-fetch comparison: an
// order belonging to somebody else is indistinguishable from one that does not
// exist (both 404). That is the IDOR defence, an attacker cannot probe which
// order ids are real, and cannot learn a valid id by timing or by error text.
//
// Staff may read any order through /dev, which uses the server-rendered pages
// and its own role guard; this route stays member-scoped on purpose.
// ============================================================================
import { route, ok, guardMutation } from "@/lib/api.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { getOrderForUser } from "@/services/order.service.js";
import { uuid } from "@/lib/validation.js";
import { AppError } from "@/lib/errors.js";

export const dynamic = "force-dynamic";

export const GET = route(async (req, ctx, { log }) => {
  const user = await requireAuth(req);

  const { id } = await ctx.params;

  // Validate the shape before it reaches the database: a malformed uuid is a
  // 400, not a Prisma error.
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new AppError("ITP_NOT_FOUND", "Transaksi tidak ditemukan.");

  const order = await getOrderForUser({ orderId: parsed.data, userId: user.id });

  log.debug("orders.detail", { userId: user.id, orderId: order.id });

  return ok({ order }, { req });
});
