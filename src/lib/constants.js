// ============================================================================
// Domain constants and Indonesian labels.
//
// Kept in one place so a status string is never spelled out by hand in a
// component. A typo there renders an empty badge instead of a loud error.
// ============================================================================

export const ROLES = {
  MEMBER: "MEMBER",
  DEV: "DEV",
  SUPERADMIN: "SUPERADMIN",
};

export const ROLE_LABEL = {
  MEMBER: "Member",
  DEV: "Developer",
  SUPERADMIN: "Super Admin",
};

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  BLOCKED: "BLOCKED",
};

export const USER_STATUS_LABEL = {
  ACTIVE: "Aktif",
  BLOCKED: "Diblokir",
};

export const ORDER_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  REFUND: "REFUND",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
};

/**
 * Operator-facing labels.
 *
 * These are the RAW lifecycle names, one row per status. The admin dashboard
 * breaks down every order by status, so collapsing two statuses into one label
 * would make the counts unreadable (two rows, one name).
 *
 * The terminal-pair suffixes are deliberate: EXPIRED and CANCELLED both end the
 * order, and an operator reading the breakdown needs to know WHO ended it
 * without clicking through. "Kedaluwarsa" alone does not say whether the
 * customer walked away or a staff member stepped in.
 *
 * Use CUSTOMER_ORDER_STATUS anywhere a buyer reads a status; use this for the
 * operator area and for logs.
 *
 * @constant
 */
export const ORDER_STATUS_LABEL = {
  PENDING_PAYMENT: "Menunggu Pembayaran",
  PAYMENT_PROCESSING: "Pembayaran Diproses",
  PAID: "Sudah Dibayar",
  PROCESSING: "Diproses",
  SUCCESS: "Berhasil",
  FAILED: "Gagal",
  REFUND: "Dikembalikan",
  // "otomatis": the expiry sweep ends the order, no human involved.
  EXPIRED: "Kedaluwarsa (otomatis)",
  // "dibatalkan": a person ended it, either the customer or staff. The audit
  // log holds which one; the label says it was not the clock.
  CANCELLED: "Dibatalkan",
};

/**
 * The four ideas a customer actually deals with.
 *
 * The raw lifecycle exists for the state machine and the operator's dashboard,
 * where "the payment was captured but the provider has not dispatched yet" is a
 * real, actionable distinction. To a buyer it is noise: three of the statuses
 * below all answer the same question ("apakah pesanan saya jalan?"), and the
 * customer cannot act on the difference between them. `PAYMENT_PROCESSING`,
 * `PAID` and `PROCESSING` all mean "sudah dibayar, sedang dikerjakan sistem",
 * so they collapse into one line. A top-up that is done is done, whether it
 * succeeded or failed, so the done group is one idea rather than five.
 *
 * Use this wherever a customer reads a status; use ORDER_STATUS_LABEL for the
 * operator area and for logs.
 *
 * @param {string} status an ORDER_STATUS value
 * @returns {string} the label to show a customer
 */
export const CUSTOMER_ORDER_STATUS = {
  PENDING_PAYMENT: "Menunggu Pembayaran",
  PAYMENT_PROCESSING: "Diproses Sistem",
  PAID: "Diproses Sistem",
  PROCESSING: "Diproses Sistem",
  SUCCESS: "Selesai",
  FAILED: "Gagal",
  REFUND: "Dikembalikan",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
};

/**
 * Customer-facing colour intent, resolved to design tokens in the component.
 * Kept as intent (not a hex value) so dark mode is a token change, not a
 * component rewrite.
 */
export const ORDER_STATUS_TONE = {
  PENDING_PAYMENT: "warning",
  PAYMENT_PROCESSING: "info",
  PAID: "info",
  PROCESSING: "info",
  SUCCESS: "success",
  FAILED: "danger",
  REFUND: "neutral",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
};

/** Terminal states: nothing may transition out of these. */
export const TERMINAL_ORDER_STATUSES = ["SUCCESS", "FAILED", "REFUND", "EXPIRED", "CANCELLED"];

/**
 * The order state machine. Any transition not listed here is rejected with
 * ITP_INVALID_STATE_TRANSITION (409) by the order service.
 */
export const ORDER_TRANSITIONS = {
  PENDING_PAYMENT: ["PAYMENT_PROCESSING", "PAID", "EXPIRED", "CANCELLED", "FAILED"],
  PAYMENT_PROCESSING: ["PAID", "FAILED", "EXPIRED", "CANCELLED"],
  // PAID no longer reaches CANCELLED: an order we have taken money for is out
  // of the customer's hands, and the customer cancel route refuses it. Closing
  // it is a REFUND (an operator returns the money), not a CANCEL.
  PAID: ["PROCESSING", "FAILED", "REFUND"],
  PROCESSING: ["SUCCESS", "FAILED", "REFUND"],
  SUCCESS: [],
  FAILED: ["REFUND"],
  REFUND: [],
  EXPIRED: [],
  CANCELLED: [],
};

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
};

export const PAYMENT_STATUS_LABEL = {
  PENDING: "Menunggu",
  PROCESSING: "Diproses",
  PAID: "Berhasil",
  FAILED: "Gagal",
  EXPIRED: "Kedaluwarsa",
  REFUNDED: "Dikembalikan",
  CANCELLED: "Dibatalkan",
};

export const CATEGORY_KIND = {
  GAME: "GAME",
  PULSA: "PULSA",
};

export const CATEGORY_KIND_LABEL = {
  GAME: "Game",
  PULSA: "Pulsa",
};

/** URL segment under /topup for each category kind. */
export const CATEGORY_KIND_PATH = {
  GAME: "game",
  PULSA: "pulsa",
};

export const PROVIDER_KIND = {
  TOPUP: "TOPUP",
  PAYMENT: "PAYMENT",
};

/** Audit action names. Referenced by constants so a typo cannot invent a new action. */
export const AUDIT = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  REGISTER: "REGISTER",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  // A Google sign-up completed its required password step.
  PASSWORD_SET_FROM_OAUTH: "PASSWORD_SET_FROM_OAUTH",
  PASSWORD_RESET_BY_ADMIN: "PASSWORD_RESET_BY_ADMIN",
  PROFILE_UPDATED: "PROFILE_UPDATED",
  SESSIONS_INVALIDATED: "SESSIONS_INVALIDATED",
  MEMBER_BLOCKED: "MEMBER_BLOCKED",
  MEMBER_UNBLOCKED: "MEMBER_UNBLOCKED",
  MEMBER_ROLE_CHANGED: "MEMBER_ROLE_CHANGED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRICE_UPDATED: "PRICE_UPDATED",
  PROMO_CREATED: "PROMO_CREATED",
  PROMO_UPDATED: "PROMO_UPDATED",
  PROMO_DELETED: "PROMO_DELETED",
  PROMO_HARD_DELETED: "PROMO_HARD_DELETED",
  PROMO_CLAIMED: "PROMO_CLAIMED",
  VOUCHER_REDEEMED: "VOUCHER_REDEEMED",
  PROVIDER_UPDATED: "PROVIDER_UPDATED",
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  ORDER_DISPATCHED: "ORDER_DISPATCHED",
  CATALOG_SYNCED: "CATALOG_SYNCED",
};
