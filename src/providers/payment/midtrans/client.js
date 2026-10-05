// ============================================================================
// Midtrans Core API client (/v2/charge, /v2/{order_id}/status, /v2/{order_id}/cancel).
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

const SANDBOX_BASE = "https://api.sandbox.midtrans.com";
const PRODUCTION_BASE = "https://api.midtrans.com";
const CHARGE_PATH = "/v2/charge";
const STATUS_PATH_PREFIX = "/v2";

/** Anything 5xx or unreachable is "we don't know", never "it failed". */
const UNKNOWN_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Midtrans is GMT+7 (Asia/Jakarta). Its timestamps carry no zone suffix. */
const MIDTRANS_UTC_OFFSET_MINUTES = 7 * 60;

/**
 * Parse a Midtrans timestamp ("2026-09-27 13:01:35") into a real UTC Date.
 *
 * Midtrans emits LOCAL Jakarta time with no timezone designator. JavaScript's
 * Date parses a dash-separated datetime without a zone as UTC, so reading it
 * naively puts the deadline 7 hours in the future. The customer then sees a
 * QR that has already expired presented as still payable.
 *
 * An ISO string WITH a zone ("...Z" or "+07:00") is already unambiguous and is
 * passed through untouched.
 *
 * @param {string|null|undefined} value
 * @returns {string|null} an ISO string in UTC, or null when absent/invalid
 */
