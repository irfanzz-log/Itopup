// ============================================================================
// Payment service — the ONLY path that may mark an order paid.
//
// WHY THIS IS A SERVICE AND NOT ROUTE CODE
//
// Two different actors need to settle a payment: a customer submitting a
// gateway payment, and an operator confirming a manual transfer. If each wrote
// its own "set PAID, then dispatch" sequence, the two would drift and one of
// them would eventually forget to dispatch the order to the provider — leaving a
// paid customer with no top-up. Both paths funnel through `settlePayment` here.
//
// ORDER OF OPERATIONS IS THE SECURITY CONTROL:
//   1. the payment must belong to the order (never trust a body-supplied id),
//   2. the amount must be >= what is owed,
//   3. the state machine must allow the transition,
//   4. only THEN is the order dispatched.
//
// Idempotent by construction: a replayed settlement finds the payment already
// PAID and returns without dispatching twice.
// ============================================================================
import { prisma } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { AUDIT, ORDER_STATUS, PAYMENT_STATUS } from "../lib/constants.js";
import { getPaymentMethod } from "../config/payment.js";
import { getPaymentProvider, checkMethodServable, resolveProviderCodeForMethod } from "../providers/payment/index.js";
import { transitionOrder, dispatchOrder } from "./order.service.js";
import { writeAudit } from "./audit.service.js";

const log = createLogger({ component: "payment" });

/**
 * Issue (or re-issue) payment instructions for an order.
 *
 * Re-issuing is safe: the manual adapter derives its unique amount code from the
 * invoice, so a customer who reloads the page sees the SAME amount. A payment
 * row is reused rather than recreated, because a second row would make two
 * things claim to be the payment for one order.
 *
 * @returns {Promise<{ payment: object, instructions: object|null }>}
 */
export async function issuePaymentInstructions({ order, paymentMethod, request = {}, verifiedAccount = null }) {
  const method = getPaymentMethod(paymentMethod);
  if (!method) throw new AppError("ITP_PAYMENT_UNAVAILABLE", "Metode pembayaran tidak dikenal.");

  // The method must be both enabled in config AND served by a configured
  // adapter. Checking only `enabled` is how a customer reaches a checkout that
  // cannot produce instructions.
  const servable = checkMethodServable(method.key);
  if (!servable.ok) {
    throw new AppError("ITP_PAYMENT_UNAVAILABLE", servable.reason);
  }

  if (order.status !== ORDER_STATUS.PENDING_PAYMENT && order.status !== ORDER_STATUS.PAYMENT_PROCESSING) {
    throw new AppError("ITP_ORDER_NOT_PAYABLE");
  }

  const provider = getPaymentProvider(servable.providerCode);

  const result = await provider.createPayment({
    orderId: order.id,
    invoice: order.invoice,
    amount: order.total,
    fee: order.fee ?? 0,
    method: method.key,
    description: `Top up ${order.gameName} - ${order.invoice}`,
    customerName: order.user?.name ?? undefined,
    customerEmail: order.user?.email ?? undefined,
    expiresAt: order.expiresAt ?? null,
    verifiedAccount,
    log,
  });

  if (!result.ok) {
    log.error("payment.create_failed", { orderId: order.id, code: result.error?.code });
    throw new AppError("ITP_PAYMENT_FAILED", result.error?.message || "Gagal membuat instruksi pembayaran.");
  }

  const data = result.data;

  // ── Carry the verified account forward on a RE-ISSUE ─────────────────────
  //
  // The account is verified once, when the order is created. Re-issuing the
  // instructions (the customer reloads the order page) passes no
  // `verifiedAccount`, and the upsert below replaces `instructions` wholesale —
  // which would erase the account name the customer is supposed to check against.
  // So the stored value is merged back in rather than overwritten with nothing.
  let instructions = data.instructions ?? null;
  if (instructions && !instructions.verifiedAccount) {
    const existing = await prisma.payment.findUnique({
      where: { orderId: order.id },
      select: { instructions: true },
    });
    const previous = existing?.instructions;
    if (previous && typeof previous === "object" && previous.verifiedAccount) {
      instructions = { ...instructions, verifiedAccount: previous.verifiedAccount };
    }
  }

  const payment = await prisma.payment.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      providerCode: provider.code,
      status: PAYMENT_STATUS.PENDING,
      method: method.key,
      reference: data.reference,
      externalId: data.externalId ?? null,
      amount: data.amount,
      fee: order.fee ?? 0,
      instructions,
      expiresAt: data.expiresAt ?? null,
    },
    update: {
      providerCode: provider.code,
      method: method.key,
      reference: data.reference,
      externalId: data.externalId ?? null,
      amount: data.amount,
      instructions,
      expiresAt: data.expiresAt ?? null,
    },
    select: {
      id: true, orderId: true, status: true, method: true, reference: true,
      amount: true, fee: true, instructions: true, expiresAt: true, paidAt: true,
    },
  });

  await writeAudit({
    action: AUDIT.ORDER_STATUS_CHANGED,
    actor: null,
    targetType: "Payment",
    targetId: payment.id,
    metadata: { orderId: order.id, method: method.key, provider: provider.code, event: "PAYMENT_INSTRUCTIONS_ISSUED" },
    request,
  });

  log.info("payment.instructions_issued", { orderId: order.id, method: method.key, provider: provider.code });

  return { payment, instructions };
}

