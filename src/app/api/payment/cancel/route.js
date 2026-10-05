// ============================================================================
// POST /api/payment/cancel, the customer gives up on an order they have not
// paid for.
//
// WHY THE CUSTOMER CAN DO THIS AT ALL
//
// Kedaluwarsa (EXPIRED) and Dibatalkan (CANCELLED) are two different deaths,
// and the customer is the one who knows which one this is. The expiry sweep
// fires on the clock, the customer walked away. This endpoint fires on a
// person, the customer changed their mind, and told us so. Recording that
// distinction is what keeps "why did this order die" answerable, and it is what
// the operator's breakdown ("Kedaluwarsa (otomatis)" vs "Dibatalkan") shows.
//
// The customer also has a reason the clock does not: they may want to reorder
// with a different method, or they may have paid OUSIDE this QR and need the
// dead instrument killed so it cannot be settled into later.
//
// WHAT IT DOES
//
//   1. Cancels the charge at Midtrans, so the VA/QR cannot be paid into after
//      the customer has already left. Without this a stray settlement lands on
//      a transaction the customer believes is dead.
//   2. Transitions the order to CANCELLED with the customer as the actor, so
//      the audit trail says who did it.
//
// SECURITY: the caller must OWN the order. The id is validated and the userId
// filter is part of the query, an order that is not yours is a 404, identical
// to a nonexistent one, so the endpoint is not an existence oracle and cannot
// be used to probe for other customers' order ids.
//
// IDEMPOTENCY: if the order is already terminal, this is a 409, not an error
// the customer should ever see as a failure, the UI hides the button for a
// closed order, and a race against the expiry sweep is the only way to reach
// it.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { getPaymentProvider } from "@/providers/payment/index.js";
import { PAYMENT_ERROR } from "@/providers/payment/contract.js";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/constants.js";
import { transitionOrder } from "@/services/order.service.js";

const schema = z
  .object({
    orderId: uuid,
    // Free text, capped: goes into the transaction log and audit metadata.
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export const POST = route(async (req, _ctx, { log, rid }) => {
  const user = await requireAuth(req);

  await guardMutation(req, {
    // Shares the payment bucket with /api/payment/check: both hit Midtrans, and
    // a cancel is a single call per order, so it does not need its own quota.
    rateLimit: [bucket("payment", presets.payment, { userId: user.id })],
    log,
  });

  const body = await readJson(req, { maxBytes: 8 * 1024 });
  const { orderId, reason } = parse(schema, body);

  // Ownership in the query, not after the fetch.
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: {
      id: true,
      status: true,
      payment: { select: { id: true, status: true, reference: true, externalId: true, providerCode: true } },
    },
  });
  if (!order) throw new AppError("ITP_NOT_FOUND", "Transaksi tidak ditemukan.");

  // Only an order that is still waiting on the customer's money can be
  // cancelled by the customer. Anything past that is out of their hands,
  // PAID means we have their money, PROCESSING means the provider is working.
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    throw new AppError(
      "ITP_ORDER_NOT_CANCELLABLE",
      order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.EXPIRED
        ? "Transaksi ini sudah berakhir."
        : "Transaksi yang sudah dibayar tidak dapat dibatalkan dari sini."
    );
  }

  // Void the charge at the gateway FIRST, then move our row. Ordering matters:
  // a gateway that is still payable is a liability, and our own row moving to
  // CANCELLED first would not stop Midtrans from accepting a transfer the
  // customer did not mean to make.
  const payment = order.payment;
  if (payment?.reference && payment.providerCode) {
    const provider = getPaymentProvider(payment.providerCode);
    if (provider?.cancelPayment) {
      const cancelled = await provider.cancelPayment(
        {
          reference: payment.reference,
          externalId: payment.externalId ?? undefined,
          reason: "CUSTOMER_CANCELLED",
        },
        { log }
      );

      // The provider returns paymentOk when the transaction was already closed
      // (Midtrans 412). Only a real failure here should stop the cancel,
      // PAYMENT_ERROR codes are plain strings, and codes outside that enum are
      // provider-specific, so compare loosely and fall through on anything
      // unexpected.
      if (!cancelled.ok && cancelled.error?.code !== PAYMENT_ERROR.REJECTED) {
        log.warn("payment.customer_cancel_failed", {
          orderId: order.id,
          reference: payment.reference,
          code: cancelled.error?.code,
        });
        throw new AppError(
          "ITP_GATEWAY_CANCEL_FAILED",
          "Tidak bisa membatalkan pembayaran di gateway. Coba beberapa saat lagi."
        );
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PAYMENT_STATUS.CANCELLED },
      });
    }
  }

  const requestCtx = requestContext(req);

  await transitionOrder({
    orderId: order.id,
    from: order.status,
    to: ORDER_STATUS.CANCELLED,
    // A reason the customer gave is worth keeping verbatim; the fallback says
    // it was their action, which is the part the audit trail needs.
    reason: reason || "Dibatalkan oleh customer.",
    // The customer is the actor, so this is recorded as their action rather
    // than an operator's.
    actor: { ...user, role: "MEMBER" },
    request: requestCtx,
    metadata: { cancelledBy: "customer" },
  });

  log.info("payment.customer_cancelled", { orderId: order.id, rid });

  return ok({ cancelled: true, status: ORDER_STATUS.CANCELLED }, { req });
});
