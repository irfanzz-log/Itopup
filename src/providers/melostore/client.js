// ============================================================================
// Melostore H2H: HTTP client.
//
// Transport concerns only: timeouts, retry policy, error classification,
// credential loading and redaction. Endpoint paths live with the operation that
// uses them (products.js, order.js, …); request/response SHAPES live in
// mapper.js. That split is why a provider API change touches one file.
//
// SECURITY: credentials are read here and nowhere else. They are never logged,
// never returned to a caller, and never included in an error message. The only
// outward signal is `configurationGaps()` naming which env vars are missing.
// ============================================================================
import { PROVIDER_ERROR, providerErr, providerOk } from "../contract.js";
import { authorizeRequest, signatureImplemented, loadAuthCredentials } from "./signature.js";
import { ERROR_CODE_MAP } from "./mapper.js";

const PROVIDER_CODE = "melostore";

/** Timeouts. A top-up provider that is slow is a provider that is down. */
const TIMEOUT_MS = Number(process.env.MELOSTORE_TIMEOUT_MS || 15_000);

/**
 * Retry policy, deliberately narrow:
 *   * only for connection-level failures and 429/5xx,
 *   * only when the caller marked the operation idempotent,
 *   * never for a timeout (the request may have been processed).
 */
const MAX_ATTEMPTS = Number(process.env.MELOSTORE_MAX_ATTEMPTS || 2);
const BACKOFF_BASE_MS = 400;

/**
 * Load credentials from the environment.
 *
 * Documented scheme: two headers, `X-API-Key` and `X-Secret-Key`. There is no
 * username in the documented auth, so `MELOSTORE_USERNAME` is not consulted:
 * inventing a third factor would be worse than ignoring an unused variable.
 *
 * @returns {{ baseUrl: string|null, apiKey: string|null, secret: string|null,
 *             configured: boolean, missing: string[] }}
 */
export function loadCredentials() {
  const baseUrl = (process.env.MELOSTORE_BASE_URL || "").trim() || null;
  const { apiKey, secret, missing } = loadAuthCredentials();

  const gaps = [...missing];
  if (!baseUrl) gaps.unshift("MELOSTORE_BASE_URL");

  return {
    baseUrl,
    apiKey,
    secret,
    configured: gaps.length === 0,
    missing: gaps,
  };
}

export function isConfigured() {
  return loadCredentials().configured;
}

/**
 * Which configuration is missing, for the admin settings page.
 * Returns env var NAMES only: never values, never partial values.
 */
export function configurationGaps() {
  const creds = loadCredentials();
  const gaps = [...creds.missing];

  // Webhook verification is a separate credential from outbound auth; the
  // adapter is not fully operational without it, because callbacks could not be
  // trusted and every order would have to wait for reconciliation.
  const { webhookMissing } = loadAuthCredentials();
  gaps.push(...webhookMissing);

  return { missing: gaps };
}

/** Strip anything that could be a credential from a URL before logging it. */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|secret|token|sign|auth|password/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return parsed.toString();
  } catch {
    return "[unparseable-url]";
  }
}

/** Truncate a response body for logging: long bodies must not flood the log. */
function safeBody(text, limit = 400) {
  if (typeof text !== "string") return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

/**
 * Classify a transport-level failure. HTTP semantics are universal, so this is
 * not guesswork, but Melostore may return application-level error codes inside
 * a 200 response, which `classifyPayload` handles once documented.
 */
function classifyHttpStatus(status) {
  if (status === 401 || status === 403) {
    return { code: PROVIDER_ERROR.NOT_CONFIGURED, retryable: false,
      message: "Kredensial provider ditolak." };
  }
  if (status === 404) {
    return { code: PROVIDER_ERROR.REJECTED, retryable: false,
      message: "Endpoint provider tidak ditemukan." };
  }
  if (status === 429) {
    return { code: PROVIDER_ERROR.UNAVAILABLE, retryable: true,
      message: "Provider membatasi laju permintaan." };
  }
  if (status >= 500) {
    return { code: PROVIDER_ERROR.UNAVAILABLE, retryable: true,
      message: "Provider sedang bermasalah." };
  }
  return { code: PROVIDER_ERROR.REJECTED, retryable: false,
    message: "Provider menolak permintaan." };
}

/**
 * Application-level classification from the parsed body.
 *
 * Melostore returns `{ success: false, message, error: { code, message,
 * category } }` with an HTTP status, and transaction failures carry a
 * `data.error_code` string. Both are handled:
 *
 *   * the documented `error_code` strings (NO_ACTIVE_PROVIDER, PRICE_UNAVAILABLE,
 *     INVALID_TARGET, …) are mapped via ERROR_CODE_MAP;
 *   * a bare 422 with `error.category: "not_found"` is treated as a REJECTED
 *     condition rather than a transport failure.
 *
 * Returning null means "no application-level verdict" and lets the caller fall
 * back to HTTP-level classification.
 *
 * @returns {{ code: string, retryable: boolean, message: string } | null}
 */
export function classifyPayload(body) {
  if (!body || typeof body !== "object") return null;

  // Transaction-level error code (status-check and webhook responses).
  const code = body.error_code ?? body.data?.error_code;
  if (code && ERROR_CODE_MAP[code]) {
    const mapped = ERROR_CODE_MAP[code];
    return {
      code: mapped.code,
      retryable: mapped.retryable,
      message: body.message || body.error?.message || String(code),
    };
  }

  // Envelope-level error object.
  if (body.success === false && body.error) {
    const category = String(body.error.category || "");
    if (category === "not_found") {
      // An unknown account is a REJECTED request, not an outage. The caller
      // must not report it as a provider failure, and must not retry it.
      return {
        code: PROVIDER_ERROR.REJECTED,
        retryable: false,
        message: body.error.message || "Akun tidak ditemukan.",
      };
    }
    return {
      code: PROVIDER_ERROR.REJECTED,
      retryable: false,
      message: body.error.message || body.message || "Provider menolak permintaan.",
    };
  }

  return null;
}

function parseBody(text, contentType) {
  if (!text) return null;
  if (/application\/json/i.test(contentType || "")) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  // Melostore may answer form-encoded or plain text. Parsing is deferred until
  // the documented content type is known: returning the raw string is honest.
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve how long to wait before retrying a failed request.
 *
 * `Retry-After` is documented as seconds (RFC 9110) and is what Melostore sends
 * on a 429, e.g. `retry-after: 19` when the pricelist bucket is exhausted. A
 * date form is also legal, so both are handled. `fallbackMs` is used when the
 * header is absent or unparseable.
 *
 * A small random jitter is added so two syncs started at the same moment do not
 * wake up together and re-exhaust the bucket.
 */
function retryDelayMs(retryAfterHeader, fallbackMs) {
  const jitter = () => Math.floor(Math.random() * 250);
  if (!retryAfterHeader) return fallbackMs + jitter();

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    // Cap so a hostile or buggy header cannot stall the request path for hours.
    return Math.min(seconds * 1000, 120_000) + jitter();
  }

  const at = Date.parse(retryAfterHeader);
  if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), 120_000) + jitter();

  return fallbackMs + jitter();
}

