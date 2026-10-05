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
