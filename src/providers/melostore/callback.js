// ============================================================================
// Melostore H2H: inbound callback handling.
//
// ORDER OF OPERATIONS IS THE SECURITY CONTROL HERE:
//   1. read the RAW body (never the parsed body; re-serialising changes bytes
//      and breaks the HMAC),
//   2. verify the signature,
//   3. only then parse and normalise.
//
// A callback that is parsed before it is verified is a spoofing vector: anyone
// who knows the URL can POST {"status":"success"} and have goods delivered.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs):
//
//   "Untuk transaksi yang dibuat melalui Partner API, status akhir dikirim
//    melalui POST request ke URL webhook yang sudah Anda konfigurasi. Payload
//    memuat price_charged dan updated_at."
//
//   "Gunakan header signature X-H2H-Signature ... Tanda tangan diperoleh dari
//    hash HMAC SHA256 dari payload JSON mentah menggunakan webhook_secret akun
//    Anda."
//
// The payload is JSON. If that ever changes, the fallback must parse the SAME
// raw string the signature covered.
// ============================================================================
import { PROVIDER_ERROR, providerErr } from "../contract.js";
import { createHash } from "node:crypto";
import { verifyCallbackSignature } from "./signature.js";
import { normalizeCallback } from "./mapper.js";

/**
 * Verify and normalise an inbound callback.
 *
 * @param {{ headers: Headers, rawBody: string, log?: object }} input
 * @returns {Promise<import('../contract.js').ProviderResult<import('../contract.js').NormalizedCallback>>}
 */
export async function parseCallback({ headers, rawBody, log } = {}) {
  if (!rawBody || typeof rawBody !== "string") {
    return providerErr(PROVIDER_ERROR.REJECTED, "Body callback kosong.", { retryable: false });
  }

  // ── 1. Verify BEFORE parsing ──────────────────────────────────────────────
  let verification;
  try {
    verification = verifyCallbackSignature({ headers, rawBody });
  } catch (err) {
    log?.error?.("provider.callback_verify_error", { error: String(err?.message || err) });
    return providerErr(PROVIDER_ERROR.NOT_CONFIGURED, "Verifikasi signature callback gagal dijalankan.", {
      retryable: false,
    });
  }

  if (!verification?.valid) {
    log?.warn?.("provider.callback_signature_invalid", { reason: verification?.reason });
    return providerErr(
      PROVIDER_ERROR.REJECTED,
      `Signature callback tidak valid: ${verification?.reason || "tidak diketahui"}`,
      { retryable: false }
    );
  }

  // ── 2. Parse only now that authenticity is established ───────────────────
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return providerErr(PROVIDER_ERROR.REJECTED, "Body callback bukan JSON yang valid.", {
      retryable: false,
    });
  }

  // ── 3. Normalise ─────────────────────────────────────────────────────────
  try {
    const normalized = normalizeCallback(body);

    // The event id is what makes replay protection possible. Melostore sends no
    // event id, so normalizeCallback derives one from the transaction id plus
    // the status. A redelivery of the same status dedupes; a genuine status
    // CHANGE does not.
    if (!normalized?.eventId) {
      return providerErr(PROVIDER_ERROR.UNKNOWN, "Callback tidak menyertakan event id.", {
        retryable: false,
      });
    }

    // normalizeCallback sees the PARSED body and cannot hash the bytes the
    // signature covered, so the hash is attached here; this layer holds the
    // raw string. Without it `recordWebhookEvent` rejects with
    // `payloadHash is missing`, and every genuine callback 500s AFTER the
    // signature already verified. The Midtrans route hashes via hashPayload()
    // for the same reason; this is the same value computed locally, so the
    // provider layer does not import the service layer.
    normalized.payloadHash = createHash("sha256")
      .update(String(rawBody ?? ""), "utf8")
      .digest("hex");

    return { ok: true, data: normalized };
  } catch (err) {
    return providerErr(PROVIDER_ERROR.UNKNOWN, String(err?.message || err), { retryable: false });
  }
}

/**
 * Melostore delivers final transaction status by webhook, so the adapter expects
 * callbacks. Reconciliation (getOrderStatus polling) remains as the safety net
 * for a callback that never arrives.
 */
export const CALLBACKS_SUPPORTED = true;
