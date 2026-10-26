// ============================================================================
// Pricing rules: how a provider cost becomes the price a customer pays.
//
// WHY THESE ARE TESTED
//
// `sellingPriceFromCost` is the single place a price is computed. Every other
// path (the seed, the catalog sync, the admin re-assignment) defers to it, so
// a wrong rule here is a wrong price everywhere, and nothing else in the system
// is in a position to notice. The rules are arithmetic and boundary-adjacent,
// which is exactly where an "obviously fine" change breaks silently.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  sellingPriceFromCost,
  DEFAULT_MARKUP,
  PULSA_MARKUP,
} from "../../src/config/pricing.js";

describe("no rounding by default", () => {
  // The operator's instruction was "jangan di round untuk harganya", after
  // discovering that a 1.03 -> 1.02 change produced identical prices on the
  // page. The rounding step was the reason: Rp 1.648 × 1.02 = 1.680.96 rounds
  // to 1.700 at a step of 100, and so does 1.03 (1.697.44 -> 1.700).
  it("derives the exact price, to the rupiah", () => {
    // 1648 × 1.02 = 1680.96 -> ceil -> 1681, NOT 1700.
    expect(sellingPriceFromCost(1648, { multiplier: 1.02, flat: 0, roundTo: 1 })).toBe(1681);
  });

  it("makes a small markup change actually change the price", () => {
    const cost = 1648;
    const at103 = sellingPriceFromCost(cost, { multiplier: 1.03, flat: 0, roundTo: 1 });
    const at102 = sellingPriceFromCost(cost, { multiplier: 1.02, flat: 0, roundTo: 1 });
    expect(at103).not.toBe(at102);
    expect(at103 - at102).toBeGreaterThan(0);
  });

  it("is what the shipped default does", () => {
    // DEFAULT_MARKUP reads PRICING_ROUND_TO; with it unset the step must be 1.
    // This is the assertion that would have caught the rounding hiding a
    // markup change: at a step of 100 the two multipliers above are equal.
    expect(DEFAULT_MARKUP.roundTo).toBe(1);
  });

  it("still never rounds DOWN into the margin", () => {
    // Ceil, not floor/round: a fractional rupiah always goes up.
    expect(sellingPriceFromCost(1648, { multiplier: 1.02, flat: 0, roundTo: 1 })).toBe(1681);
    expect(sellingPriceFromCost(1000, { multiplier: 1.0005, flat: 0, roundTo: 1 })).toBe(1001);
  });
});

describe("sellingPriceFromCost", () => {
  it("applies the configured multiplier to the provider cost", () => {
    expect(sellingPriceFromCost(10000, { multiplier: 1.04, flat: 0, roundTo: 1 })).toBe(10400);
  });

  it("rounds UP to the configured step, never down into the margin", () => {
    // 4302 * 1.04 = 4474.08 -> next multiple of 100 is 4500, not 4400.
    expect(sellingPriceFromCost(4302, { multiplier: 1.04, flat: 0, roundTo: 100 })).toBe(4500);
  });

  it("rounds to 1 when the step is disabled", () => {
    expect(sellingPriceFromCost(4302, { multiplier: 1.04, flat: 0, roundTo: 0 })).toBe(4475);
  });

  it("returns 0 for a non-finite or non-positive cost", () => {
    expect(sellingPriceFromCost(NaN)).toBe(0);
    expect(sellingPriceFromCost(0)).toBe(0);
    expect(sellingPriceFromCost(-100)).toBe(0);
  });

  it("defaults to the 4% game markup", () => {
    // The default regime must match what .env.example documents, otherwise the
    // seed and the live sync price differently.
    expect(DEFAULT_MARKUP.multiplier).toBe(1.04);
    expect(sellingPriceFromCost(10000)).toBe(10400);
  });
});

describe("pulsa pricing", () => {
  it("takes a fixed spread, not a percentage", () => {
    expect(PULSA_MARKUP.multiplier).toBe(1);
    expect(PULSA_MARKUP.flat).toBe(1000);

    // 10950 + 1000 = 11950, exactly. Rounding to 100 would push the margin
    // above the documented Rp 1.000, so pulsa does not round.
    expect(sellingPriceFromCost(10950, { kind: "PULSA" })).toBe(11950);
    expect(sellingPriceFromCost(10950, { kind: "PULSA" }) - 10950).toBe(1000);
  });

  it("keeps exactly the same margin across every denomination", () => {
    // The percentage regime gives a margin that grows with the denomination;
    // airtime is supposed to be a flat spread regardless of face value.
    const costs = [6100, 11000, 25800, 50800, 100400, 219800];
    const margins = costs.map((cost) => sellingPriceFromCost(cost, { kind: "PULSA" }) - cost);
    expect([...new Set(margins)]).toEqual([1000]);
  });

  it("a non-PULSA kind does not get the flat spread", () => {
    expect(sellingPriceFromCost(6100, { kind: "GAME" })).toBe(sellingPriceFromCost(6100));
  });

  it("an explicit override still wins over the pulsa regime", () => {
    expect(sellingPriceFromCost(6100, { kind: "PULSA", flat: 500 })).toBe(6600);
  });
});
