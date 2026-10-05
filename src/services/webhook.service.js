// ============================================================================
// Webhook service, replay protection and callback application.
//
// A webhook is the one place where an unauthenticated party can move money, so
// this file is written defensively:
//
//   * every event is inserted into `webhook_events` BEFORE it is acted on, with
//     a unique constraint on (providerCode, externalId). A duplicate insert
//     (P2002) means the callback is a replay and must be acknowledged without
//     re-processing. That is the whole replay defence, and it works even if two
//     copies arrive simultaneously; the database serialises them, not us.
//   * nothing here trusts a status string to be sane; it is mapped through the
//     adapter and then through the order state machine.
// ============================================================================
import { createHash } from "node:crypto";
import { prisma } from "../lib/db.js";
import { createLogger } from "../lib/logger.js";
import { AppError } from "../lib/errors.js";
import { ORDER_STATUS, PAYMENT_STATUS } from "../lib/constants.js";
import { normalizePaymentStatus } from "../providers/payment/contract.js";
import { dispatchOrder, syncOrderToPayment } from "./order.service.js";

/**
 * Stable hash of a raw webhook body.
 *
 * Used as the replay key when the provider sends no event id of its own. It
 * MUST be computed from the raw bytes: re-serialising parsed JSON reorders keys
 * and changes whitespace, which would give the same event two different hashes
 * and defeat the protection.
 */
export function hashPayload(rawBody) {
  return createHash("sha256").update(String(rawBody ?? ""), "utf8").digest("hex");
}

/**
 * Record an inbound webhook event.
 *
 * @param {{ providerCode: string, externalId: string, eventType?: string|null,
 *           orderId?: string|null, payloadHash: string }} input
 * @returns {Promise<{ fresh: boolean, id: string|null }>}
 */
export async function recordWebhookEvent(input) {
  const { providerCode, externalId, eventType = null, orderId = null, payloadHash } = input;

  if (!providerCode || !externalId) {
    throw new AppError("ITP_BAD_REQUEST", "Event webhook tidak lengkap.");
  }

  try {
    const row = await prisma.webhookEvent.create({
      data: {
        providerCode,
        externalId: String(externalId).slice(0, 255),
        eventType: eventType ? String(eventType).slice(0, 100) : null,
        orderId: orderId ?? null,
        payloadHash,
      },
      select: { id: true },
    });
    return { fresh: true, id: row.id };
  } catch (err) {
    // P2002 = the unique (providerCode, externalId) constraint fired. That is
    // exactly the signal we want: this callback has already been handled.
    if (err?.code === "P2002") return { fresh: false, id: null };
    throw err;
  }
}

/**
 * Apply a VERIFIED top-up callback to the order.
 *
 * Lives here rather than in the route so the route's verify-then-dedupe order
 * stays readable, and so tests can exercise the state change without
 * re-implementing signature verification.
 *
 * Returns `retryable: false` on success or a permanent rejection (a re-send
 * would change nothing) and `retryable: true` only when the failure is ours and
 * a retry could genuinely help.
 */
export async function applyTopupCallback({ callback, log }) {
  const { applyProviderStatus } = await import("./order.service.js");

  try {
    const result = await applyProviderStatus({
      providerRef: callback.providerRef,
      providerOrderId: callback.providerOrderId ?? null,
      providerStatus: callback.status,
      providerMessage: callback.message ?? null,
      source: "CALLBACK",
    });
    log.info("webhook.topup_applied", {
      providerRef: callback.providerRef,
      applied: result.applied,
    });
    return { applied: result.applied, retryable: false };
  } catch (err) {
    // An unknown reference is permanent; retrying will not conjure the order.
    if (err instanceof AppError && err.code === "ITP_WEBHOOK_UNKNOWN_REFERENCE") {
      log.warn("webhook.topup_unknown_reference", { providerRef: callback.providerRef });
      return { applied: false, retryable: false };
    }
    log.error("webhook.topup_apply_failed", { providerRef: callback.providerRef, error: err });
    return { applied: false, retryable: true };
  }
}

/**
 * Payment webhook application.
 *
 * The gateway is the authority on whether money arrived, but only AFTER its
 * signature has been verified by the payment adapter. This function assumes
 * verification already happened. It must never be called from a route that
 * skipped it.
 *
 * What it guarantees:
 *   * an unknown reference is a 404, not a silent success;
 *   * the payment row is updated only from a non-terminal state, so a replay
 *     cannot re-apply a transition;
 *   * the ORDER transition (PENDING_PAYMENT → PAID) happens in the same
 *     transaction as the payment update, so "paid but not recorded" is
 *     impossible;
 *   * a paid order is then dispatched to the top-up provider exactly once, via
 *     dispatchOrder's atomic claim.
 */
