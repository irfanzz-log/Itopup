// ============================================================================
// Midtrans → internal status mapping.
//
// WHY THIS FILE IS PURE
//
// A status string from a gateway is the one place an unauthenticated party can
// try to move money (a spoofed webhook carrying "settlement"). Mapping lives in
// a pure module with no I/O so it can be unit-tested exhaustively — the mapper
// IS the security boundary between "what Midtrans said" and "what we do".
//
// Midtrans transaction_status values (from their notification docs):
//   capture        — card captured, awaiting settlement
//   settlement     — money arrived, goods may be released
//   pending        — VA/QR issued, customer has not paid yet
//   authorize      — pre-auth hold (we do not use this flow)
//   cancel         — merchant or customer cancelled
//   deny           — fraud filter rejected
//   expire         — window elapsed unpaid
//   failure        — settlement failed after capture
//   refund / partial_refund — money returned
//
// Settlement is the only status that marks an order paid. `capture` is NOT
// treated as paid here: it means the charge succeeded but funds have not
// settled, and releasing top-up credit on capture is how a refund ends up
// owing the customer money. It maps to PROCESSING, and the webhook for
// settlement is what flips the order.
// ============================================================================
import { PAYMENT_STATUS } from "@/lib/constants.js";

/**
 * Map a Midtrans transaction_status (plus optional fraud_status) to our own.
 *
 * @param {string} status
 * @param {{ fraudStatus?: string|null }} [extra]
 * @returns {{ status: string, terminal: boolean }}
 *   `terminal` marks states that cannot change again, so the caller stops
 *   polling. Not every non-terminal status is "good" — pending is non-terminal
 *   and perfectly fine.
 */
export function normalizeMidtransStatus(status, { fraudStatus = null } = {}) {
  const raw = String(status ?? "").trim().toLowerCase();

  // Fraud denial overrides the transaction status: Midtrans can report
  // `capture` while fraud_status is `deny`, and shipping that is a chargeback.
  if (fraudStatus === "deny") return { status: PAYMENT_STATUS.FAILED, terminal: true };

  switch (raw) {
    case "settlement":
      return { status: PAYMENT_STATUS.PAID, terminal: true };
    case "capture":
      return { status: PAYMENT_STATUS.PROCESSING, terminal: false };
    case "pending":
      return { status: PAYMENT_STATUS.PENDING, terminal: false };
    case "authorize":
      return { status: PAYMENT_STATUS.PROCESSING, terminal: false };
    case "deny":
    case "failure":
      return { status: PAYMENT_STATUS.FAILED, terminal: true };
    case "cancel":
      return { status: PAYMENT_STATUS.CANCELLED, terminal: true };
    case "expire":
      return { status: PAYMENT_STATUS.EXPIRED, terminal: true };
    case "refund":
    case "partial_refund":
      return { status: PAYMENT_STATUS.REFUNDED, terminal: true };
    default:
      // An unrecognised status is not a crash, but it must never be treated as
      // paid. The webhook logs it and leaves the payment untouched.
      return { status: PAYMENT_STATUS.PENDING, terminal: false };
  }
}

/**
 * Map an internal method key to Midtrans's `payment_type`.
 *
 * Midtrans accepts `payment_type` on the /charge and /transactions APIs, but
 * Snap is built around "no payment type at creation": the customer chooses in
 * the Snap popup, and the VA/QRI/ewallet list is configured in the dashboard.
 * We still send the ones that are 1:1 with our catalogue so a customer who
 * already picked DANA on our page lands on the DANA tab in Snap.
 *
 * Returns null for methods Midtrans does not offer directly — the manual
 * adapter owns those (and always will, since "transfer to my BCA account" is
 * not a Midtrans product).
 */
export function midtransPaymentType(methodKey) {
  const key = String(methodKey ?? "");
  const exact = {
    qris: "qris",
    va_bca: "bca_va",
    va_bni: "bni_va",
    va_bri: "bri_va",
    va_permata: "permata_va",
    va_mandiri: "mandiri_va",
    card_credit: "credit_card",
    card_debit: "debit_card",
  };
  if (exact[key]) return exact[key];

  // E-wallets are exposed by Midtrans via the /charge endpoint with a
  // `payment_type` that is not part of the VA catalogue.
  const ewallet = {
    ewallet_gopay: "gopay",
    ewallet_shopeepay: "shopeepay",
  };
  if (ewallet[key]) return ewallet[key];

  return null;
}

/** Whether a method key can be served by Midtrans at all (vs. the manual adapter). */
export function isMidtransMethod(methodKey) {
  return midtransPaymentType(methodKey) !== null;
}
