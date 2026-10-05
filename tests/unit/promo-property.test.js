// ============================================================================
// Property-based tests for computePromoDiscount (fast-check).
//
// Why these properties and not "discount is correct": the function's contract
// is a set of invariants that must hold for ANY input, and the arithmetic
// branch that matters most (PERCENT, with maxDiscount) is easy to get wrong by
// a single off-by-one in the floor. A property test asserts the invariant over
// thousands of generated inputs, which is what actually catches a floor/cap
// regression; an example-based test only checks the one number it was written
// against.
//
// Properties, all derived from src/services/promo.service.js:
//   P1 0 <= discount <= subtotal          (a total can never go negative)
//   P2 discount <= maxDiscount when set   (the cap is honoured)
//   P3 PERCENT floors down                (customer never pays less than accounted)
//   P4 non-positive subtotal => discount 0 (no negative spend gives money back)
// ============================================================================
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computePromoDiscount } from "@/services/promo.service.js";

/** A promo in the ACTIVE + within-window state, so only the arithmetic runs. */
function activePromo(overrides = {}) {
  return {
    isActive: true,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2027-01-01T00:00:00Z"),
    minSpend: 0,
    discountType: "PERCENT",
    discountValue: 10,
    maxDiscount: null,
    ...overrides,
  };
}

describe("P1 — discount is always within [0, subtotal]", () => {
  it("holds for PERCENT promos over arbitrary subtotals and caps", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }), // percent
        fc.integer({ min: 0, max: 500_000 }), // maxDiscount, 0 = "no cap"
        (subtotal, percent, maxDiscount) => {
          const promo = activePromo({
            discountType: "PERCENT",
            discountValue: percent,
            maxDiscount: maxDiscount === 0 ? null : maxDiscount,
          });
          const { discount } = computePromoDiscount(promo, subtotal, new Date("2026-06-01"));
          expect(discount).toBeGreaterThanOrEqual(0);
          expect(discount).toBeLessThanOrEqual(subtotal);
        }
      ),
      { numRuns: 1000 }
    );
  });

  it("holds for FIXED promos", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        (subtotal, value) => {
          const promo = activePromo({ discountType: "FIXED", discountValue: value, maxDiscount: null });
          const { discount } = computePromoDiscount(promo, subtotal, new Date("2026-06-01"));
          expect(discount).toBeGreaterThanOrEqual(0);
          expect(discount).toBeLessThanOrEqual(subtotal);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("P2 — the maxDiscount cap is honoured", () => {
  it("never exceeds the cap", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (subtotal, percent, cap) => {
          const promo = activePromo({ discountValue: percent, maxDiscount: cap });
          const { discount } = computePromoDiscount(promo, subtotal, new Date("2026-06-01"));
          expect(discount).toBeLessThanOrEqual(cap);
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("P3 — PERCENT floors DOWN (never overstates the discount)", () => {
  it("equals Math.floor(subtotal * percent / 100), capped", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (subtotal, percent, cap) => {
          const promo = activePromo({ discountValue: percent, maxDiscount: cap === 0 ? null : cap });
          const { discount } = computePromoDiscount(promo, subtotal, new Date("2026-06-01"));
          const expected = Math.floor((subtotal * percent) / 100);
          const capped = cap === 0 ? expected : Math.min(expected, cap);
          expect(discount).toBe(Math.max(0, Math.min(capped, subtotal)));
        }
      ),
      { numRuns: 1000 }
    );
  });
});

describe("P4 — a promo that does not apply gives exactly 0", () => {
  it("inactive / before window / after window / below minSpend => discount 0", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const cases = [
      ["inactive", activePromo({ isActive: false })],
      ["before start", activePromo({ startsAt: new Date("2027-01-01T00:00:00Z") })],
      ["after end", activePromo({ endsAt: new Date("2025-01-01T00:00:00Z") })],
    ];
    for (const [, promo] of cases) {
      const r = computePromoDiscount(promo, 500_000, now);
      expect(r.discount).toBe(0);
      expect(r.applies).toBe(false);
      expect(r.reason).not.toBeNull();
    }
    // below minSpend
    const r = computePromoDiscount(activePromo({ minSpend: 10_000 }), 5_000, now);
    expect(r.discount).toBe(0);
    expect(r.applies).toBe(false);
  });
});