export function parseExpiryTime(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Already carries a timezone designator: unambiguous, use as-is.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const zoned = new Date(trimmed);
    return Number.isNaN(zoned.getTime()) ? null : zoned.toISOString();
  }

  // "YYYY-MM-DD HH:MM:SS": Midtrans emits Jakarta local time with NO zone.
  //
  // The fix has to be applied to the STRING, not to a parsed Date. JavaScript's
  // Date honours the HOST timezone when a naive datetime is handed to it: on a
  // server set to Asia/Jakarta, new Date("19:33:33") already reads it as
  // Jakarta local time. Subtracting the offset on top of that applied it twice
  // and pushed every deadline 7 hours into the past. A freshly issued QR
  // was "already expired" on exactly those servers.
  //
  // Attaching an explicit +07:00 makes the result independent of the host TZ.
  const withZone = `${trimmed.replace(" ", "T")}+07:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Basic auth per Midtrans docs: username = Server Key, password is empty.
 * AUTH_STRING = base64(`serverKey:`).
 */
function authHeader(serverKey) {
  // NOTE `.toString`, not `.digest`: `base64` here is an ENCODING of the buffer,
  // not a hash. Calling `.digest` on a Buffer throws at runtime,
  // "Buffer.from(...).digest is not a function", and broke every payment
  // instruction at issue time. Only crypto.Hash has `.digest`.
  return "Basic " + Buffer.from(`${serverKey}:`, "utf8").toString("base64");
}

/**
 * POST /v2/charge: Core API "custom interface" charge.
 *
 * WHY THIS REPLACES SNAP
 *
 * Snap hands the customer a Midtrans-hosted payment page and makes them pick the
 * channel a SECOND time, after they already picked it on our checkout. Core API
 * takes the channel as `payment_type` up front and returns the instrument
 * directly in the response body (a VA number, a QR string, a payment code), so
 * we render it on our own order page and the customer never leaves.
 *
 * The response shape depends on the channel:
 *
 *   bank_transfer → va_numbers: [{ bank, va_number }]          (BCA/BNI/BRI/Permata)
 *   bank_transfer → bill_key + biller_code                     (Mandiri e-channel)
 *   qris/gopay    → actions: [{ name: "generate-qr-code", url }] + qr_string
 *   cstore        → payment_code + store
 *
 * Everything is normalised into a single `instructions` shape by the adapter
 * (see extractChargeInstructions in index.js), so the UI has one branch per
 * channel family instead of a switch over raw gateway fields.
 *
 * @returns {Promise<PaymentResult<{ statusCode: string, transactionId: string,
 *           transactionStatus: string, fraudStatus: string|null,
 *           paymentType: string, grossAmount: string|null,
 *           vaNumbers: Array, billKey: string|null, billerCode: string|null,
 *           actions: Array, qrString: string|null,
 *           paymentCode: string|null, store: string|null,
 *           expiryTime: string|null, raw: object }>>}
 */
export async function createChargeTransaction({ baseUrl, serverKey, payload, log }) {
  const url = `${baseUrl}${CHARGE_PATH}`;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: authHeader(serverKey),
  };

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
      log?.warn?.("midtrans.timeout_charge", { url });
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Server pembayaran tidak merespons. Pembayaran tetap tertunda.");
    }
    log?.warn?.("midtrans.network_charge", { message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Layanan pembayaran sedang tidak dapat dihubungi.");
  }

  const text = await response.text().catch(() => "");
  const body = tryParse(text);

  // 201 = charge created and pending payment (VA/QR/payment code issued).
  // 200 = an immediate outcome, usually a fraud-filter deny at request time.
  // Both carry the same body shape; what differs is transaction_status.
  //
  // MIDTRANS OVERLOADS HTTP 200: a business-level rejection is still served as
  // HTTP 200 with `status_code` in the BODY carrying the real error (406 for a
  // duplicate order_id, 400 for a bad parameter). So the body status is checked
  // BEFORE trusting the response, and a 2xx that carries an error status is
  // routed to the same rejection branch as a real 4xx; otherwise a duplicate
  // charge would reach the caller as "no transaction data" (UNKNOWN), which is
  // what surfaced as a 502 on "Muat ulang instruksi".
  const bodyStatusCode = Number(body?.status_code);
  // Midtrans mirrors the upstream status INSIDE the body even when the transport
  // is a 200, and that body status can be a 5xx too: a partner outage answers
  // `{"status_code":"502","status_message":"Sorry. The bank/payment partner is
  // experiencing issues."}`. Treating only 4xx as a "business rejection" sent
  // every one of those to the generic `charge_bad_body` branch, which threw away
  // the body status AND the body message, logged `status: 200`, and classified a
  // partner outage as UNKNOWN/no-transaction-data. So the body status is honoured
  // across the whole 4xx/5xx range and routed to the classifier below.
  const isBusinessRejection =
    Number.isFinite(bodyStatusCode) && bodyStatusCode >= 400 && bodyStatusCode < 600;

  if (response.status === 201 || response.status === 200) {
    if (!isBusinessRejection && body && typeof body === "object" && body.transaction_id) {
      return paymentOk({
        statusCode: String(body.status_code ?? ""),
        transactionId: String(body.transaction_id),
        transactionStatus: String(body.transaction_status ?? ""),
        fraudStatus: typeof body.fraud_status === "string" ? body.fraud_status : null,
        paymentType: String(body.payment_type ?? ""),
        grossAmount: body.gross_amount != null ? String(body.gross_amount) : null,
        // VA family. Permata is the odd one out: Midtrans returns a top-level
        // `permata_va_number` string instead of a `va_numbers` array, so it is
        // normalised into the same shape here (one synthetic row), and the
        // adapter's instruction builder never has to know about it.
        vaNumbers: Array.isArray(body.va_numbers)
          ? body.va_numbers
          : typeof body.permata_va_number === "string" && body.permata_va_number
            ? [{ bank: "permata", va_number: body.permata_va_number }]
            : [],
        billKey: typeof body.bill_key === "string" ? body.bill_key : null,
        billerCode: typeof body.biller_code === "string" ? body.biller_code : null,
        // QR / e-wallet family: an array of action objects {name, method, url},
        // plus a scannable QR payload string when Midtrans returns one.
        actions: Array.isArray(body.actions) ? body.actions : [],
        qrString: typeof body.qr_string === "string" ? body.qr_string : null,
        // Retail family
        paymentCode: typeof body.payment_code === "string" ? body.payment_code : null,
        store: typeof body.store === "string" ? body.store : null,
        // Midtrans reports the deadline it will enforce. The string has NO
        // timezone suffix (Midtrans is GMT+7), so a raw `new Date()` reads it
        // as UTC and drifts 7 hours. parseExpiryTime() corrects that.
        expiryTime: parseExpiryTime(body.expiry_time),
        raw: body,
      });
    }
    // A business-level rejection arrived inside an HTTP 200 (see the note above):
    // treat it exactly like a real 4xx. This is the duplicate-order_id case: the
    // caller gets DUPLICATE_TRANSACTION and can cancel-then-retry, instead of a
    // meaningless "no transaction data".
    if (isBusinessRejection) {
      return paymentErrorFromStatus({
        bodyStatus: bodyStatusCode,
        httpStatus: response.status,
        body,
        text,
        log,
      });
    }

    log?.error?.("midtrans.charge_bad_body", { status: response.status });
    return paymentErr(PAYMENT_ERROR.UNKNOWN, "Respon server pembayaran tidak berisi data transaksi.", {
      httpStatus: response.status,
      raw: body,
    });
  }

  /**
   * Classify a Midtrans rejection into an error code + customer-safe message.
   *
   * @param {object} args
   * @param {number} args.bodyStatus  the `status_code` Midtrans put in the JSON body
   * @param {number} args.httpStatus  the transport status
   * @param {object|null} args.body   parsed JSON, for the message
   * @param {string} args.text        raw body, for the log
   * @param {object} [args.log]
   * @returns {PaymentResult<never>}
   */
  function paymentErrorFromStatus({ bodyStatus, httpStatus, body, text, log }) {
    const message = pickMessage(body) || "Permintaan pembayaran ditolak (status tidak diketahui).";
    log?.warn?.("midtrans.charge_rejected", {
      httpStatus,
      bodyStatus,
      body: String(text ?? "").slice(0, 300),
    });

    // 406 = order_id already has a live transaction. The fix is to cancel the
    // old one and charge again, so this is signalled distinctly: a generic
    // "rejected" would not tell the caller a retry is expected to work.
    if (bodyStatus === 406) {
      return paymentErr(PAYMENT_ERROR.DUPLICATE, message, {
        httpStatus,
        bodyStatus,
        raw: body,
      });
    }

    // 401 with a key present means the Server Key is wrong: an operator config
    // error, reported distinctly so the settings page can say so.
    if (bodyStatus === 401) {
      return paymentErr(PAYMENT_ERROR.NOT_CONFIGURED, message, { httpStatus, bodyStatus, raw: body });
    }

    // A 5xx, ours or a partner's, is UNAVAILABLE, never the 400 branch below.
    //
    // Midtrans relays an upstream outage as `{"status_code":"502","status_message":
    // "Sorry. The bank/payment partner is experiencing issues. Please retry
    // later."}` and the payload we send is never at fault. It is still
    // retryable (RETRYABLE_PAYMENT_CODES covers both UNKNOWN and UNAVAILABLE), but
    // it needs its own code so the checkout can say "the payment service is
    // having trouble" instead of "your request could not be processed", and so
    // an operator can tell a partner outage from our own bug. Falling through to
    // the 400 branch also mislabelled it in the log as a bare-400 parameter fault.
    if (bodyStatus >= 500) {
      return paymentErr(PAYMENT_ERROR.UNAVAILABLE, message, { httpStatus, bodyStatus, raw: body });
    }

    // A bare 400 with no Midtrans error field is the sandbox's transient fault.
    //
    // Midtrans usually names the offending field ("callback_url is required").
    // When it does NOT, the payload was fine: replaying it verbatim succeeds
    // moments later (verified against the exact amounts that failed checkout:
    // 6344, 6546, 11983 all succeed on retry). Classifying this as REJECTED
    // makes the service give up on a charge that would have worked, so it is
    // raised as UNKNOWN instead: the caller retries, and only a repeat failure
    // is surfaced to the customer.
    //
    // A 400 that DOES name a field is a real client bug and stays REJECTED.
    const namesField = /[A-Za-z_]+ (is required|tidak valid|is invalid)/i.test(text ?? "");
    const code = namesField ? PAYMENT_ERROR.REJECTED : PAYMENT_ERROR.UNKNOWN;
    return paymentErr(code, message, { httpStatus, bodyStatus, raw: body });
  }

  // A 4xx is a permanent rejection (bad param, bad key). A 5xx is unknown.
  if (response.status >= 400 && response.status < 500) {
    return paymentErrorFromStatus({
      bodyStatus: Number(body?.status_code) || response.status,
      httpStatus: response.status,
      body,
      text,
      log,
    });
  }

  log?.warn?.("midtrans.charge_server_error", { status: response.status });
  return paymentErr(
    PAYMENT_ERROR.UNAVAILABLE,
    "Layanan pembayaran sedang dalam perbaikan. Coba beberapa saat lagi.",
    { httpStatus: response.status, raw: body }
  );
}

