// ============================================================================
// POST /api/payment/confirm — the customer says "I have transferred".
//
// IMPORTANT: this does NOT mark the order paid. It only moves the payment to
// PROCESSING and leaves a note for the operator. A customer must never be able
// to settle their own order by asserting that they paid — that would be a
// self-service "give me a free top-up" endpoint.
//
// The money is confirmed by an operator through /api/dev/orders/[id], which
// calls `settlePayment`. Only that path sets PAID.
// ============================================================================
import { route, ok, readJson, guardMutation, requestContext, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { uuid } from "@/lib/validation.js";
import { AppError } from "@/lib/errors.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { getOrderForUser } from "@/services/order.service.js";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/constants.js";

const schema = z
  .object({
    orderId: uuid,
    /// Free-text reference from the customer's bank app (optional but useful).
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const POST = route(async (req, _ctx, { log }) => {
  const ctx = requestContext(req);
  const body = await readJson(req, { maxBytes: 4 * 1024 });

  const user = await requireAuth(req);

  await guardMutation(req, {
    rateLimit: [bucket("payment", presets.payment, { userId: user.id })],
    log,
  });

  const { orderId, note } = parse(schema, body);

  // Ownership enforced in the query, not by comparing ids afterwards.
  const order = await getOrderForUser({ orderId, userId: user.id });

  if (order.status !== ORDER_STATUS.PENDING_PAYMENT && order.status !== ORDER_STATUS.PAYMENT_PROCESSING) {
    throw new AppError("ITP_ORDER_NOT_PAYABLE");
  }

  const payment = await prisma.payment.findUnique({
    where: { orderId: order.id },
    select: { id: true, status: true },
  });

  if (!payment) {
    throw new AppError("ITP_PAYMENT_NOT_FOUND", "Buat instruksi pembayaran terlebih dahulu.");
  }

  if (payment.status === PAYMENT_STATUS.PAID) {
    return ok({ status: PAYMENT_STATUS.PAID, alreadyConfirmed: true }, { req });
  }

  // PENDING → PROCESSING only. A second tap is a no-op, not an error.
  await prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { id: payment.id, status: PAYMENT_STATUS.PENDING },
      data: { status: PAYMENT_STATUS.PROCESSING },
    });
    await tx.transactionLog.create({
      data: {
        orderId: order.id,
        event: "PAYMENT_CUSTOMER_REPORTED",
        message: note
          ? `Pelanggan menyatakan sudah transfer: ${note}`
          : "Pelanggan menyatakan sudah transfer; menunggu verifikasi operator.",
        metadata: { note: note ?? null },
      },
    });
  });

  log.info("payment.customer_reported", { orderId: order.id });

  return ok({ status: PAYMENT_STATUS.PROCESSING, awaitingVerification: true }, { req });
});
