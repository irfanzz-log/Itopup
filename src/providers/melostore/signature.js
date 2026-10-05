// ============================================================================
// Melostore H2H: request authentication and callback verification.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs).
//
// Outbound auth is NOT a signature. The docs are explicit:
//
//   "Setiap pemanggilan endpoint H2H membutuhkan verifikasi kredensial ganda
//    yang dikirimkan melalui header HTTP request"
//
//   | X-API-Key    | String | API Key lengkap yang dibuat di dashboard partner.    |
//   | X-Secret-Key | String | Secret Key lengkap yang dibuat di dashboard partner. |
//
//   plus: "Kirim header Content-Type: application/json pada request POST."
//
// The INBOUND callback is a different mechanism and IS an HMAC:
//
//   "Gunakan header signature X-H2H-Signature ... Tanda tangan diperoleh dari
//    hash HMAC SHA256 dari payload JSON mentah menggunakan webhook_secret
//    akun Anda."
//
// Two credential sources, deliberately kept apart: the API key/secret
// authenticate US to them; the webhook secret authenticates THEM to us. Sharing
// one secret across both directions would mean a leaked webhook secret could
// place orders.
// ============================================================================
import { createHmac, timingSafeEqual } from "node:crypto";

/** Documented header names. The only place these strings appear. */
export const AUTH_HEADERS = {
  apiKey: "X-API-Key",
  secretKey: "X-Secret-Key",
};

/** Documented callback signature header. */
export const CALLBACK_SIGNATURE_HEADER = "X-H2H-Signature";

/**
 * Read the H2H credentials.
 *
 * `MELOSTORE_USERNAME` from the original .env.example is intentionally unused:
 * the documented scheme has exactly two credentials and no username. It is left
 * in the environment contract as an optional extra rather than silently treated
 * as a third factor.
 */
export function loadAuthCredentials() {
  const apiKey = (process.env.MELOSTORE_API_KEY || "").trim();
  const secretKey = (process.env.MELOSTORE_SECRET || "").trim();
  const webhookSecret = (process.env.MELOSTORE_WEBHOOK_SECRET || "").trim();

  return {
    apiKey: apiKey || null,
    secretKey: secretKey || null,
    webhookSecret: webhookSecret || null,
    // Which names are absent, for the admin diagnostics page. Never values.
    missing: [
      !apiKey ? "MELOSTORE_API_KEY" : null,
      !secretKey ? "MELOSTORE_SECRET" : null,
    ].filter(Boolean),
    webhookMissing: !webhookSecret ? ["MELOSTORE_WEBHOOK_SECRET"] : [],
  };
}

/**
 * Auth headers for one outbound request.
 *
 * The credentials travel in headers, never in the URL: a URL ends up in access
 * logs, browser history and `Referer`, a header does not.
 */
export function authorizeRequest({ method, payload } = {}) {
  const { apiKey, secretKey, missing } = loadAuthCredentials();

  if (missing.length) {
    throw new Error(`Kredensial Melostore belum lengkap: ${missing.join(", ")}`);
  }

  const headers = {
    [AUTH_HEADERS.apiKey]: apiKey,
    [AUTH_HEADERS.secretKey]: secretKey,
  };

  // Documented as required for POST.
  if (method && method.toUpperCase() !== "GET" && payload !== undefined && payload !== null) {
    headers["Content-Type"] = "application/json";
  }

  return { headers };
}

/** Kept for the adapter's readiness check; see index.js `diagnostics()`. */
export function signatureImplemented() {
  return true;
}

/**
 * Verify an inbound webhook.
 *
 * Per the docs: HMAC-SHA256 over the RAW JSON payload, keyed by the account's
 * `webhook_secret`, hex-encoded, compared against `X-H2H-Signature`.
 *
 * The raw body string is used, never a re-serialised object: `JSON.stringify`
 * on a parsed body reorders and re-escapes, producing a different digest and
 * rejecting every genuine callback.
 *
 * @param {{ headers: Headers, rawBody: string }} input
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyCallbackSignature({ headers, rawBody } = {}) {
  const { webhookSecret, webhookMissing } = loadAuthCredentials();

  if (webhookMissing.length) {
    // Fail closed. An unverifiable callback must never be applied: a forged
    // one delivers goods for free, while a refused genuine one is recoverable
    // by the reconciliation job.
    return {
      valid: false,
      reason: `Webhook secret belum dikonfigurasi (${webhookMissing.join(", ")}).`,
    };
  }

  const provided = headers?.get?.(CALLBACK_SIGNATURE_HEADER);
  if (!provided) {
    return { valid: false, reason: `Header ${CALLBACK_SIGNATURE_HEADER} tidak ada.` };
  }

  const expected = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(provided).trim().toLowerCase(), "utf8");

  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // throw itself would leak the expected length.
  if (a.length !== b.length) return { valid: false, reason: "Signature tidak cocok." };

  return timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: "Signature tidak cocok." };
}
