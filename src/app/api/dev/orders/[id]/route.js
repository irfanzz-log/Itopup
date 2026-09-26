// ============================================================================
// POST /api/dev/orders/[id] — staff actions on an order.
//
// ONE ROUTE, EXPLICIT ACTIONS — not a REST PATCH.
//
// Each action here is a business decision with its own preconditions, its own
// audit entry and its own side effects. Collapsing them into a generic
// `PATCH { status }` would let the UI set any status directly, bypassing the
// state machine and the payment settlement logic. An operator confirming a
// transfer must go through `settlePayment` so the order is dispatched; a raw
// status write would mark it PAID and never send the top-up.
//
// Actions:
//   confirm_payment  — money arrived → settle + dispatch   (SUPERADMIN or DEV)
//   reject_payment   — money never arrived → payment FAILED
//   reconcile        — ask the provider for the real status of a stuck order
//   cancel           — staff cancels an unpaid order
//
// Order of operations is the security control: staff role → CSRF/rate limit →
// validated body → ownership/state preconditions → side effect → audit.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireStaff } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { settlePayment, rejectPayment } from "@/services/payment.service.js";
import { transitionOrder, dispatchOrder } from "@/services/order.service.js";
import { getTopupProvider } from "@/providers/index.js";
import { ORDER_STATUS } from "@/lib/constants.js";

const schema = z
  .object({
    action: z.enum(["confirm_payment", "reject_payment", "reconcile", "cancel", "retry_dispatch"]),
    /// What actually arrived. Optional: defaults to the amount requested.
    paidAmount: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const POST = route(async (req, ctx, { log }) => {
  const requestCtx = requestContext(req);
  const body = await readJson(req, { maxBytes: 8 * 1024 });

  // Staff only. This is checked BEFORE the body is trusted.
  const actor = await requireStaff(req);

  await guardMutation(req, {
    rateLimit: [bucket("admin", presets.admin, { userId: actor.id })],
    log,
  });

  const { id } = await ctx.params;
  const orderId = uuid.parse(id);
  const { action, paidAmount, reason } = parse(schema, body);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, invoice: true, status: true, total: true,
      payment: { select: { id: true, status: true, amount: true } },
    },
  });

  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND");

  log.info("dev.order_action", { orderId, action, actorId: actor.id });

  switch (action) {
    // ── Money arrived: settle, then dispatch. ─────────────────────────────
    case "confirm_payment": {
      const result = await settlePayment({
        orderId,
        paidAmount: paidAmount ?? order.payment?.amount ?? order.total,
        source: "MANUAL",
        actor,
        request: requestCtx,
      });

      return ok(
        {
          settled: result.settled,
          alreadySettled: result.alreadySettled,
          dispatch: result.dispatch,
          status: result.dispatch?.status ?? null,
        },
        { req }
      );
    }

    // ── Money never arrived. ──────────────────────────────────────────────
    case "reject_payment": {
      const result = await rejectPayment({ orderId, reason: reason ?? null, actor, request: requestCtx });
      return ok(result, { req });
    }

    // ── Ask the provider what really happened. ────────────────────────────
    // Used for a stuck PROCESSING order. Never forces a terminal state on a
    // failed lookup: an unreachable provider leaves the order alone.
    case "reconcile": {
      if (order.status !== ORDER_STATUS.PROCESSING) {
        throw new AppError(
          "ITP_INVALID_STATE_TRANSITION",
          "Rekonsiliasi hanya untuk transaksi berstatus DIPROSES."
        );
      }

      const row = await prisma.order.findUnique({
        where: { id: orderId },
        select: { providerRef: true, providerOrderId: true, provider: { select: { code: true } } },
      });

      const provider = getTopupProvider(row?.provider?.code);

      if (!provider.isConfigured()) {
        throw new AppError("ITP_PROVIDER_NOT_CONFIGURED", "Provider belum dikonfigurasi.");
      }

      const result = await provider.getOrderStatus({
        providerRef: row.providerRef,
        providerOrderId: row.providerOrderId,
        log,
      });

      if (!result.ok) {
        // Honest answer: we still do not know. The order stays PROCESSING.
        return ok(
          {
            resolved: false,
            providerStatus: null,
            message: result.error?.message ?? "Provider tidak dapat dihubungi; status belum diketahui.",
          },
          { req }
        );
      }

      const { applyProviderStatus } = await import("@/services/order.service.js");
      const applied = await applyProviderStatus({
        providerRef: row.providerRef,
        providerOrderId: row.providerOrderId,
        providerStatus: result.data?.status,
        providerMessage: result.data?.message ?? null,
        source: "MANUAL_RECONCILE",
      });

      return ok({ resolved: applied.applied, status: applied.status, providerStatus: result.data?.status }, { req });
    }

    // ── Staff cancels an unpaid order. ────────────────────────────────────
    case "cancel": {
      if (order.status !== ORDER_STATUS.PENDING_PAYMENT && order.status !== ORDER_STATUS.PAYMENT_PROCESSING) {
        throw new AppError(
          "ITP_INVALID_STATE_TRANSITION",
          "Hanya transaksi yang belum dibayar dapat dibatalkan."
        );
      }

      await transitionOrder({
        orderId,
        from: order.status,
        to: ORDER_STATUS.CANCELLED,
        reason: reason || "Dibatalkan oleh staf.",
        actor,
        request: requestCtx,
      });

      return ok({ cancelled: true }, { req });
    }

    // ── Re-send a PAID order to the provider. ─────────────────────────────
    case "retry_dispatch": {
      if (order.status !== ORDER_STATUS.PAID) {
        throw new AppError(
          "ITP_INVALID_STATE_TRANSITION",
          "Hanya transaksi berstatus DIBAYAR yang dapat dikirim ulang."
        );
      }

      const result = await dispatchOrder({ orderId, request: requestCtx });
      return ok(result, { req });
    }

    default:
      // Unreachable: the zod enum rejects anything else first.
      throw new AppError("ITP_INVALID_INPUT", "Aksi tidak dikenal.");
  }
});
