// ============================================================================
// Payment provider contract.
//
// NO GATEWAY HAS BEEN CHOSEN. This file defines the interface only. There is no
// endpoint, no signature scheme, and no status string invented anywhere in it:
// an adapter's mapper owns all of that.
//
// The core app calls exactly three things:
//   createPayment()      : start a payment, get instructions for the customer
//   getPaymentStatus()   : poll/reconcile
//   verifyWebhook()      : authenticate an inbound notification
//
// Same result-envelope discipline as the top-up provider, for the same reason:
// a payment gateway timeout is an UNKNOWN outcome, not a failure, and treating
// it as a failure is how an order gets cancelled after the customer has paid.
// ============================================================================

export const PAYMENT_ERROR = {
  TIMEOUT: "TIMEOUT",
  REJECTED: "REJECTED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  UNKNOWN_REFERENCE: "UNKNOWN_REFERENCE",
  DUPLICATE: "DUPLICATE",
  UNKNOWN: "UNKNOWN",
};

export const UNKNOWN_PAYMENT_CODES = new Set([
  PAYMENT_ERROR.TIMEOUT,
  PAYMENT_ERROR.UNKNOWN,
  PAYMENT_ERROR.UNAVAILABLE,
]);

export function paymentOk(data, meta = {}) {
  return { ok: true, data, meta };
}

export function paymentErr(code, message, meta = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: meta.retryable ?? code === PAYMENT_ERROR.UNAVAILABLE,
      unknown: UNKNOWN_PAYMENT_CODES.has(code),
      httpStatus: meta.httpStatus,
    },
    raw: meta.raw,
  };
}

/**
 * @typedef {Object} PaymentProvider
 * @property {string} code
 * @property {string} name
 * @property {() => boolean} isConfigured
 * @property {() => { missing: string[] }} configurationGaps
 * @property {(input: CreatePaymentInput) => Promise<PaymentResult<CreatedPayment>>} createPayment
 * @property {(input: { reference: string, externalId?: string }) => Promise<PaymentResult<PaymentState>>} getPaymentStatus
 * @property {(input: { headers: Headers, rawBody: string }) => Promise<PaymentResult<NormalizedWebhook>>} verifyWebhook
 * @property {(input: { reference: string, externalId?: string, reason?: string }) => Promise<PaymentResult<{ cancelled: boolean }>>} cancelPayment
 * @property {(input: { reference: string, externalId?: string, amount?: number, reason?: string }) => Promise<PaymentResult<{ refunded: boolean }>>} refundPayment
 */

/**
 * @typedef {Object} CreatePaymentInput
 * @property {string} orderId        internal order id
 * @property {string} invoice        our public reference
 * @property {number} amount         what the customer must pay, in rupiah
 * @property {number} fee            gateway fee already included in `amount`? see note
 * @property {string} method         internal method key from src/config/payment.js
 * @property {string} description    shown on the customer's bank/e-wallet statement
 * @property {string} [customerName]
 * @property {string} [customerEmail]
 * @property {Date} expiresAt
 */

/**
 * @typedef {Object} CreatedPayment
 * @property {string} reference       gateway reference we store and look up by
 * @property {string|null} externalId gateway's own id
 * @property {string} status          normalised: PENDING | PROCESSING | PAID | FAILED | EXPIRED
 * @property {string|null} method     gateway's own method label (for display)
 * @property {number} amount
 * @property {Date|null} expiresAt
 * @property {Record<string, unknown>|null} instructions  VA number, QR string, payment code…
 * @property {unknown} [raw]
 */

/**
 * @typedef {Object} PaymentState
 * @property {string} reference
 * @property {string} status          normalised
 * @property {number|null} paidAmount
 * @property {Date|null} paidAt
 * @property {string|null} message
 */

/**
 * @typedef {Object} NormalizedWebhook
 * @property {string} eventId         unique id for replay protection
 * @property {string} reference       gateway reference → our Payment row
 * @property {string} status          normalised
 * @property {number|null} paidAmount
 * @property {Date|null} paidAt
 * @property {string|null} message
 */

/** Runtime completeness check for an adapter. */
export function assertPaymentProvider(adapter) {
  const required = [
    "code", "name", "isConfigured", "configurationGaps",
    "createPayment", "getPaymentStatus", "verifyWebhook",
    "cancelPayment", "refundPayment",
  ];
  const missing = required.filter((key) => adapter?.[key] === undefined);
  if (missing.length) {
    throw new Error(
      `Payment adapter "${adapter?.code ?? "?"}" tidak lengkap. Missing: ${missing.join(", ")}`
    );
  }
  return adapter;
}

/** Gateway status → our internal PaymentStatus. Unknown values stay PENDING. */
export function normalizePaymentStatus(raw) {
  const value = String(raw || "").trim().toUpperCase();
  switch (value) {
    case "PAID":
    case "SETTLEMENT":
    case "SUCCESS":
    case "SUCCEEDED":
    case "CAPTURED":
      return "PAID";
    case "PENDING":
    case "UNPAID":
    case "WAITING":
      return "PENDING";
    case "PROCESSING":
    case "AUTHORIZED":
      return "PROCESSING";
    case "FAILED":
    case "DENIED":
    case "CANCELLED":
    case "CANCELED":
      return "FAILED";
    case "EXPIRED":
      return "EXPIRED";
    case "REFUNDED":
    case "REVERSED":
      return "REFUNDED";
    default:
      // Never guess a terminal state from an unrecognised string.
      return "PENDING";
  }
}