/**
 * Perform one provider call.
 *
 * @param {object} input
 * @param {string} input.path            path relative to baseUrl. TODO(melostore) per operation
 * @param {'GET'|'POST'} [input.method]
 * @param {Record<string, unknown>} [input.payload]   request body / query
 * @param {boolean} [input.idempotent]   whether a retry is safe
 * @param {object} [input.log]           structured logger
 * @param {string} [input.operation]     label for logs, e.g. "validateAccount"
 * @returns {Promise<{ ok: true, data: unknown, meta: object }
 *                 | { ok: false, error: object, raw?: unknown }>}
 */
export async function call({ path, method = "POST", payload = null, idempotent = false, log, operation = "unknown" }) {
  const creds = loadCredentials();

  if (!creds.configured) {
    return providerErr(
      PROVIDER_ERROR.NOT_CONFIGURED,
      `Melostore belum dikonfigurasi: ${configurationGaps().missing.join(", ")}`,
      { retryable: false }
    );
  }

  const url = `${creds.baseUrl.replace(/\/+$/, "")}${path}`;
  let auth;
  try {
    auth = authorizeRequest({ method, url, payload });
  } catch (err) {
    // Missing credentials: a configuration problem, not a provider failure, so
    // it is obvious in the admin UI rather than looking like an outage.
    return providerErr(PROVIDER_ERROR.NOT_CONFIGURED, err?.message || "Kredensial provider tidak lengkap.", {
      retryable: false,
    });
  }

  const attempts = idempotent ? MAX_ATTEMPTS : 1;
  let lastFailure = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
          ...(payload ? { "Content-Type": "application/json" } : {}),
          ...auth.headers,
        },
        body: payload ? JSON.stringify(payload) : undefined,
        // A hung provider must not hold a customer's request open.
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Never let a proxy serve a cached provider response.
        cache: "no-store",
      });

      const text = await response.text();
      const body = parseBody(text, response.headers.get("content-type"));
      const durationMs = Date.now() - startedAt;

      log?.info?.("provider.request", {
        provider: PROVIDER_CODE,
        operation,
        url: safeUrl(url),
        status: response.status,
        durationMs,
        attempt,
      });

      if (!response.ok) {
        const failure = classifyPayload(body) || classifyHttpStatus(response.status);
        lastFailure = providerErr(failure.code, failure.message, {
          retryable: failure.retryable,
          httpStatus: response.status,
          raw: safeBody(text),
        });

        if (failure.retryable && attempt < attempts) {
          // A 429 carries the exact number of seconds to wait. Ignoring it and
          // using the generic backoff means a rate-limited sync fails after two
          // attempts ~400ms apart, even though the provider told us precisely
          // how long the window lasts. Honour the header when it is present.
          await sleep(retryDelayMs(response.headers.get("retry-after"), BACKOFF_BASE_MS * attempt));
          continue;
        }
        return lastFailure;
      }

      return providerOk(body, { status: response.status, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";

      log?.warn?.("provider.request_failed", {
        provider: PROVIDER_CODE,
        operation,
        url: safeUrl(url),
        durationMs,
        attempt,
        isTimeout,
        error: String(err?.message || err),
      });

      if (isTimeout) {
        // CRITICAL: a timeout is an UNKNOWN outcome, never a failure. The
        // request may have been received and processed. The caller must
        // reconcile by reference instead of resending.
        return providerErr(PROVIDER_ERROR.TIMEOUT, "Provider tidak merespons dalam batas waktu.", {
          retryable: false,
        });
      }

      lastFailure = providerErr(PROVIDER_ERROR.UNAVAILABLE, "Koneksi ke provider gagal.", {
        retryable: idempotent,
      });

      if (idempotent && attempt < attempts) {
        await sleep(BACKOFF_BASE_MS * attempt + Math.floor(Math.random() * 200));
        continue;
      }
      return lastFailure;
    }
  }

  return lastFailure ?? providerErr(PROVIDER_ERROR.UNKNOWN, "Permintaan provider gagal.");
}

export { PROVIDER_CODE, TIMEOUT_MS };
