// ============================================================================
// POST /api/webhooks/payment/midtrans, Midtrans payment notification.
//
// THE ORDER OF OPERATIONS IS THE SECURITY CONTROL:
//   1. read the RAW body (the signature covers the exact bytes Midtrans sent),
//   2. verify SHA512(order_id + status_code + gross_amount + server_key),
//   3. dedupe on the Midtrans event id,
//   4. only then touch a payment.
//
// A webhook parsed before it is verified is a spoofing vector: anyone who
// learns the URL can POST {"transaction_status":"settlement"} and have top-up
// credit released. Signature first, always.
//
// NOT session-guarded and NOT CSRF-guarded, machine-to-machine. The signature
// is the authentication. It fails closed: a genuine notification that fails
// verification is recoverable via reconciliation; a forged one that passes is
// not.
//
// Midtrans retries notifications that do not get 2xx, so a 200 for an event we
// chose not to act on is correct, and a 5xx is reserved for failures where a
// retry genuinely could help.
// ============================================================================
import { NextResponse } from "next/server";
import { route, ok } from "@/lib/api.js";
import { AppError } from "@/lib/errors.js";
import { clientIp, enforce, presets } from "@/lib/rate-limit.js";
import { getPaymentProvider } from "@/providers/payment/index.js";
import { PAYMENT_ERROR } from "@/providers/payment/contract.js";
import { PAYMENT_STATUS } from "@/lib/constants.js";
import { recordWebhookEvent, hashPayload } from "@/services/webhook.service.js";
import { prisma } from "@/lib/db.js";

export const dynamic = "force-dynamic";

/** A Midtrans notification is small. A 1 MB one is an attack, not a callback. */
const MAX_CALLBACK_BYTES = 64 * 1024;

export const POST = route(async (req, _ctx, { log, rid }) => {
  const ip = clientIp(req);

  // Flood protection only, the signature is the real authentication. Fails
  // open, because dropping a provider retry loses money.
  await enforce([["webhook:payment", presets.webhook]]);

  const raw = await readRawBody(req);

  // ── 1. Resolve the adapter, then verify. ────────────────────────────────
  // The provider is chosen by the PAYMENT_PROVIDER env, so a Midtrans
  // notification arriving while the app is not configured for Midtrans is
  // rejected outright.
  const provider = getPaymentProvider("midtrans");

  const verified = await provider.verifyWebhook({ headers: req.headers, rawBody: raw, log });

  if (!verified.ok) {
    // INVALID_SIGNATURE → 401: Midtrans should not retry a forged payload.
    // NOT_CONFIGURED → 503: a retry later is the right response.
    const status = verified.error?.code === PAYMENT_ERROR.NOT_CONFIGURED ? 503 : 401;
    log.warn("midtrans.webhook_rejected", {
      code: verified.error?.code,
      ip,
      requestId: rid,
    });
    return NextResponse.json(
      { success: false, error: { code: "ITP_WEBHOOK_INVALID_SIGNATURE" }, requestId: rid },
      { status }
    );
  }

  const event = verified.data;

  // ── 2. Replay protection, BEFORE any state change. ──────────────────────
  // The (providerCode, externalId) unique constraint is the whole defence: two
  // copies of one notification cannot both settle an order, because the
  // database serialises them.
  const recorded = await recordWebhookEvent({
    providerCode: provider.code,
    externalId: event.eventId,
    eventType: `payment:${String(event.status).toLowerCase()}`,
    orderId: null,
    payloadHash: hashPayload(raw),
  });
  if (!recorded.fresh) {
    log.info("midtrans.webhook_replay", { externalId: event.eventId });
    return ok({ received: true, duplicate: true });
  }

  // ── 3. Apply the status to the payment. ─────────────────────────────────
  // A PAID notification settles the order through settlePayment, which owns
  // the amount check and the dispatch to the top-up provider. Everything else
  // is a status update on the Payment row, terminal failures must not leave
  // the order looking payable.
  const outcome = await applyPaymentNotification({ event, raw, log });

  // 200 for an understood event (even one we ignored); 500 only when a retry
  // could change the result.
  return ok({ received: true, ...outcome });
});

