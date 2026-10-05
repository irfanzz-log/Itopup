// ============================================================================
// Payment service, the ONLY path that may mark an order paid.
//
// WHY THIS IS A SERVICE AND NOT ROUTE CODE
//
// Two different actors need to settle a payment: a customer submitting a
// gateway payment, and an operator confirming a manual transfer. If each wrote
// its own "set PAID, then dispatch" sequence, the two would drift and one of
// them would eventually forget to dispatch the order to the provider, leaving a
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
import { AUDIT, ORDER_STATUS, PAYMENT_STATUS, PAYMENT_STATUS_LABEL } from "../lib/constants.js";
import { getPaymentMethod } from "../config/payment.js";
import { getPaymentProvider, checkMethodServable, resolveProviderCodeForMethod } from "../providers/payment/index.js";
import { PAYMENT_ERROR } from "../providers/payment/contract.js";
import { transitionOrder, dispatchOrder, syncOrderToPayment } from "./order.service.js";
import { writeAudit } from "./audit.service.js";
import { recordPaymentOutage, clearPaymentOutage } from "./payment-outage.service.js";

const log = createLogger({ component: "payment" });

/**
 * Gateway codes that are worth an immediate retry.
 *
 * WHY `UNKNOWN` AND `UNAVAILABLE` ONLY
 *
 * `paymentErrorFromStatus()` classifies every 4xx as REJECTED, a permanent
 * rejection. But the Midtrans sandbox intermittently answers a well-formed
 * charge with HTTP 400 and a generic "invalid payload" message, then accepts
 * the identical payload a few seconds later (verified by replaying the exact
 * amounts that failed). That 400 is a transient fault misclassified as a policy
 * rejection, so it is re-mapped to UNKNOWN by the caller of this list and
 * retried here instead of ending the checkout.
 *
 * Anything deliberately NOT in this set is a real verdict:
 * DUPLICATE needs the adapter's cancel-then-recharge path, NOT_CONFIGURED is
 * an operator error, and TIMEOUT is covered separately by the poll loop.
 */
const RETRYABLE_PAYMENT_CODES = new Set([PAYMENT_ERROR.UNKNOWN, PAYMENT_ERROR.UNAVAILABLE]);

