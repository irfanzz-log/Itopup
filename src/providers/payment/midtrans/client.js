// ============================================================================
// Midtrans Snap API client.
//
// SECRETS: this module reads the Server Key and never returns it. The Client
// Key is the only credential the browser may see, and it is passed to the
// browser as a fixed string by the page, never as an env read in a client
// component.
//
// TIMEOUTS ARE A SECURITY PROPERTY: an unanswered "did the money arrive"
// question is not a failure. Every call below classifies a network/5xx outcome
// as UNKNOWN so the caller leaves the order pending rather than cancelling it.
// Cancelling on a timeout is how a paid order gets destroyed.
// ============================================================================
import { createHash } from "node:crypto";
import { paymentOk, paymentErr, PAYMENT_ERROR } from "../contract.js";

const SANDBOX_BASE = "https://app.sandbox.midtrans.com";
const PRODUCTION_BASE = "https://app.midtrans.com";
const SNAP_PATH = "/snap/v1/transactions";
const STATUS_PATH_PREFIX = "/v2";

/** Anything 5xx or unreachable is "we don't know", never "it failed". */
const UNKNOWN_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Basic auth per Midtrans docs: username = Server Key, password is empty.
 * AUTH_STRING = base64(`serverKey:`).
 */
function authHeader(serverKey) {
  return "Basic " + Buffer.from(`${serverKey}:`, "utf8").digest("base64");
}

/**
 * Issue a Snap transaction and return the token + redirect_url.
 *
 * @returns {Promise<PaymentResult<{ token: string, redirectUrl: string }>>}
 */
export async function createSnapTransaction({
  baseUrl,
  serverKey,
  payload,
  log,
  idempotencyKey = null,
}) {
  const url = `${baseUrl}${SNAP_PATH}`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader(serverKey),
  };
  // Midtrans honours this as the replay key for a duplicate creation attempt.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // 20s hard cap: Midtrans answers in well under 2s, so this only fires on
      // a hung connection. AbortController, not a race, so the fetch is dropped.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      log?.warn?.("midtrans.timeout_create", { url });
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Midtrans tidak merespons. Pembayaran tetap tertunda.");
    }
    log?.warn?.("midtrans.network_create", { message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Tidak dapat terhubung ke Midtrans.");
  }

  // 201 is the documented success code for /snap/v1/transactions.
  if (response.status === 201) {
    const body = await response.json().catch(() => null);
    const token = body?.token;
    if (typeof token === "string" && token) {
      return paymentOk({
        token,
        redirectUrl: typeof body.redirect_url === "string" ? body.redirect_url : null,
      });
    }
    log?.error?.("midtrans.create_bad_body", { status: response.status });
    return paymentErr(PAYMENT_ERROR.UNKNOWN, "Respon Midtrans tidak berisi token transaksi.");
  }

  const text = await response.text().catch(() => "");
  const body = tryParse(text);

  // A 4xx is a permanent rejection (bad param, bad key). A 5xx is unknown.
  if (response.status >= 400 && response.status < 500) {
    const message = pickMessage(body) || `Midtrans menolak permintaan (HTTP ${response.status}).`;
    log?.warn?.("midtrans.create_rejected", { status: response.status, body: text.slice(0, 300) });
    // 401 with our key present means the Server Key is wrong — an operator
    // config error, reported distinctly so the settings page can say so.
    const code = response.status === 401 ? PAYMENT_ERROR.NOT_CONFIGURED : PAYMENT_ERROR.REJECTED;
    return paymentErr(code, message, { httpStatus: response.status, raw: body });
  }

  log?.warn?.("midtrans.create_server_error", { status: response.status });
  return paymentErr(
    PAYMENT_ERROR.UNAVAILABLE,
    "Midtrans sedang gangguan. Coba beberapa saat lagi.",
    { httpStatus: response.status, raw: body }
  );
}

/**
 * GET /v2/{order_id}/status — the authoritative payment state.
 *
 * Used for reconciliation (polling, or a challenge-response check after a
 * webhook) because Midtrans notifications can arrive out of order or be
 * replayed.
 *
 * @param {{ reference: string }} input
 * @returns {Promise<PaymentResult<{ transactionStatus: string, fraudStatus: string|null,
 *            paymentType: string|null, grossAmount: string|null, transactionId: string|null }>>}
 */
