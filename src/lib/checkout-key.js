// ============================================================================
// Checkout idempotency key — derived from the payload, never from a random seed.
//
// THE BUG THIS EXISTS TO KILL
//
// The key used to be `itp_<random uuid stored per (game, variant)>`. That seed
// survived across attempts, so this sequence broke:
//
//   1. customer picks nominal A, checks the account, picks payment method M,
//   2. customer changes the nominal back to A (or changes the method to M2 and
//      back to M),
//   3. the form submits the SAME key with a DIFFERENT payload.
//
// The server stores a hash of the first payload and compares: same key + a
// different body is answered with ITP_IDEMPOTENCY_CONFLICT ("Permintaan tidak
// cocok dengan transaksi sebelumnya"). The customer is stuck on a purchase they
// are entitled to make, and the only way out is a new browser tab.
//
// WHY PAYLOAD-DERIVED IS THE RIGHT ANSWER
//
//   * the SAME payload always produces the SAME key, so a double click or a
//     retried request still resolves to the existing order (that is the whole
//     point of idempotency, and it is preserved);
//   * ANY change to the payload produces a DIFFERENT key, so a changed purchase
//     is a new order instead of a conflict.
//
// The server-side rule is unchanged and still correct: a key reused with a
// different body is refused. The client simply stops creating that situation.
//
// Pure and dependency-free so it is unit-testable and safe to import in a client
// bundle. The canonicalisation MUST mirror `hashCheckoutRequest` in
// src/services/order.service.js: keys sorted, values trimmed, promo upper-cased.
// ============================================================================

/**
 * Canonical JSON for a checkout payload.
 *
 * @param {{ variantId?: string, fields?: Record<string,string>, promoCode?: string, paymentMethod?: string }} input
 * @returns {string}
 */
export function canonicalCheckoutPayload({ variantId, fields, promoCode, paymentMethod } = {}) {
  const sortedFields = Object.keys(fields || {})
    .sort()
    .reduce((acc, key) => {
      acc[key] = String(fields[key] ?? "").trim();
      return acc;
    }, {});

  return JSON.stringify({
    variantId: variantId ?? null,
    fields: sortedFields,
    // Trimmed BEFORE the emptiness test, so "   " is treated as absent — the same
    // way the server's `promoCode ? ... : null` treats it after zod's trim().
    promoCode: String(promoCode ?? "").trim() ? String(promoCode).trim().toUpperCase() : null,
    paymentMethod: paymentMethod ?? null,
  });
}

/**
 * 32-bit FNV-1a, hex-encoded.
 *
 * A non-cryptographic hash is correct here: this is a cache/dedupe key, not a
 * security token. The server never trusts it as proof of anything — it only
 * compares the payload hash it computes itself.
 */
function fnv1aHex(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range with Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Deterministic idempotency key for a checkout payload.
 *
 * Always `itp_` + 32 hex characters (36 chars), which satisfies the server's
 * `^[A-Za-z0-9._:-]+$`, 16–80 character rule.
 *
 * @param {{ variantId?: string, fields?: Record<string,string>, promoCode?: string, paymentMethod?: string }} input
 * @returns {string}
 */
export function deriveIdempotencyKey(input) {
  const canonical = canonicalCheckoutPayload(input);

  // Four independently-salted passes. One 32-bit hash has a birthday collision
  // probability that is small but not zero, and a collision here would silently
  // hand one customer another customer's order — so widen the digest.
  const digest = [0, 1, 2, 3].map((salt) => fnv1aHex(`${salt}:${canonical}`)).join("");
  return `itp_${digest}`;
}
