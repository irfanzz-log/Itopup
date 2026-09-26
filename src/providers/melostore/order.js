// ============================================================================
// Melostore H2H — order dispatch and status.
//
// IMPLEMENTED FROM THE OFFICIAL DOCUMENTATION (h2h.melostore.id/id/docs):
//
//   POST /api/v1/h2h/transaction            — create
//   GET  /api/v1/h2h/transaction/{id}       — status
//   POST /api/v1/h2h/smart-transaction      — create (smart SKU, max-bid model)
//
// ── IDEMPOTENCY: THE KEY DECISION IN THIS FILE ──────────────────────────────
//
// The docs state for `buyer_trx_id`:
//
//   "ID transaksi unik dari sistem Anda (buyer transaction ID) untuk mencegah
//    pemesanan ganda."
//
// and, for the smart endpoint, even more explicitly:
//
//   "Request duplikat dengan buyer_trx_id yang sama mengembalikan transaksi
//    sebelumnya dengan HTTP 200 tanpa membuat order baru."
//
// So the provider DOES deduplicate on our reference. That is what makes a
// transport retry safe, and it is why PROVIDER_SUPPORTS_CLIENT_REFERENCE is now
// true: retrying with the SAME idempotencyKey cannot buy the item twice.
//
// The flag is not a licence to retry blindly. A retry still only happens when
// the key is present (buildOrderPayload throws without it) and the failure was a
// connection-level one. A TIMEOUT is still never retried by client.js, because
// the safest resolution for an ambiguous outcome is to reconcile by reference.
// ============================================================================
import { PROVIDER_ERROR, providerErr } from "../contract.js";
import { call } from "./client.js";
import { buildOrderPayload, normalizeOrderResponse, normalizeStatusResponse } from "./mapper.js";

export const CREATE_ORDER_PATH = "/api/v1/h2h/transaction";
export const SMART_ORDER_PATH = "/api/v1/h2h/smart-transaction";

/** Documented: `{id}` accepts the provider's own id OR our buyer_trx_id. */
const orderStatusPath = (id) => `/api/v1/h2h/transaction/${encodeURIComponent(id)}`;

/**
 * Whether Melostore accepts a client-supplied reference that makes a retry safe.
 *
 * TRUE, per the documentation quoted above. If that ever changes, flipping this
 * back to false makes dispatch single-attempt again without touching anything
 * else.
 */
export const PROVIDER_SUPPORTS_CLIENT_REFERENCE = true;

/** A smart SKU is documented as always carrying this prefix. */
export function isSmartSku(providerCode) {
  return String(providerCode || "").trim().toLowerCase().startsWith("smart");
}

/**
 * Dispatch a purchase.
 *
 * @param {import('../contract.js').NormalizedOrderRequest & { log?: object, maxBid?: number }} input
 * @returns {Promise<import('../contract.js').ProviderResult<import('../contract.js').NormalizedOrderResult>>}
 */
export async function createOrder(input) {
  let payload;
  try {
    payload = buildOrderPayload(input);
  } catch (err) {
    // An unmapped game or missing target — a configuration/input gap, not a
    // provider failure.
    return providerErr(PROVIDER_ERROR.NOT_CONFIGURED, String(err?.message || err), {
      retryable: false,
    });
  }

  const smart = isSmartSku(payload.sku_code);
  if (smart) {
    // Documented: smart SKUs are rejected by the regular endpoint and require
    // `max_bid` instead of a fixed price.
    if (!Number.isFinite(Number(input.maxBid)) || Number(input.maxBid) <= 0) {
      return providerErr(
        PROVIDER_ERROR.NOT_CONFIGURED,
        "Smart SKU membutuhkan maxBid yang valid.",
        { retryable: false }
      );
    }
    payload = { ...payload, max_bid: Math.round(Number(input.maxBid)) };
  }

  const result = await call({
    path: smart ? SMART_ORDER_PATH : CREATE_ORDER_PATH,
    method: "POST",
    payload,
    // Safe because the provider deduplicates on buyer_trx_id (see the header).
    idempotent: PROVIDER_SUPPORTS_CLIENT_REFERENCE,
    log: input.log,
    operation: "createOrder",
  });

  if (!result.ok) return result;

  try {
    return { ok: true, data: normalizeOrderResponse(result.data), meta: result.meta };
  } catch (err) {
    // We received a response we cannot interpret. The order MAY have been
    // placed, so this must not be surfaced as a clean failure — the caller sends
    // it to reconciliation.
    return providerErr(PROVIDER_ERROR.UNKNOWN, String(err?.message || err), { retryable: false });
  }
}

/**
 * Query an order's status — the reconciliation primitive.
 *
 * Documented: `{id}` may be the provider's transaction id OR our buyer_trx_id.
 * We prefer OUR reference, because that is the only value we are guaranteed to
 * hold when a create-order response was lost to a timeout.
 *
 * @param {{ providerRef?: string, providerOrderId?: string, log?: object }} input
 * @returns {Promise<import('../contract.js').ProviderResult<import('../contract.js').NormalizedOrderStatus>>}
 */
export async function getOrderStatus({ providerRef, providerOrderId, log } = {}) {
  const lookup = providerRef || providerOrderId;
  if (!lookup) {
    return providerErr(PROVIDER_ERROR.REJECTED, "providerRef atau providerOrderId wajib diisi.", {
      retryable: false,
    });
  }

  const result = await call({
    path: orderStatusPath(lookup),
    method: "GET",
    idempotent: true,
    log,
    operation: "getOrderStatus",
  });

  if (!result.ok) return result;

  try {
    return { ok: true, data: normalizeStatusResponse(result.data), meta: result.meta };
  } catch (err) {
    return providerErr(PROVIDER_ERROR.UNKNOWN, String(err?.message || err), { retryable: false });
  }
}