export async function getTransactionStatus({ baseUrl, serverKey, reference, log }) {
  const url = `${baseUrl}${STATUS_PATH_PREFIX}/${encodeURIComponent(reference)}/status`;

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader(serverKey),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      log?.warn?.("midtrans.timeout_status", { reference });
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Midtrans tidak merespons.");
    }
    log?.warn?.("midtrans.network_status", { reference, message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Tidak dapat terhubung ke Midtrans.");
  }

  const text = await response.text().catch(() => "");
  const body = tryParse(text);

  if (response.status === 200 && body && typeof body === "object") {
    if (typeof body.transaction_status === "string") {
      return paymentOk({
        transactionStatus: body.transaction_status,
        fraudStatus: typeof body.fraud_status === "string" ? body.fraud_status : null,
        paymentType: typeof body.payment_type === "string" ? body.payment_type : null,
        grossAmount: typeof body.gross_amount === "string" ? body.gross_amount : null,
        transactionId: typeof body.transaction_id === "string" ? body.transaction_id : null,
      });
    }
    // 200 with no transaction_status means the order id is not recognised.
    log?.warn?.("midtrans.status_unknown_reference", { reference });
    return paymentErr(PAYMENT_ERROR.UNKNOWN_REFERENCE, `Transaksi ${reference} tidak ditemukan di Midtrans.`);
  }

  if (UNKNOWN_STATUS_CODES.has(response.status)) {
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Midtrans sedang gangguan.", { httpStatus: response.status });
  }
  if (response.status === 404) {
    return paymentErr(PAYMENT_ERROR.UNKNOWN_REFERENCE, `Transaksi ${reference} tidak ditemukan di Midtrans.`);
  }

  return paymentErr(PAYMENT_ERROR.UNKNOWN, "Respon status Midtrans tidak terduga.", {
    httpStatus: response.status,
    raw: body,
  });
}

/**
 * POST /v2/{order_id}/cancel — void an unpaid transaction so the VA/QRI is not
 * payable anymore. Only valid before settlement; a settled transaction returns
 * 4xx and the caller must not treat that as a hard failure.
 */
export async function cancelTransaction({ baseUrl, serverKey, reference, log }) {
  const url = `${baseUrl}${STATUS_PATH_PREFIX}/${encodeURIComponent(reference)}/cancel`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authHeader(serverKey),
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Midtrans tidak merespons saat membatalkan.");
    }
    log?.warn?.("midtrans.network_cancel", { reference, message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Tidak dapat terhubung ke Midtrans.");
  }

  const text = await response.text().catch(() => "");
  const body = tryParse(text);

  if (response.status === 200) {
    return paymentOk({ cancelled: true });
  }
  if (response.status >= 400 && response.status < 500) {
    // 412 means the transaction already settled/cancelled — nothing to void.
    return paymentErr(PAYMENT_ERROR.REJECTED, pickMessage(body) || "Transaksi tidak dapat dibatalkan.", {
      httpStatus: response.status,
      raw: body,
    });
  }
  return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Midtrans sedang gangguan.", { httpStatus: response.status });
}

/**
 * Verify a Midtrans notification signature.
 *
 * From the Midtrans notification docs:
 *   signature_key = SHA512(order_id + status_code + gross_amount + server_key)
 *
 * The gross_amount in the signature is the STRING Midtrans sent — "100000.00"
 * with cents — not our integer. Comparing against our own formatting is how a
 * genuine notification gets wrongly rejected, so the raw string is taken from
 * the body and used verbatim.
 *
 * Uses timingSafeEqual so a signature guess does not leak how many bytes were
 * right. Throws on a body that cannot carry a signature — the caller treats
 * that as an unauthenticated request.
 *
 * @returns {Promise<PaymentResult<{ valid: boolean }>>}
 */
export function verifySignature({ serverKey, body, log }) {
  if (!body || typeof body !== "object") {
    return paymentErr(PAYMENT_ERROR.INVALID_SIGNATURE, "Body notifikasi tidak valid.");
  }

  const orderId = String(body.order_id ?? "");
  const statusCode = String(body.status_code ?? "");
  const grossAmount = body.gross_amount; // keep raw: string with cents, or number
  const provided = body.signature_key;

  if (!orderId || !statusCode || grossAmount === undefined || grossAmount === null || !provided) {
    return paymentErr(PAYMENT_ERROR.INVALID_SIGNATURE, "Notifikasi tidak memiliki field tanda tangan.");
  }

  const expected = sha512Hex(`${orderId}${statusCode}${grossAmount}${serverKey}`);
  const given = String(provided);

  if (expected.length !== given.length) {
    log?.warn?.("midtrans.signature_length_mismatch", { orderId });
    return paymentOk({ valid: false });
  }

  let equal = 0;
  for (let i = 0; i < expected.length; i++) {
    equal |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  if (equal !== 0) {
    log?.warn?.("midtrans.signature_mismatch", { orderId });
    return paymentOk({ valid: false });
  }
  return paymentOk({ valid: true });
}

/** SHA512 hex digest. */
function sha512Hex(input) {
  return createHash("sha512").update(input, "utf8").digest("hex");
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickMessage(body) {
  if (!body) return null;
  if (Array.isArray(body.error_messages) && body.error_messages.length) {
    return String(body.error_messages[0]).slice(0, 200);
  }
  if (typeof body.error_message === "string") return body.error_message.slice(0, 200);
  return null;
}
