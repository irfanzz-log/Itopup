// ============================================================================
// Checkout idempotency key, the "Permintaan tidak cocok dengan transaksi
// sebelumnya" regression.
//
// THE BUG THIS FILE PREVENTS
//
// The key was `itp_<random uuid>` stored per (game, variant). That seed outlived
// the payload it was minted for, so this sequence was a dead end:
//
//   1. customer picks nominal A, checks the account, picks payment method M,
//   2. customer changes the payment method to M2 (or the promo code, or the id),
//   3. the form submits the SAME key with a DIFFERENT payload.
//
// The server keeps a hash of the first payload and compares it; same key +
// different body is answered with ITP_IDEMPOTENCY_CONFLICT. The customer cannot
// buy, and no amount of retrying helps.
//
// The fix is to derive the key FROM the payload:
//   * identical payload → identical key (a double click still dedupes),
//   * any change → different key (a changed purchase is a new order).
//
// The server-side rule is untouched and still correct. These tests pin the
// client's half of the contract, including the canonicalisation it must share
// with `hashCheckoutRequest` in src/services/order.service.js.
// ============================================================================
import { describe, it, expect } from "vitest";
import { deriveIdempotencyKey, canonicalCheckoutPayload } from "@/lib/checkout-key.js";

const BASE = {
  variantId: "11111111-2222-3333-4444-555555555555",
  fields: { userId: "123456789", zoneId: "1234" },
  promoCode: "",
  paymentMethod: "manual_bank_bca",
};

describe("deriveIdempotencyKey", () => {
  it("is stable for the same payload — a double click must dedupe", () => {
    expect(deriveIdempotencyKey(BASE)).toBe(deriveIdempotencyKey({ ...BASE }));
    expect(deriveIdempotencyKey(BASE)).toBe(deriveIdempotencyKey(structuredClone(BASE)));
  });

  it("changes when the payment method changes — the reported bug", () => {
    const first = deriveIdempotencyKey(BASE);
    const second = deriveIdempotencyKey({ ...BASE, paymentMethod: "manual_ewallet_dana" });
    expect(second).not.toBe(first);
  });

  it("changes when the nominal changes", () => {
    const first = deriveIdempotencyKey(BASE);
    const second = deriveIdempotencyKey({ ...BASE, variantId: "99999999-8888-7777-6666-555555555555" });
    expect(second).not.toBe(first);
  });

  it("changes when the account data changes", () => {
    const first = deriveIdempotencyKey(BASE);
    const second = deriveIdempotencyKey({ ...BASE, fields: { ...BASE.fields, zoneId: "4321" } });
    expect(second).not.toBe(first);
  });

  it("changes when the promo code changes", () => {
    const first = deriveIdempotencyKey(BASE);
    const second = deriveIdempotencyKey({ ...BASE, promoCode: "ITOPUP10" });
    expect(second).not.toBe(first);
  });

  it("ignores key order and surrounding whitespace in fields", () => {
    // The server sorts keys and trims values before hashing, so a form that
    // reorders its inputs must NOT look like a different purchase.
    const reordered = {
      ...BASE,
      fields: { zoneId: "  1234  ", userId: " 123456789 " },
    };
    expect(deriveIdempotencyKey(reordered)).toBe(deriveIdempotencyKey(BASE));
  });

  it("treats a promo code case-insensitively, like the server does", () => {
    expect(deriveIdempotencyKey({ ...BASE, promoCode: "itopup10" })).toBe(
      deriveIdempotencyKey({ ...BASE, promoCode: "ITOPUP10" })
    );
  });

  it("treats an empty promo code as absent", () => {
    expect(deriveIdempotencyKey({ ...BASE, promoCode: "" })).toBe(
      deriveIdempotencyKey({ ...BASE, promoCode: undefined })
    );
    expect(deriveIdempotencyKey({ ...BASE, promoCode: "   " })).toBe(
      deriveIdempotencyKey({ ...BASE, promoCode: null })
    );
  });

  it("produces a key the server's schema accepts", () => {
    // idempotencyKey in src/lib/validation.js: 16–80 chars, [A-Za-z0-9._:-].
    const key = deriveIdempotencyKey(BASE);
    expect(key).toMatch(/^[A-Za-z0-9._:-]+$/);
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(80);
    expect(key.startsWith("itp_")).toBe(true);
  });

  it("does not collide across the payloads a real customer can produce", () => {
    // A collision here would hand one customer another customer's order, so the
    // digest is widened beyond a single 32-bit hash. Sample the space that
    // actually occurs: a few nominal × method × account combinations.
    const keys = new Set();
    const variants = ["a", "b", "c", "d", "e"];
    const methods = ["manual_bank_bca", "manual_bank_mandiri", "manual_ewallet_dana"];
    for (const v of variants) {
      for (const m of methods) {
        for (const zone of ["1234", "4321", "9999"]) {
          keys.add(
            deriveIdempotencyKey({
              variantId: v,
              fields: { userId: "123456789", zoneId: zone },
              promoCode: "",
              paymentMethod: m,
            })
          );
        }
      }
    }
    expect(keys.size).toBe(variants.length * methods.length * 3);
  });

  it("handles missing pieces without throwing", () => {
    for (const input of [{}, { variantId: "x" }, { fields: {} }, { fields: { a: "b" } }]) {
      const key = deriveIdempotencyKey(input);
      expect(key).toMatch(/^itp_[0-9a-f]{32}$/);
    }
  });
});

describe("canonicalCheckoutPayload", () => {
  it("mirrors the server's canonical form", () => {
    // src/services/order.service.js hashCheckoutRequest() builds exactly this
    // shape. If one side changes, this assertion is the tripwire.
    const canonical = canonicalCheckoutPayload({
      variantId: "v",
      fields: { b: "2", a: " 1 " },
      promoCode: "promo",
      paymentMethod: "m",
    });
    expect(JSON.parse(canonical)).toEqual({
      variantId: "v",
      fields: { a: "1", b: "2" },
      promoCode: "PROMO",
      paymentMethod: "m",
    });
  });

  it("sorts field keys so insertion order cannot change the key", () => {
    const one = canonicalCheckoutPayload({ fields: { a: "1", b: "2", c: "3" } });
    const two = canonicalCheckoutPayload({ fields: { c: "3", b: "2", a: "1" } });
    expect(one).toBe(two);
  });
});
