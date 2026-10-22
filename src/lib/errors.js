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
  // The number's prefix belongs to a different operator than the product the
  // customer picked. 422: their input is well-formed but wrong for this product.
  ITP_PHONE_OPERATOR_MISMATCH: 422,
  ITP_PAYLOAD_TOO_LARGE: 413,
  ITP_BAD_REQUEST: 400,

  // ── Auth ─────────────────────────────────────────────────────────────────
  ITP_UNAUTHORIZED: 401,
  ITP_FORBIDDEN: 403,
  ITP_ACCOUNT_BLOCKED: 403,
  ITP_INVALID_CREDENTIALS: 401,
  ITP_SESSION_EXPIRED: 401,
  ITP_EMAIL_NOT_VERIFIED: 403,

  // ── Email OTP ────────────────────────────────────────────────────────────
  // 400 for user-error codes (wrong/expired/misused), 503 when the mail
  // service itself is the problem: the user did nothing wrong and retrying
  // might work once SMTP recovers.
  ITP_OTP_NOT_SENT: 400,
  ITP_OTP_INVALID: 400,
  ITP_OTP_EXPIRED: 400,
  ITP_OTP_ALREADY_USED: 400,
  ITP_OTP_TOO_MANY_ATTEMPTS: 400,
  ITP_OTP_MAIL_UNAVAILABLE: 503,
  ITP_PASSWORD_TOO_WEAK: 400,
  ITP_TICKET_INVALID: 401,

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
  // A customer cancelling an order that is already paid, or already dead, is a
  // state conflict, not a server fault. Without this entry the route's own
  // AppError was silently rewritten to ITP_INTERNAL_ERROR by `fail()`, so a
  // paid order answered 500 instead of 409.
  ITP_ORDER_NOT_CANCELLABLE: 409,

  // ── Game credentials (needsGameLogin games) ──────────────────────────────
  // 404: a credential id that is not the caller's must be indistinguishable
  // from one that never existed, so this is a not-found, never a 403.
  ITP_CREDENTIAL_NOT_FOUND: 404,
  // 409: the stored login exists but cannot be used (deleted mid-flight, or
  // AUTH_SECRET rotated so the ciphertext no longer decrypts). The order is
  // failed; retrying the same id would fail again.
  ITP_CREDENTIAL_UNAVAILABLE: 409,

  // ── Payment ──────────────────────────────────────────────────────────────
  ITP_PAYMENT_FAILED: 502,
  ITP_PAYMENT_UNAVAILABLE: 503,
  ITP_PAYMENT_NOT_CONFIGURED: 503,
  ITP_PAYMENT_NOT_FOUND: 404,
  ITP_PAYMENT_ALREADY_PAID: 409,
  ITP_PAYMENT_AMOUNT_MISMATCH: 400,
  // The customer asked to cancel while the gateway refused to void the charge.
  // 502: the failure is upstream, and retrying a moment later is exactly what
  // the UI tells the customer to do.
  ITP_GATEWAY_CANCEL_FAILED: 502,
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
  ITP_CHECKOUT_PAUSED: 503,
  ITP_METHOD_NOT_ALLOWED: 405,
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
  ITP_EMAIL_NOT_VERIFIED: "Email belum diverifikasi. Cek kotak masuk untuk kode verifikasi.",

  // Every OTP failure carries an actionable instruction, not just a verdict:
  // "kode salah" tells the user nothing they can act on that "minta kode baru"
  // does not.
  ITP_OTP_NOT_SENT: "Belum ada kode yang dikirim ke email ini.",
  ITP_OTP_INVALID: "Kode salah.",
  ITP_OTP_EXPIRED: "Kode sudah kedaluwarsa. Minta kode baru.",
  ITP_OTP_ALREADY_USED: "Kode sudah pernah dipakai. Minta kode baru.",
  ITP_OTP_TOO_MANY_ATTEMPTS: "Terlalu banyak percobaan salah. Minta kode baru.",
  ITP_OTP_MAIL_UNAVAILABLE: "Layanan email sedang tidak tersedia. Coba lagi nanti.",
  ITP_PASSWORD_TOO_WEAK: "Password terlalu lemah. Pilih password yang lebih kuat.",
  ITP_TICKET_INVALID: "Sesi ini sudah kedaluwarsa. Silakan masuk dengan Google kembali.",
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
  ITP_ORDER_NOT_CANCELLABLE: "Transaksi ini tidak dapat dibatalkan.",
  ITP_CREDENTIAL_NOT_FOUND: "Login game tersimpan tidak ditemukan.",
  ITP_CREDENTIAL_UNAVAILABLE: "Login game tersimpan tidak dapat digunakan. Silakan pesan ulang.",
  ITP_PHONE_OPERATOR_MISMATCH: "Nomor HP tidak sesuai dengan operator yang dipilih.",
  ITP_PAYMENT_FAILED: "Pembayaran gagal. Silakan coba lagi.",
  ITP_PAYMENT_UNAVAILABLE: "Metode pembayaran sedang tidak tersedia.",
  ITP_PAYMENT_NOT_CONFIGURED: "Metode pembayaran belum dikonfigurasi.",
  ITP_PAYMENT_NOT_FOUND: "Transaksi ini belum memiliki data pembayaran.",
  ITP_PAYMENT_ALREADY_PAID: "Pembayaran sudah lunas.",
  ITP_PAYMENT_AMOUNT_MISMATCH: "Nominal pembayaran tidak sesuai.",
  ITP_GATEWAY_CANCEL_FAILED: "Tidak bisa membatalkan pembayaran di gateway. Coba beberapa saat lagi.",
  ITP_WEBHOOK_INVALID_SIGNATURE: "Signature tidak valid.",
  ITP_WEBHOOK_UNKNOWN_REFERENCE: "Referensi tidak dikenal.",
  ITP_PROVIDER_TIMEOUT: "Provider tidak merespons. Transaksi akan dicek ulang otomatis.",
  ITP_PROVIDER_ERROR: "Terjadi kesalahan. Silakan coba lagi.",
  ITP_PROVIDER_UNAVAILABLE: "Layanan top-up sedang dalam perbaikan.",
  ITP_PROVIDER_NOT_CONFIGURED: "Layanan top-up belum dikonfigurasi.",
  ITP_PROVIDER_INSUFFICIENT_BALANCE: "Layanan top-up sedang tidak tersedia.",
  ITP_PROVIDER_UNKNOWN_STATE: "Status transaksi sedang diverifikasi.",
  ITP_CONFLICT: "Data sudah ada.",
  ITP_CHECKOUT_PAUSED: "Transaksi untuk sementara dinonaktifkan. Silakan coba lagi nanti.",
  ITP_METHOD_NOT_ALLOWED: "Metode HTTP tidak diizinkan.",
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
    /** Technical detail for the server log, never serialised to the client. */
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
