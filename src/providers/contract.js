// ============================================================================
// Provider contract.
//
// The core app knows ONLY the shapes in this file. No page, service, or route
// handler may import a concrete adapter; they call the registry in
// src/providers/index.js and receive something that satisfies this contract.
//
// WHY a result envelope instead of throwing everywhere:
// a provider call has three possible outcomes, and two of them look identical
// from the outside:
//   * success                 → { ok: true, data }
//   * a DEFINITE failure      → { ok: false, error: { code, retryable: false } }
//   * an UNKNOWN outcome      → { ok: false, error: { code: TIMEOUT, retryable: false,
//                                unknown: true } }
// A timeout is NOT a failure: the order may well have been placed. Collapsing
// that into a thrown error is exactly how a duplicate top-up gets delivered.
// The envelope forces the caller to decide explicitly.
// ============================================================================

/** Machine-readable provider error codes. Mapped to ITP_* codes at the boundary. */
export const PROVIDER_ERROR = {
  /** No response within the deadline. Outcome UNKNOWN: must be reconciled. */
  TIMEOUT: "TIMEOUT",
  /** Provider returned an error response. Outcome known to be negative. */
  REJECTED: "REJECTED",
  /** Provider is down / maintenance. Safe to retry later. */
  UNAVAILABLE: "UNAVAILABLE",
  /** Our provider balance is too low to fulfil. Retry will NOT help. */
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  /** The account/player id the customer supplied does not exist. */
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
  /** The requested SKU is not purchasable right now. */
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  /** The provider already has this order reference: treat as success, do not resend. */
  DUPLICATE: "DUPLICATE",
  /** Provider accepted the order and will process it asynchronously. */
  PENDING: "PENDING",
  /** Configuration is missing (credentials, base URL). */
  NOT_CONFIGURED: "NOT_CONFIGURED",
  /** The adapter does not implement this operation yet. */
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  /** Anything we could not classify. Outcome UNKNOWN. */
  UNKNOWN: "UNKNOWN",
};

/** Codes whose outcome is genuinely unknown and therefore require reconciliation. */
export const UNKNOWN_OUTCOME_CODES = new Set([
  PROVIDER_ERROR.TIMEOUT,
  PROVIDER_ERROR.UNKNOWN,
  PROVIDER_ERROR.UNAVAILABLE,
]);

/** Provider-side order status, normalised. */
export const PROVIDER_ORDER_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
};

export function providerOk(data, meta = {}) {
  return { ok: true, data, meta };
}

/**
 * @param {string} code one of PROVIDER_ERROR
 * @param {string} message operator-facing detail (logged, never shown raw)
 * @param {{ retryable?: boolean, httpStatus?: number, raw?: unknown }} [meta]
 */
export function providerErr(code, message, meta = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      // Retrying an unknown outcome blindly is how duplicates happen; the
      // caller must reconcile first. Only explicitly-safe codes are retryable.
      retryable: meta.retryable ?? code === PROVIDER_ERROR.UNAVAILABLE,
      unknown: UNKNOWN_OUTCOME_CODES.has(code),
      httpStatus: meta.httpStatus,
    },
    raw: meta.raw,
  };
}

/**
 * The interface every top-up adapter must implement.
 *
 * Documented rather than declared in code because this is plain JavaScript:
 * treat this object as the spec, and `assertTopupProvider` as the runtime check.
 *
 * @typedef {Object} TopupProvider
 * @property {string} code                     stable adapter key, e.g. "melostore"
 * @property {string} name                     human label for the admin UI
 * @property {'TOPUP'} kind
 * @property {() => boolean} isConfigured      true when credentials are present
 * @property {() => { missing: string[] }} configurationGaps
 *
 * @property {(input: { category?: string }) => Promise<ProviderResult<NormalizedProduct[]>>}
 *   getProducts: the provider's catalogue, used by the sync service. Never
 *   called from a request path: the sync job writes results into the database
 *   and the UI reads the database.
 *
 * @property {(input: { gameSlug: string, fields: Record<string,string> }) => Promise<ProviderResult<NormalizedAccount>>}
 *   validateAccount: returns whether the supplied player id exists. The
 *   provider is the ONLY authority on this; the frontend never decides.
 *
 * @property {(input: NormalizedOrderRequest) => Promise<ProviderResult<NormalizedOrderResult>>}
 *   createOrder: dispatch a purchase. MUST be idempotent from our side: the
 *   adapter receives `idempotencyKey` and must send it as the provider's own
 *   reference where the provider supports one.
 *
 * @property {(input: { providerRef?: string, providerOrderId?: string }) => Promise<ProviderResult<NormalizedOrderStatus>>}
 *   getOrderStatus: reconciliation.
 *
 * @property {() => Promise<ProviderResult<{ balance: number, currency: string, raw?: unknown }>>}
 *   getBalance
 *
 * @property {(input: { headers: Headers, body: unknown, rawBody: string }) => Promise<ProviderResult<NormalizedCallback>>}
 *   parseCallback: verify + normalise an inbound callback. MUST verify the
 *   signature before returning ok:true; an unverified callback is a spoof.
 */