/**
 * GET /v2/{order_id}/status: the authoritative payment state.
 *
 * Used for reconciliation (polling, or a challenge-response check after a
 * webhook) because Midtrans notifications can arrive out of order or be
 * replayed.
 *
 * @param {{ reference: string }} input
 * @returns {Promise<PaymentResult<{ transactionStatus: string, fraudStatus: string|null,
 *            paymentType: string|null, grossAmount: string|null, transactionId: string|null,
 *            expiryTime: string|null, settlementTime: string|null }>>}
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
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Server pembayaran tidak merespons.");
    }
    log?.warn?.("midtrans.network_status", { reference, message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Layanan pembayaran sedang tidak dapat dihubungi.");
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
        // The status endpoint also carries the deadline, so a poll can refresh
        // it, and settlement_time, which is the authoritative "when the money
        // arrived" for bookkeeping. Both are zone-less Jakarta time.
        expiryTime: parseExpiryTime(body.expiry_time),
        settlementTime: parseExpiryTime(body.settlement_time),
      });
    }
    // 200 with no transaction_status means the order id is not recognised.
    log?.warn?.("midtrans.status_unknown_reference", { reference });
    return paymentErr(PAYMENT_ERROR.UNKNOWN_REFERENCE, "Transaksi tidak ditemukan di server pembayaran.");
  }

  if (UNKNOWN_STATUS_CODES.has(response.status)) {
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Layanan pembayaran sedang dalam perbaikan.", { httpStatus: response.status });
  }
  if (response.status === 404) {
    return paymentErr(PAYMENT_ERROR.UNKNOWN_REFERENCE, "Transaksi tidak ditemukan di server pembayaran.");
  }

  return paymentErr(PAYMENT_ERROR.UNKNOWN, "Respon server pembayaran tidak terduga.", {
    httpStatus: response.status,
    raw: body,
  });
}

/**
 * POST /v2/{order_id}/cancel: void an unpaid transaction so the VA/QRI is not
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
      return paymentErr(PAYMENT_ERROR.TIMEOUT, "Server pembayaran tidak merespons saat membatalkan.");
    }
    log?.warn?.("midtrans.network_cancel", { reference, message: String(err?.message ?? err).slice(0, 200) });
    return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Layanan pembayaran sedang tidak dapat dihubungi.");
  }

  const text = await response.text().catch(() => "");
  const body = tryParse(text);

  if (response.status === 200) {
    return paymentOk({ cancelled: true });
  }
  if (response.status >= 400 && response.status < 500) {
    // 412 means the transaction already settled/cancelled: nothing to void.
    return paymentErr(PAYMENT_ERROR.REJECTED, pickMessage(body) || "Transaksi tidak dapat dibatalkan.", {
      httpStatus: response.status,
      raw: body,
    });
  }
  return paymentErr(PAYMENT_ERROR.UNAVAILABLE, "Layanan pembayaran sedang dalam perbaikan.", { httpStatus: response.status });
}

/**
 * Verify a Midtrans notification signature.
 *
 * From the Midtrans notification docs:
 *   signature_key = SHA512(order_id + status_code + gross_amount + server_key)
 *
 * The gross_amount in the signature is the STRING Midtrans sent, "100000.00"
 * with cents, not our integer. Comparing against our own formatting is how a
 * genuine notification gets wrongly rejected, so the raw string is taken from
 * the body and used verbatim.
 *
 * Uses timingSafeEqual so a signature guess does not leak how many bytes were
 * right. Throws on a body that cannot carry a signature; the caller treats
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

/**
 * Turn a raw gateway error string into something safe to show a customer.
 *
 * Midtrans messages are written for merchants, not customers: they name the
 * provider, quote request fields, and sometimes leak internals ("Merchant
 * ... is not registered"). Our partner's identity must never reach the buyer,
 * and a buyer cannot act on a gateway's internal vocabulary, so the raw string
 * is only ever logged (callers pass `raw` for that) and the customer gets a
 * neutral phrase that says the same thing without the branding.
 *
 * Keep this conservative: anything we do not explicitly recognise falls back to
 * a generic message, because guessing at a mapping for an unknown string is how
 * a wrong instruction reaches the customer.
 */