/**
 * Settle a payment and hand the order to the provider.
 *
 * @param {object} args
 * @param {string} args.orderId
 * @param {number} [args.paidAmount]  what actually arrived; must cover the order
 * @param {"GATEWAY"|"MANUAL"} [args.source]
 * @param {object|null} [args.actor]  the operator, for a manual confirmation
 * @param {object} [args.request]
 * @returns {Promise<{ settled: boolean, alreadySettled: boolean, dispatch: object|null }>}
 */
export async function settlePayment({
  orderId,
  paidAmount = null,
  source = "MANUAL",
  actor = null,
  request = {},
}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, invoice: true, status: true, total: true,
      payment: { select: { id: true, status: true, amount: true, paidAmount: true, method: true } },
    },
  });

  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND");
  if (!order.payment) throw new AppError("ITP_PAYMENT_NOT_FOUND", "Transaksi ini belum memiliki data pembayaran.");

  // ── Already settled: return the existing outcome, never re-dispatch. ──────
  if (order.payment.status === PAYMENT_STATUS.PAID) {
    log.info("payment.settle_replay", { orderId, paymentId: order.payment.id });
    return { settled: true, alreadySettled: true, dispatch: null };
  }

  // ── Underpayment must be refused, not rounded up. ─────────────────────────
  const expected = order.payment.amount ?? order.total;
  const received = paidAmount ?? expected;

  if (Number(received) < Number(expected)) {
    throw new AppError(
      "ITP_PAYMENT_AMOUNT_MISMATCH",
      `Nominal pembayaran kurang: diterima ${Number(received).toLocaleString("id-ID")}, seharusnya ${Number(expected).toLocaleString("id-ID")}.`
    );
  }

  const now = new Date();

  // Claim the payment atomically. `updateMany` with `status: PENDING` is what
  // makes two concurrent confirmations unable to both proceed.
  const claimed = await prisma.payment.updateMany({
    where: { id: order.payment.id, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] } },
    data: {
      status: PAYMENT_STATUS.PAID,
      paidAmount: Number(received),
      paidAt: now,
      rawPayload: { source, confirmedBy: actor?.id ?? null },
    },
  });

  if (claimed.count !== 1) {
    // Someone else settled it between our read and write.
    log.warn("payment.settle_lost_race", { orderId });
    return { settled: true, alreadySettled: true, dispatch: null };
  }

  await prisma.transactionLog.create({
    data: {
      orderId,
      event: "PAYMENT_PAID",
      message: source === "MANUAL" ? "Pembayaran dikonfirmasi manual oleh operator." : "Pembayaran dikonfirmasi.",
      metadata: { source, paidAmount: Number(received), expected, actorId: actor?.id ?? null },
    },
  });

  // ── Move the order to PAID through the state machine, not by writing. ─────
  await transitionOrder({
    orderId,
    from: order.status,
    to: ORDER_STATUS.PAID,
    reason: source === "MANUAL" ? "Pembayaran dikonfirmasi manual." : "Pembayaran diterima.",
    actor,
    request,
  });

  if (actor) {
    await writeAudit({
      action: AUDIT.ORDER_STATUS_CHANGED,
      actor,
      targetType: "Order",
      targetId: orderId,
      metadata: { event: "PAYMENT_CONFIRMED_MANUAL", source, paidAmount: Number(received) },
      request,
    });
  }

  // ── Dispatch LAST. A dispatch failure must not undo a settled payment. ────
  let dispatch = null;
  try {
    dispatch = await dispatchOrder({ orderId, request });
  } catch (err) {
    // The money is real and the order is PAID; the provider call is retryable
    // through reconciliation. Never roll the payment back over this.
    log.error("payment.dispatch_after_settle_failed", { orderId, error: err });
  }

  log.info("payment.settled", { orderId, source, paidAmount: Number(received) });

  return { settled: true, alreadySettled: false, dispatch };
}

/**
 * Mark a payment failed/cancelled and release the order back to a terminal
 * unpaid state. Used by an operator rejecting a transfer that never arrived.
 */
export async function rejectPayment({ orderId, reason = null, actor = null, request = {} }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, payment: { select: { id: true, status: true } } },
  });

  if (!order) throw new AppError("ITP_ORDER_NOT_FOUND");
  if (!order.payment) throw new AppError("ITP_PAYMENT_NOT_FOUND", "Transaksi ini belum memiliki data pembayaran.");

  if (order.payment.status === PAYMENT_STATUS.PAID) {
    throw new AppError("ITP_PAYMENT_ALREADY_PAID", "Pembayaran sudah lunas dan tidak dapat ditolak.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: order.payment.id },
      data: { status: PAYMENT_STATUS.FAILED },
    });
    await tx.transactionLog.create({
      data: {
        orderId,
        event: "PAYMENT_REJECTED",
        message: reason || "Pembayaran ditolak oleh operator.",
        metadata: { actorId: actor?.id ?? null },
      },
    });
  });

  if (actor) {
    await writeAudit({
      action: AUDIT.ORDER_STATUS_CHANGED,
      actor,
      targetType: "Order",
      targetId: orderId,
      metadata: { event: "PAYMENT_REJECTED", reason },
      request,
    });
  }

  log.info("payment.rejected", { orderId });

  return { rejected: true };
}

/** Payment + order state for the member order page. Never leaks provider payloads. */
export async function getPaymentForOrder(orderId) {
  return prisma.payment.findUnique({
    where: { orderId },
    select: {
      id: true, status: true, method: true, reference: true, amount: true,
      fee: true, paidAmount: true, instructions: true, expiresAt: true, paidAt: true,
      providerCode: true,
    },
  });
}

export { resolveProviderCodeForMethod };