/**
 * @typedef {{ ok: true, data: T, meta?: object } | { ok: false, error: { code: string, message: string, retryable: boolean, unknown: boolean }, raw?: unknown }} ProviderResult<T>
 */

/**
 * Internal, provider-agnostic purchase request. The adapter's mapper converts
 * this into whatever the provider wants; that conversion is the ONLY place
 * provider-specific parameter names may appear.
 *
 * @typedef {Object} NormalizedOrderRequest
 * @property {string} idempotencyKey   our reference, e.g. ITP-20260925-ABCD1234
 * @property {string} providerCode     the provider's SKU for this variant
 * @property {Record<string,string>} fields  raw customer input (userId, zoneId, …)
 * @property {string} gameSlug         which game, so the mapper can pick the right shape
 * @property {number} amount           what the customer paid (for the provider's records)
 */

/**
 * @typedef {Object} NormalizedOrderResult
 * @property {string} providerRef       our-side reference echoed back / assigned
 * @property {string|null} providerOrderId  the provider's own id, when it has one
 * @property {string} status            one of PROVIDER_ORDER_STATUS
 * @property {string|null} message      provider message, already safe to display
 * @property {unknown} [raw]            raw provider payload (stored, never shown)
 */

/**
 * @typedef {Object} NormalizedOrderStatus
 * @property {string} providerRef
 * @property {string} status            one of PROVIDER_ORDER_STATUS
 * @property {string|null} message
 * @property {string|null} serialNumber delivered voucher/serial, when applicable
 */

/**
 * @typedef {Object} NormalizedAccount
 * @property {boolean} valid
 * @property {string|null} nickname
 * @property {string|null} server
 * @property {string|null} accountId
 */

/**
 * @typedef {Object} NormalizedProduct
 * @property {string} providerCode
 * @property {string} name
 * @property {number} price            provider cost, in rupiah
 * @property {number|null} stock
 * @property {boolean} available
 * @property {string|null} category    provider-side category label, for mapping
 */

/**
 * @typedef {Object} NormalizedCallback
 * @property {string} eventId          provider's unique event id, or a body hash
 * @property {string} providerRef      our reference
 * @property {string} status           one of PROVIDER_ORDER_STATUS
 * @property {string|null} providerOrderId
 * @property {string|null} message
 */

/** Runtime check that an adapter implements the full contract. */
export function assertTopupProvider(adapter) {
  const required = [
    "code", "name", "isConfigured", "configurationGaps",
    "getProducts", "validateAccount", "createOrder",
    "getOrderStatus", "getBalance", "parseCallback",
  ];
  const missing = required.filter((key) => adapter?.[key] === undefined);
  if (missing.length) {
    throw new Error(
      `Provider adapter "${adapter?.code ?? "?"}" tidak lengkap. Missing: ${missing.join(", ")}`
    );
  }
  return adapter;
}

/** Map a provider error code onto an internal ITP_* code. */
export function toInternalCode(providerErrorCode) {
  switch (providerErrorCode) {
    case PROVIDER_ERROR.TIMEOUT:
      return "ITP_PROVIDER_TIMEOUT";
    case PROVIDER_ERROR.INVALID_ACCOUNT:
      return "ITP_INVALID_ACCOUNT";
    case PROVIDER_ERROR.PRODUCT_UNAVAILABLE:
      return "ITP_PRODUCT_UNAVAILABLE";
    case PROVIDER_ERROR.INSUFFICIENT_BALANCE:
      return "ITP_PROVIDER_INSUFFICIENT_BALANCE";
    case PROVIDER_ERROR.UNAVAILABLE:
      return "ITP_PROVIDER_UNAVAILABLE";
    case PROVIDER_ERROR.NOT_CONFIGURED:
      return "ITP_PROVIDER_NOT_CONFIGURED";
    case PROVIDER_ERROR.NOT_IMPLEMENTED:
      return "ITP_PROVIDER_NOT_CONFIGURED";
    case PROVIDER_ERROR.UNKNOWN:
      return "ITP_PROVIDER_UNKNOWN_STATE";
    default:
      return "ITP_PROVIDER_ERROR";
  }
}