/**
 * Map a verified notification onto the payment and the order.
 *
 * @returns {Promise<{ applied: boolean, retryable: boolean }>}
 */
async function applyPaymentNotification({ event, raw, log }) {
  // The payment is looked up by Midtrans's reference, which is OUR invoice,
  // never by an id from the body. This is the IDOR boundary for webhooks.
  //
  // `reference` alone is NOT a unique column: the constraint is
  // @@unique([providerCode, reference]), because a manual payment and a
  // Midtrans charge can share one invoice reference. Looking it up by
  // `reference` alone raised PrismaClientValidationError at runtime (the
  // compound is the only key on those two fields), and a `findFirst` would
  // have been worse, it could settle the wrong provider's payment. The
  // compound lookup is what makes this resolve to exactly one row.
  const payment = await prisma.payment.findUnique({
    where: { providerCode_reference: { providerCode: "midtrans", reference: event.reference } },
    select: {
      id: true,
      orderId: true,
      status: true,
      amount: true,
      method: true,
      providerCode: true,
    },
  });

  if (!payment) {
    // A notification for an order we have no record of. Log it and ack, a
    // retry will not create the order, and 200 stops Midtrans from looping.
    log.warn("midtrans.webhook_unknown_payment", { reference: event.reference });
    return { applied: false, retryable: false };
  }

  // A provider mismatch means the notification is for a payment this app no
  // longer attributes to Midtrans. Refusing here prevents a stale credential
  // from settling an order that moved providers.
  if (payment.providerCode !== "midtrans") {
    log.warn("midtrans.webhook_provider_mismatch", {
      reference: event.reference,
      providerCode: payment.providerCode,
    });
    return { applied: false, retryable: false };
  }

  // Non-paid statuses are recorded on the payment row only. The order stays in
  // its current state: an EXPIRED notification on an order that a human already
  // marked paid is logged, not applied.
  if (event.status !== PAYMENT_STATUS.PAID) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: event.status,
        rawPayload: { notification: safeJson(raw), status: event.status },
      },
    });
    log.info("midtrans.webhook_status_update", {
      reference: event.reference,
      status: event.status,
    });
    return { applied: true, retryable: false };
  }

  // ── PAID: settle through the single path that may dispatch the order. ──
  // settlePayment re-checks the amount and the state machine, so a notification
  // claiming settlement for a smaller amount than owed does not deliver goods.
  const { settlePayment } = await import("@/services/payment.server.js");

  try {
    const result = await settlePayment({
      orderId: payment.orderId,
      paidAmount: event.paidAmount,
      source: "GATEWAY",
      actor: null,
      request: null,
    });

    if (!result.settled) {
      log.warn("midtrans.webhook_not_settled", {
        reference: event.reference,
        orderId: payment.orderId,
      });
      // A non-settlement here is usually a state mismatch (order already
      // cancelled/expired). Retrying will not change that.
      return { applied: false, retryable: false };
    }

    log.info("midtrans.webhook_settled", {
      reference: event.reference,
      orderId: payment.orderId,
      alreadySettled: result.alreadySettled,
    });
    return { applied: true, retryable: false };
  } catch (err) {
    // A DB or dispatch failure is ours, Midtrans SHOULD retry.
    log.error("midtrans.webhook_settle_failed", {
      reference: event.reference,
      orderId: payment.orderId,
      message: String(err?.message ?? err).slice(0, 300),
    });
    return { applied: false, retryable: true };
  }
}

/** Read the body as a string, enforcing the size ceiling. */
async function readRawBody(req) {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared && declared > MAX_CALLBACK_BYTES) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CALLBACK_BYTES) {
    throw new AppError("ITP_PAYLOAD_TOO_LARGE");
  }
  return text;
}

/** Parse a raw body for storage, tolerating invalid JSON. */
function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