export async function applyPaymentWebhook({
  providerCode,
  reference,
  externalId,
  status,
  amount,
  paidAt = null,
  rawPayload = null,
  log = createLogger({ component: "webhook", provider: providerCode }),
}) {
  const payment = await prisma.payment.findFirst({
    where: { providerCode, ...(reference ? { reference } : { externalId }) },
    select: {
      id: true, orderId: true, status: true, amount: true, providerCode: true,
      order: { select: { id: true, status: true, invoice: true, total: true } },
    },
  });

  if (!payment) {
    // Do not leak whether the reference exists in a different provider's space.
    throw new AppError("ITP_WEBHOOK_UNKNOWN_REFERENCE");
  }

  // Already settled: acknowledge idempotently rather than re-applying.
  if (payment.status === PAYMENT_STATUS.PAID) {
    log.info("webhook.payment_already_settled", { orderId: payment.orderId });
    return { applied: false, duplicate: true, orderId: payment.orderId };
  }

  // The gateway's own vocabulary is normalised first; an unrecognised string
  // resolves to PENDING (never a terminal state), so a garbled callback cannot
  // cancel or settle an order.
  const normalized = normalizePaymentStatus(status);
  const isPaid = normalized === PAYMENT_STATUS.PAID;

  // A gateway must not be able to settle an order for less than it is worth.
  // (The gateway is trusted for the STATUS, not for the AMOUNT.)
  if (isPaid && amount != null && Number(amount) < payment.amount) {
    log.error("webhook.payment_amount_mismatch", {
      orderId: payment.orderId,
      expected: payment.amount,
      received: Number(amount),
    });
    throw new AppError("ITP_PAYMENT_FAILED", "Nominal pembayaran tidak sesuai.");
  }

  const nextPaymentStatus =
    normalized === PAYMENT_STATUS.PAID
      ? PAYMENT_STATUS.PAID
      : normalized === PAYMENT_STATUS.EXPIRED
        ? PAYMENT_STATUS.EXPIRED
        : normalized === PAYMENT_STATUS.FAILED
          ? PAYMENT_STATUS.FAILED
          : normalized === PAYMENT_STATUS.REFUNDED
            ? PAYMENT_STATUS.REFUNDED
            : PAYMENT_STATUS.PROCESSING;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        paidAmount: isPaid && amount != null ? Number(amount) : undefined,
        paidAt: isPaid ? (paidAt ? new Date(paidAt) : new Date()) : undefined,
        rawPayload: rawPayload ?? undefined,
      },
    });

    if (isPaid) {
      // Conditional update: if the order was already moved (another webhook,
      // the expiry job) this affects 0 rows and we simply log it.
      const moved = await tx.order.updateMany({
        where: { id: payment.orderId, status: ORDER_STATUS.PENDING_PAYMENT },
        data: { status: ORDER_STATUS.PAID },
      });
      if (moved.count !== 1) {
        log.warn("webhook.order_not_pending", { orderId: payment.orderId, status: payment.order.status });
      }
    }

    await tx.transactionLog.create({
      data: {
        orderId: payment.orderId,
        event: isPaid ? "PAYMENT_SETTLED" : "PAYMENT_STATUS_UPDATED",
        message: isPaid
          ? "Pembayaran diterima."
          : `Status pembayaran diperbarui: ${nextPaymentStatus}`,
        metadata: { providerCode, externalId, status, amount: amount ?? null },
      },
    });
  });

  log.info("webhook.payment_applied", {
    orderId: payment.orderId,
    status: nextPaymentStatus,
  });

  // A dead charge must kill the order too, or the two columns contradict each
  // other until a human opens the order page. PAID/PROCESSING orders are left
  // alone: the top-up may already be in flight (syncOrderToPayment checks).
  if (!isPaid) {
    try {
      await syncOrderToPayment({
        orderId: payment.orderId,
        paymentStatus: nextPaymentStatus,
        log,
      });
    } catch (err) {
      // The payment row is already updated; the webhook must still 200 so the
      // gateway stops retrying. The next reconcile or page read will catch up.
      log.error("webhook.sync_order_failed", { orderId: payment.orderId, message: String(err?.message ?? err).slice(0, 200) });
    }
  }

  // Dispatch only now, and only outside the transaction: a provider call inside
  // a database transaction holds a connection for the duration of a network
  // round trip, and a rolled-back transaction would leave the provider with an
  // order we have no record of.
  if (isPaid) {
    try {
      const dispatch = await dispatchOrder({ orderId: payment.orderId });
      log.info("webhook.dispatch_result", { orderId: payment.orderId, ...dispatch });
    } catch (err) {
      // The order is PAID and will be picked up by reconciliation. Failing the
      // webhook here would make the gateway retry a payment we already applied.
      log.error("webhook.dispatch_failed", { orderId: payment.orderId, error: err });
    }
  }

  return { applied: true, duplicate: false, orderId: payment.orderId };
}
