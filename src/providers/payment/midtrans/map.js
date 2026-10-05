// ============================================================================
// Midtrans → internal status mapping.
//
// WHY THIS FILE IS PURE
//
// A status string from a gateway is the one place an unauthenticated party can
// try to move money (a spoofed webhook carrying "settlement"). Mapping lives in
// a pure module with no I/O so it can be unit-tested exhaustively: the mapper
// IS the security boundary between "what Midtrans said" and "what we do".
//
// Midtrans transaction_status values (from their notification docs):
//   capture        : card captured, awaiting settlement
//   settlement     : money arrived, goods may be released
//   pending        : VA/QR issued, customer has not paid yet
//   authorize      : pre-auth hold (we do not use this flow)
//   cancel         : merchant or customer cancelled
//   deny           : fraud filter rejected
//   expire         : window elapsed unpaid
//   failure        : settlement failed after capture
//   refund / partial_refund : money returned
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
 *   polling. Not every non-terminal status is "good": pending is non-terminal
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
 * Core API /v2/charge REQUIRES this; unlike Snap, it is not a hint. The value
 * selects the channel, and Midtrans returns that channel's payment instrument
 * (VA number, QR string, payment code) in the response body.
 *
 * Channel-by-channel, what Midtrans expects:
 *
 *   va_bca/bni/bri/permata → "bank_transfer" + `bank_transfer.bank`
 *   va_mandiri            → "echannel" (Mandiri is NOT a bank_transfer in Core
 *                           API. It answers with bill_key + biller_code, not a
 *                           va_number, so it needs its own payment_type)
 *   retail_alfamart/…     → "cstore" + `cstore.store`
 *   qris / gopay / shopeepay → the payment_type of the same name
 *
 * Returns null for methods Midtrans does not offer directly; the manual
 * adapter owns those (and always will, since "transfer to my BCA account"
 * is not a Midtrans product).
 */
export function midtransPaymentType(methodKey) {
  const key = String(methodKey ?? "");
  const exact = {
    qris: "qris",
    va_bca: "bank_transfer",
    va_bni: "bank_transfer",
    va_bri: "bank_transfer",
    va_permata: "bank_transfer",
    // Mandiri is a separate Core API channel: charge with payment_type
    // "echannel" and Midtrans returns { bill_key, biller_code } instead of a
    // va_number, so it is not a bank_transfer.
    va_mandiri: "echannel",
    ewallet_gopay: "gopay",
    ewallet_shopeepay: "shopeepay",
    retail_alfamart: "cstore",
    retail_indomaret: "cstore",
    // Midtrans has no "debit_card" payment_type; debit cards are routed through
    // the credit_card channel and selected by BIN/acquirer settings.
    card_credit: "credit_card",
    card_debit: "credit_card",
  };
  return exact[key] || null;
}

/**
 * The `bank_transfer.bank` value Midtrans expects for a VA method, or null when
 * the method is not a bank_transfer. Derived from the method key so the bank
 * name lives next to the payment_type it belongs to.
 */
export function midtransVaBank(methodKey) {
  const key = String(methodKey ?? "");
  const bank = {
    va_bca: "bca",
    va_bni: "bni",
    va_bri: "bri",
    va_permata: "permata",
  };
  return bank[key] || null;
}

/**
 * The `cstore.store` value for a retail method, or null when the method is not
 * a cstore charge.
 */
export function midtransCstoreStore(methodKey) {
  const key = String(methodKey ?? "");
  const store = {
    retail_alfamart: "alfamart",
    retail_indomaret: "indomaret",
  };
  return store[key] || null;
}

/** Whether a method key can be served by Midtrans at all (vs. the manual adapter). */
export function isMidtransMethod(methodKey) {
  return midtransPaymentType(methodKey) !== null;
}
