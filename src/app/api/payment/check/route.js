// ============================================================================
// POST /api/payment/check, the customer asks "sudah dibayar belum?".
//
// WHY A SEPARATE ENDPOINT, not just a page reload
//
// The order page is a server component; it reads the payment row and renders.
// Reloading it shows the row as it was written. The gateway may know the money
// arrived while the row still says pending, this endpoint asks the gateway and
// applies the answer, so the customer sees the settlement without an operator.
//
// The webhook remains the primary channel; this is the manual fallback a
// customer reaches for when it has not fired (or, in sandbox, never fires).
//
// SECURITY: the caller must OWN the order. The id is validated, then passed to
// reconcilePayment, which looks the payment up by its own row, a body-supplied
// payment id is never trusted. Rate limited because every call hits Midtrans.
// ============================================================================
import { route, ok, readJson, guardMutation, bucket, parse } from "@/lib/api.js";
import { presets } from "@/lib/rate-limit.js";
import { requireAuth } from "@/lib/auth/guards.js";
import { AppError } from "@/lib/errors.js";
import { uuid } from "@/lib/validation.js";
import { z } from "zod";
import { prisma } from "@/lib/db.js";
import { reconcilePayment } from "@/services/payment.service.js";
import { PAYMENT_STATUS } from "@/lib/constants.js";

const schema = z.object({ orderId: uuid }).strict();

export const dynamic = "force-dynamic";

export const POST = route(async (req, _ctx, { log, rid }) => {
  const user = await requireAuth(req);

  const body = await readJson(req, { maxBytes: 8 * 1024 });
  const { orderId } = parse(schema, body);

  // Ownership is part of the QUERY. A order that is not yours is a 404, exactly
  // like a nonexistent one, no existence oracle.
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: user.id },
    select: { id: true, status: true, payment: { select: { id: true, status: true } } },
  });
  if (!order) throw new AppError("ITP_NOT_FOUND", "Transaksi tidak ditemukan.");

  // Nothing to ask the gateway about: the money already landed, or the order
  // moved past payment entirely. Answer plainly rather than charging a
  // Midtrans call for information we already hold.
  //
  // THE HALF-CREATED ORDER (the common failure): the order row was written, the
  // charge failed, and no `payment` was ever created, e.g. the bank partner
  // returned a 502 mid-checkout. The customer lands on their order page anyway
  // and the auto-poller in PaymentInstructions hits this endpoint every 45s,
  // each time returning a 404 banner ("Transaksi ini belum memiliki data
  // pembayaran.") for something they cannot fix. The order is already CANCELLED
  // in that state (see order.instructions_failed), so this is not a transient
  // blip, it loops forever. Return the order's OWN terminal state as a 200 so
  // the page stops polling, instead of an error the UI shows as a banner.
  if (!order.payment) {
    // A still-payable order with no payment row is a real anomaly; the customer
    // should be told to retry, not left in a silent "still pending" loop.
    if (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_PROCESSING") {
      throw new AppError("ITP_PAYMENT_NOT_FOUND", "Transaksi ini belum memiliki data pembayaran. Silakan buat ulang pesanan.");
    }
    return ok({
      status: "NO_PAYMENT",
      settled: false,
      terminal: true,
      message: "Instruksi pembayaran tidak pernah diterbitkan untuk transaksi ini. Silakan pesan ulang.",
    });
  }

  await guardMutation(req, {
    rateLimit: [bucket("payment", presets.payment, { userId: user.id })],
    log,
  });

  const result = await reconcilePayment({ paymentId: order.payment.id, source: "CHECK", request: { requestId: rid } });

  log.info("payment.checked", { orderId, paymentId: order.payment.id, status: result.status });

  return ok(
    {
      status: result.status,
      settled: result.settled,
      // A human-readable reason when nothing changed, usually "still pending"
      // or "gateway unreachable", shown by the page as-is.
      message: result.message,
      // The page re-reads the payment for the freshest state rather than
      // trusting this response alone, so a race between the check and the
      // webhook cannot leave the UI disagreeing with the row.
      alreadySettled: result.alreadySettled,
    },
    { req }
  );
});