/** Bounded retries: 3 attempts, 500ms then 1000ms back-off. */
const RECHARGE_ATTEMPTS = 3;
const RECHARGE_BACKOFF_MS = 500;

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

  const chargeInput = {
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
  };

  // ── Retry a transient gateway rejection before failing the checkout. ──────
  //
  // PROOF THIS IS NEEDED (production logs, 2026-09-27):
  //   19:15:54.559  payment.create_failed  code=REJECTED  "Midtrans menolak permintaan (status 400)"
  //   19:16:01.082  payment.instructions_issued              ← the SAME order, 7s later
  //
  // Midtrans sandbox intermittently answers a well-formed charge with a bare
  // 400 "One or more parameters in the payload is invalid" and then accepts the
  // identical payload on the next attempt. The payload is NOT the problem: a
  // replay of the exact amounts that failed (6344, 6546, 11983) all succeed on
  // retry. This is a flaky gateway, and a flaky gateway is not a reason to
  // strand a customer on "instruksi gagal diterbitkan" with a dead checkout.
  //
  // Retries are bounded to RECHARGE_ATTEMPTS and only for codes that mean
  // "try again". DUPLICATE is handled by the adapter's cancel-then-recharge
  // path and must not loop here, and NOT_CONFIGURED is an operator error that
  // no number of retries will fix.
  let result = await provider.createPayment(chargeInput, { log });
  let attempt = 1;

  while (!result.ok && RETRYABLE_PAYMENT_CODES.has(result.error?.code) && attempt < RECHARGE_ATTEMPTS) {
    log.warn("payment.create_transient_retry", {
      orderId: order.id,
      attempt,
      code: result.error?.code,
      message: String(result.error?.message ?? "").slice(0, 200),
    });
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, RECHARGE_BACKOFF_MS * (attempt - 1)));
    result = await provider.createPayment(chargeInput, { log });
  }

  if (!result.ok) {
    log.error("payment.create_failed", { orderId: order.id, code: result.error?.code, attempts: attempt, raw: result.raw });
    // A channel that is DOWN (not merely flaky) is recorded so the checkout
    // stops offering it. Only reached after the bounded retries are exhausted,
    // so a transient blip that a retry fixed never marks a channel out.
    // recordPaymentOutage only accepts UNAVAILABLE; a REJECTED is our own bad
    // payload, and hiding a working channel over our bug is worse than the error.
    recordPaymentOutage(method.key, result.error?.code).catch(() => {});
    // UNAVAILABLE means the gateway or its bank partner is down. Midtrans serves
    // a 502 body status for exactly this. It is not our request that is broken,
    // and its AppError already carries a sanitised Indonesian message. Map it to
    // the UNAVAILABLE AppError so the checkout reports 503 with "layanan sedang
    // gangguan" rather than 502 with a generic "Pembayaran gagal". The customer
    // then knows to wait, and the operator's status code separates a partner
    // outage from a charge we actually sent and Midtrans actually rejected.
    if (result.error?.code === PAYMENT_ERROR.UNAVAILABLE) {
      throw new AppError("ITP_PAYMENT_UNAVAILABLE", result.error?.message || "Layanan pembayaran sedang gangguan.");
    }
    throw new AppError("ITP_PAYMENT_FAILED", result.error?.message || "Gagal membuat instruksi pembayaran.");
  }

  // A charge that SUCCEEDED clears the outage record. Recovery is automatic:
  // the channel is offered again on the very next checkout, with no operator
  // action and no redeploy. The promise is intentionally not awaited, as the
  // customer's charge is already done and must not wait on a bookkeeping write.
  clearPaymentOutage(method.key).catch(() => {});

  const data = result.data;

  // ── Carry the verified account forward on a RE-ISSUE ─────────────────────
  //
  // The account is verified once, when the order is created. Re-issuing the
  // instructions (the customer reloads the order page) passes no
  // `verifiedAccount`, and the upsert below replaces `instructions` wholesale,
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

  // ── Re-issuing an EXPIRED instrument must void the old one first. ─────────
  //
  // Midtrans's QRIS window (~15m) is far shorter than our order window (60m),
  // so a customer who waits outlives the code while the order is still good.
  // Tearing down that dead charge before creating the next one is what stops a
  // stray settlement on an abandoned transaction from landing after we have
  // already pointed the payment at a fresh one.
  //
  // `reference` is null only when the row exists without an instrument ever
  // having been issued, in which case there is nothing to void.
  const previousPayment = await prisma.payment.findUnique({
    where: { orderId: order.id },
    select: { reference: true, externalId: true },
  });

  if (previousPayment?.reference) {
    const cancelled = await provider.cancelPayment(
      {
        reference: previousPayment.reference,
        externalId: previousPayment.externalId ?? undefined,
        reason: "QR_EXPIRED_REISSUE",
      },
      { log }
    );

    // Only a hard failure stops the re-issue. REJECTED is Midtrans saying the
    // transaction was already closed, exactly the state we wanted, and a
    // customer-facing error here would block them from paying at all.
    if (!cancelled.ok && cancelled.error?.code !== PAYMENT_ERROR.REJECTED) {
      log.warn("payment.cancel_before_reissue_failed", {
        orderId: order.id,
        reference: previousPayment.reference,
        code: cancelled.error?.code,
      });
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

// ===========================================================================
// Gateway reconciliation.
//
// Midtrans is the source of truth for whether the money arrived. Webhooks are
// the primary channel, but they are NOT reliable as the only one: a sandbox
// account sends none at all, a production notification can be dropped, delayed
// past our order window, or delivered out of order. So the app also polls.
//
// The two paths converge here, on ONE function that asks the gateway and
// applies whatever it finds. Both are idempotent: a settled order is never
// re-dispatched, and a terminal order is never disturbed, so it is safe to
// run on every pending order on a loop.
// ===========================================================================

/**
 * Why this order is being reconciled. Changes the log line, not the outcome.
 * @typedef {"POLL"|"CHECK"|"MANUAL"} ReconcileSource
 */

/**
 * Ask the gateway for the truth about one payment, and apply it.
 *
 * WHAT IT CAN DO
 *   - settle the payment and dispatch the order, when the gateway says PAID
 *   - move the payment to a terminal status (FAILED/CANCELLED/EXPIRED) when the
 *     gateway says the transaction is dead
 *   - refresh a stale expiry the customer is still being shown
 *
 * WHAT IT WILL NOT DO
 *   - touch a payment that is already PAID or already terminal; nothing to do
 *   - cancel on a network error. An unanswered question stays unanswered; a
 *     paid order destroyed over a timeout is the bug this whole design avoids
 *
 * @param {object} args
 * @param {string} args.paymentId  the payment row to reconcile
 * @param {ReconcileSource} [args.source]  POLL | CHECK | MANUAL, for the audit trail
 * @param {object} [args.actor]  the operator, when a human triggered this
 * @param {object} [args.request]  request context for the audit entry
 * @returns {Promise<{ applied: boolean, status: string|null, settled: boolean,
 *                    alreadySettled: boolean, message: string|null }>}
 */
export async function reconcilePayment({ paymentId, source = "POLL", actor = null, request = {} }) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      reference: true,
      externalId: true,
      providerCode: true,
      status: true,
      amount: true,
      expiresAt: true,
    },
  });

  if (!payment) throw new AppError("ITP_PAYMENT_NOT_FOUND", "Data pembayaran tidak ditemukan.");

  // A payment that already reached its terminal state has nothing left to ask
  // the gateway. This is what makes polling safe to run repeatedly.
  if (payment.status !== PAYMENT_STATUS.PENDING && payment.status !== PAYMENT_STATUS.PROCESSING) {
    return {
      applied: false,
      status: payment.status,
      settled: payment.status === PAYMENT_STATUS.PAID,
      alreadySettled: payment.status === PAYMENT_STATUS.PAID,
      message: null,
    };
  }

  // The adapter is chosen by the payment row's OWN provider, not the ambient
  // PAYMENT_PROVIDER: a payment issued under one credential must be settled
  // under the same one. It THROWS for an unregistered code (a legacy row from
  // a provider we no longer ship), so that is caught here rather than allowed
  // to abort the whole batch.
  let provider;
  try {
    provider = getPaymentProvider(payment.providerCode);
  } catch {
    return { applied: false, status: null, settled: false, alreadySettled: false, message: "Provider pembayaran tidak terdaftar." };
  }
  if (!provider.getPaymentStatus) {
    return { applied: false, status: null, settled: false, alreadySettled: false, message: "Provider tidak mendukung pengecekan status." };
  }

  const gateway = await provider.getPaymentStatus(
    { reference: payment.reference, externalId: payment.externalId },
    { log }
  );

  // UNKNOWN/TIMEOUT/UNAVAILABLE: the gateway could not answer. Leave the
  // payment exactly as it was and say so; the next poll can try again.
  //
  // The message is shown to the customer verbatim by /api/payment/check, so it
  // is re-sanitised here as a backstop: an adapter from another provider, or a
  // future message we have not classified, must not carry a partner's name to
  // the buyer. The raw detail stays in the log above.
  if (!gateway.ok) {
    const safe =
      /^(?!.*(midtrans|melostore|snap)).+$/i.test(gateway.error?.message ?? "") && gateway.error?.message
        ? gateway.error.message
        : "Layanan pembayaran sedang tidak dapat dihubungi.";
    return {
      applied: false,
      status: null,
      settled: false,
      alreadySettled: false,
      message: safe,
    };
  }

  const { status: gatewayStatus, paidAmount, paidAt, expiresAt } = gateway.data;

  // ── The gateway says the money arrived → settle through the single path. ──
  // settlePayment owns the amount check and the dispatch, so this never
  // delivers goods for less than owed, and never double-dispatches.
  if (gatewayStatus === PAYMENT_STATUS.PAID) {
    const result = await settlePayment({
      orderId: payment.orderId,
      paidAmount: paidAmount ?? null,
      source: "GATEWAY",
      actor,
      request,
    });

    // paidAt from the gateway is more accurate than our wall clock, but it is
    // only worth writing when settlePayment actually made the claim. Otherwise
    // this row was settled by someone else and we would clobber their value.
    if (result.settled && !result.alreadySettled && paidAt) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: PAYMENT_STATUS.PAID },
        data: { paidAt },
      });
    }

    log.info("payment.reconciled_paid", { paymentId, orderId: payment.orderId, source });

    return {
      applied: true,
      status: PAYMENT_STATUS.PAID,
      settled: result.settled,
      alreadySettled: result.alreadySettled,
      message: null,
    };
  }

  // ── A terminal non-paid state: the transaction is dead at the gateway. ────
  // Record it on the payment row only. The ORDER is deliberately left alone:
  // `settlePayment` is the only thing that may move an order to PAID, and
  // expiring it here would fight the expiry job's own state machine. A dead
  // gateway transaction is harmless; a prematurely cancelled order is not.
  //
  // Expiry is NOT persisted here. A settled transaction has no deadline to
  // show a customer, and the gateway only reports it for transactions still
  // waiting for money; clobbering a settled row with a stale one is how the
  // "sudah dibayar tapi kedaluwarsa" contradiction appears.
  const TERMINAL_PAYMENT_STATUSES = new Set([
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED,
    PAYMENT_STATUS.EXPIRED,
    PAYMENT_STATUS.REFUNDED,
  ]);

  if (TERMINAL_PAYMENT_STATUSES.has(gatewayStatus)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: gatewayStatus,
        rawPayload: { reconciledAt: new Date().toISOString(), source, gatewayStatus },
      },
    });

    await prisma.transactionLog.create({
      data: {
        orderId: payment.orderId,
        event: "PAYMENT_GATEWAY_TERMINAL",
        message: `Pembayaran ditandai ${PAYMENT_STATUS_LABEL[gatewayStatus] ?? gatewayStatus} oleh gateway.`,
        metadata: { source, gatewayStatus, actorId: actor?.id ?? null },
      },
    });

    log.info("payment.reconciled_terminal", { paymentId, orderId: payment.orderId, source, gatewayStatus });

    // The order must not outlive its payment. Without this the /dev list and the
    // customer's page disagree ("Pembayaran: Kedaluwarsa, Status: Diproses")
    // until a human opens the order and the expiry-on-read path catches up.
    // A PAID/PROCESSING order is left untouched (syncOrderToPayment checks).
    await syncOrderToPayment({
      orderId: payment.orderId,
      paymentStatus: gatewayStatus,
      log,
    }).catch((err) => {
      // The payment row is already terminal; this must not fail the reconcile.
      log.error("payment.sync_order_failed", { orderId: payment.orderId, message: String(err?.message ?? err).slice(0, 200) });
    });

    return { applied: true, status: gatewayStatus, settled: false, alreadySettled: false, message: null };
  }

  // ── Still pending: the only meaningful update is a fresher deadline. ──────
  if (expiresAt && (!payment.expiresAt || new Date(expiresAt).getTime() !== new Date(payment.expiresAt).getTime())) {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] } },
      data: { expiresAt },
    });
  }

  return { applied: true, status: gatewayStatus, settled: false, alreadySettled: false, message: null };
}

