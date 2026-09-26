// ============================================================================
// Internal error codes.
//
// Two hard rules:
//   1. A user-facing message NEVER contains provider internals, SQL, stack
//      traces, file paths, or secrets. The `message` here is what the client
//      sees, so it must be written for a customer.
//   2. The technical detail goes to the server log via `cause` / `meta`, never
//      into the HTTP response.
// ============================================================================

/** code → HTTP status. Anything not listed is treated as 400. */
export const ERROR_STATUS = {
  // ── Input / request ──────────────────────────────────────────────────────
  ITP_VALIDATION_ERROR: 422,
  ITP_INVALID_INPUT: 400,
  ITP_INVALID_ACCOUNT: 422,
  ITP_PAYLOAD_TOO_LARGE: 413,
  ITP_BAD_REQUEST: 400,

  // ── Auth ─────────────────────────────────────────────────────────────────
  ITP_UNAUTHORIZED: 401,
  ITP_FORBIDDEN: 403,
  ITP_ACCOUNT_BLOCKED: 403,
  ITP_INVALID_CREDENTIALS: 401,
  ITP_SESSION_EXPIRED: 401,

  // ── Rate limiting / bot ──────────────────────────────────────────────────
  ITP_RATE_LIMITED: 429,
  ITP_CAPTCHA_REQUIRED: 429,

  // ── Catalog ──────────────────────────────────────────────────────────────
  ITP_NOT_FOUND: 404,
  ITP_PRODUCT_UNAVAILABLE: 409,
  ITP_PRICE_CHANGED: 409,
  ITP_PROMO_INVALID: 422,
  ITP_PROMO_EXHAUSTED: 409,

  // ── Orders ───────────────────────────────────────────────────────────────
  ITP_DUPLICATE_ORDER: 409,
  ITP_IDEMPOTENCY_CONFLICT: 409,
  ITP_ORDER_NOT_FOUND: 404,
  ITP_INVALID_STATE_TRANSITION: 409,
  ITP_ORDER_EXPIRED: 410,
  ITP_ORDER_NOT_PAYABLE: 409,

  // ── Payment ──────────────────────────────────────────────────────────────
  ITP_PAYMENT_FAILED: 502,
  ITP_PAYMENT_UNAVAILABLE: 503,
  ITP_PAYMENT_NOT_CONFIGURED: 503,
  ITP_PAYMENT_NOT_FOUND: 404,
  ITP_PAYMENT_ALREADY_PAID: 409,
  ITP_PAYMENT_AMOUNT_MISMATCH: 400,
  ITP_WEBHOOK_INVALID_SIGNATURE: 401,
  ITP_WEBHOOK_UNKNOWN_REFERENCE: 404,

  // ── Provider ─────────────────────────────────────────────────────────────
  ITP_PROVIDER_TIMEOUT: 504,
  ITP_PROVIDER_ERROR: 502,
  ITP_PROVIDER_UNAVAILABLE: 503,
  ITP_PROVIDER_NOT_CONFIGURED: 503,
  ITP_PROVIDER_INSUFFICIENT_BALANCE: 503,
  ITP_PROVIDER_UNKNOWN_STATE: 502,

  // ── Generic ──────────────────────────────────────────────────────────────
  ITP_CONFLICT: 409,
  ITP_INTERNAL_ERROR: 500,
};