function sanitizeGatewayMessage(raw) {
  const msg = String(raw ?? "").trim();
  if (!msg) return null;

  const low = msg.toLowerCase();

  // Field-level validation ("callback_url is required", "invalid gross_amount"):
  // the customer cannot fix the merchant's request, and naming the field only
  // invites confusion. Tell them plainly to retry.
  if (/is required|must be|invalid|not (allowed|valid)|does not match/.test(low)) {
    return "Permintaan pembayaran tidak dapat diproses. Silakan coba lagi.";
  }
  // Duplicates and conflicts are transient from the customer's point of view:
  // the re-issue path (cancel + recharge) handles it behind the scenes.
  if (/already (exist|exists)|duplicate|conflict|same order_id/.test(low)) {
    return "Transaksi yang sama sedang diproses. Silakan tunggu sebentar.";
  }
  // Balance, limits, and merchant-side money problems are operator problems.
  if (/balance|insufficient|limit|exceed/.test(low)) {
    return "Layanan pembayaran sedang tidak tersedia. Silakan coba lagi nanti.";
  }
  // A 5xx partner/bank outage. Midtrans relays it verbatim in English,
  // "Sorry. The bank/payment partner is experiencing issues. Please retry
  // later.", and it names the partner, so it must never reach the buyer. It is
  // transient for the customer, and it is not their request at fault.
  if (/experiencing issues|retry (later|again)|temporarily|unavailable|maintenance|timeout|too many (request|queue)/.test(low)) {
    return "Layanan pembayaran sedang gangguan. Silakan coba lagi beberapa saat lagi.";
  }
  // A status message carrying a bare 5xx code, or one that is only the code.
  if (/^\[?50[0-9]\]?|internal server error|bad gateway|service unavailable/.test(low)) {
    return "Layanan pembayaran sedang gangguan. Silakan coba lagi beberapa saat lagi.";
  }
  // Deny-list the partner name as a final guard: even a message that slips past
  // the patterns above is neutralised rather than forwarded verbatim.
  if (/midtrans|snap|melostore/.test(low)) return null;

  return msg.slice(0, 160);
}

function pickMessage(body) {
  let raw = null;
  if (Array.isArray(body?.error_messages) && body.error_messages.length) {
    raw = body.error_messages[0];
  } else if (typeof body?.error_message === "string") {
    raw = body.error_message;
  } else if (typeof body?.status_message === "string" && body.status_message.trim()) {
    // Midtrans puts a 5xx partner outage in `status_message`, not in the error
    // fields: {"status_code":"502","status_message":"Sorry. The bank/payment
    // partner is experiencing issues."}. Reading only error_messages/error_message
    // forwarded that raw English string straight to the customer's checkout
    // error, the partner's name included, in a language the buyer does not read.
    raw = body.status_message;
  }
  return sanitizeGatewayMessage(raw);
}