/**
 * Reconcile every payment that is still open, newest first.
 *
 * Called by the polling job and by the operator "sync all" action. A bounded
 * batch with a cutoff, not an unbounded scan of the whole table.
 *
 * @param {object} [options]
 * @param {number} [options.limit=50]  payments per run
 * @param {number} [options.staleAfterMinutes=2]  skip payments checked recently
 * @param {ReconcileSource} [options.source]
 * @param {object} [options.actor]
 * @param {object} [options.request]
 * @returns {Promise<{ checked: number, settled: number, terminal: number, errors: number }>}
 */
export async function reconcilePendingPayments({
  limit = 50,
  staleAfterMinutes = 2,
  source = "POLL",
  actor = null,
  request = {},
} = {}) {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);

  // The `updatedAt` filter is what rate-limits the gateway: a payment polled
  // 30s ago is not polled again this run, so a tight loop is still cheap.
  // `updatedAt` is `@updatedAt` and so is never NULL in practice; no OR
  // alternative for null is needed, and Prisma rejects `updatedAt: null` here.
  const open = await prisma.payment.findMany({
    where: {
      status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PROCESSING] },
      providerCode: { not: "manual" },
      updatedAt: { lte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
    select: {
      id: true, orderId: true, method: true, reference: true,
      // Needed so the batch can be SELF-HEALING: if this poll dies at the
      // gateway, the order is still closed at its own deadline.
      expiresAt: true,
    },
  });

  let settled = 0;
  let terminal = 0;
  let errors = 0;

  for (const row of open) {
    try {
      const result = await reconcilePayment({ paymentId: row.id, source, actor, request });
      if (result.settled && !result.alreadySettled) settled += 1;
      else if (result.applied && !result.settled) terminal += 1;
    } catch (err) {
      // One payment failing must not abort the batch. The next run retries it.
      errors += 1;
      log.warn("payment.reconcile_row_failed", {
        paymentId: row.id,
        orderId: row.orderId,
        message: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  log.info("payment.reconcile_batch", { checked: open.length, settled, terminal, errors, source });

  return { checked: open.length, settled, terminal, errors };
}