/** Customer-safe default messages. Callers may override with something more specific. */
export const ERROR_MESSAGE = {
  ITP_VALIDATION_ERROR: "Data yang dikirim tidak valid.",
  ITP_INVALID_INPUT: "Data yang dikirim tidak valid.",
  ITP_INVALID_ACCOUNT: "Periksa kembali User ID / Zone ID.",
  ITP_PAYLOAD_TOO_LARGE: "Data yang dikirim terlalu besar.",
  ITP_BAD_REQUEST: "Permintaan tidak dapat diproses.",
  ITP_UNAUTHORIZED: "Silakan masuk terlebih dahulu.",
  ITP_FORBIDDEN: "Anda tidak memiliki akses ke halaman ini.",
  ITP_ACCOUNT_BLOCKED: "Akun Anda sedang diblokir. Hubungi dukungan ITOPUP.",
  ITP_INVALID_CREDENTIALS: "Email atau password salah.",
  ITP_SESSION_EXPIRED: "Sesi Anda berakhir. Silakan masuk kembali.",
  ITP_RATE_LIMITED: "Terlalu banyak percobaan. Coba lagi sebentar lagi.",
  ITP_CAPTCHA_REQUIRED: "Verifikasi diperlukan. Selesaikan captcha untuk melanjutkan.",
  ITP_NOT_FOUND: "Data yang Anda cari tidak ditemukan.",
  ITP_PRODUCT_UNAVAILABLE: "Produk sedang tidak tersedia.",
  ITP_PRICE_CHANGED: "Harga produk berubah. Silakan muat ulang halaman.",
  ITP_PROMO_INVALID: "Kode promo tidak valid atau sudah kedaluwarsa.",
  ITP_PROMO_EXHAUSTED: "Kode promo sudah mencapai batas pemakaian.",
  ITP_DUPLICATE_ORDER: "Transaksi ini sudah dibuat.",
  ITP_IDEMPOTENCY_CONFLICT: "Permintaan tidak cocok dengan transaksi sebelumnya.",
  ITP_ORDER_NOT_FOUND: "Transaksi tidak ditemukan.",
  ITP_INVALID_STATE_TRANSITION: "Status transaksi tidak dapat diubah.",
  ITP_ORDER_EXPIRED: "Transaksi sudah kedaluwarsa.",
  ITP_ORDER_NOT_PAYABLE: "Transaksi ini tidak dapat dibayar lagi.",
  ITP_PAYMENT_FAILED: "Pembayaran gagal. Silakan coba lagi.",
  ITP_PAYMENT_UNAVAILABLE: "Metode pembayaran sedang tidak tersedia.",
  ITP_PAYMENT_NOT_CONFIGURED: "Metode pembayaran belum dikonfigurasi.",
  ITP_PAYMENT_NOT_FOUND: "Transaksi ini belum memiliki data pembayaran.",
  ITP_PAYMENT_ALREADY_PAID: "Pembayaran sudah lunas.",
  ITP_PAYMENT_AMOUNT_MISMATCH: "Nominal pembayaran tidak sesuai.",
  ITP_WEBHOOK_INVALID_SIGNATURE: "Signature tidak valid.",
  ITP_WEBHOOK_UNKNOWN_REFERENCE: "Referensi tidak dikenal.",
  ITP_PROVIDER_TIMEOUT: "Provider tidak merespons. Transaksi akan dicek ulang otomatis.",
  ITP_PROVIDER_ERROR: "Terjadi kesalahan. Silakan coba lagi.",
  ITP_PROVIDER_UNAVAILABLE: "Layanan top-up sedang dalam perbaikan.",
  ITP_PROVIDER_NOT_CONFIGURED: "Layanan top-up belum dikonfigurasi.",
  ITP_PROVIDER_INSUFFICIENT_BALANCE: "Layanan top-up sedang tidak tersedia.",
  ITP_PROVIDER_UNKNOWN_STATE: "Status transaksi sedang diverifikasi.",
  ITP_CONFLICT: "Data sudah ada.",
  ITP_INTERNAL_ERROR: "Terjadi kesalahan. Silakan coba lagi.",
};

export class AppError extends Error {
  /**
   * @param {string} code    one of ERROR_STATUS
   * @param {string} [message] customer-safe override
   * @param {{ cause?: unknown, meta?: object, details?: object }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message || ERROR_MESSAGE[code] || ERROR_MESSAGE.ITP_INTERNAL_ERROR);
    this.name = "AppError";
    this.code = ERROR_STATUS[code] ? code : "ITP_INTERNAL_ERROR";
    this.status = ERROR_STATUS[this.code] ?? 400;
    /** Technical detail for the server log — never serialised to the client. */
    this.cause = opts.cause;
    /** Structured, non-sensitive context for the server log. */
    this.meta = opts.meta;
    /** Safe extra fields for the client (e.g. field-level validation issues). */
    this.details = opts.details;
    this.expose = true;
  }
}

/** Throw-if-not-found helper. */
export function notFound(message) {
  return new AppError("ITP_NOT_FOUND", message);
}

export function isAppError(err) {
  return err instanceof AppError;
}
