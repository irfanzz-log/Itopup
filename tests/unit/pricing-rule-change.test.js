// ============================================================================
// A pricing-rule change must actually reprice the catalogue.
//
// THE REPORTED BUG: an operator changed PRICING_MARKUP_MULTIPLIER in Vercel,
// redeployed, pressed "Sinkronkan katalog" in /dev/providers, and NOTHING
// changed. The sync reported success and repriced zero variants.
//
// ROOT CAUSE: the sync decided "may I overwrite this price?" by recomputing the
// derivation from the CURRENT rule and comparing it to the stored price:
//
//   isPinned = sellingPrice !== sellingPriceFromCost(costPrice)
//
// That is not a test for an admin override, it is a test for "the rule has not
// changed since this row was written". So the instant the multiplier changed,
// EVERY derived row stopped matching, was misread as a hand-edited price, and
// was skipped. The guard was inverted: the very change the operator wanted made
// the catalogue immune to it.
//
// These tests are written so they FAIL against that version: they ask the
// question the operator asks ("I changed the rule, do the prices move?") rather
// than the question the old code answered.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  sellingPriceFromCost,
  isPricePinned,
  pricingRuleFingerprint,
  MANUAL_RULE,
} from "../../src/config/pricing.js";

/** The env a fingerprint was produced under, as a string. */
const fingerprintNow = pricingRuleFingerprint(undefined);

describe("the scenario that was reported", () => {
  // A real row from the dev database: MLBB, cost 27.900, price 29.100 at 1.04.
  const variant = { costPrice: 27900, sellingPrice: 29100 };

  it("a price derived under the CURRENT rule is repricable", () => {
    expect(isPricePinned({ ...variant, pricingRule: fingerprintNow }, undefined)).toBe(false);
  });

  // THE ASSERTION THAT FAILS ON THE OLD BUILD. This row was derived by an older
  // rule and the operator has since changed the multiplier.
  //
  // The stored price must be what that OLD rule produced (27900 × 0.90 rounded
  // up to 100 = 25200), and the fingerprint must genuinely differ from the rule
  // in force now — otherwise the case collapses into "current rule" and the
  // test proves nothing. Verified by reverting the fix: this goes red.
  it("a price derived under an OLDER rule is repricable, not 'pinned'", () => {
    const olderRule = "v1:0.90:0:100";
    expect(olderRule).not.toBe(fingerprintNow);
    expect(isPricePinned({ costPrice: 27900, sellingPrice: 25200, pricingRule: olderRule }, undefined)).toBe(false);
  });

  it("would have been misread as an override by the old price comparison", () => {
    // The exact arithmetic the old guard did, kept here as documentation of the
    // bug: the stored price came from an OLDER rule, so it never equals a
    // recomputation under the current one — and the old check read that
    // difference as "an admin typed this", skipping the row. Which is why
    // changing the markup repriced nothing.
    const stored = 25200;
    const derivedNow = sellingPriceFromCost(27900, {});
    expect(derivedNow).not.toBe(stored);
    // ...yet the row is not an override, and isPricePinned must say so.
    expect(isPricePinned({ costPrice: 27900, sellingPrice: stored, pricingRule: "v1:0.90:0:100" }, undefined)).toBe(false);
  });

  it("so the new multiplier actually produces a new price", () => {
    // What the operator expects: change the markup, prices move.
    const price = sellingPriceFromCost(27900, {});
    // Assert the relationship, not a hardcoded pair: the real function reads
    // env at module load. With rounding OFF (the default now) the result is
    // exact to the rupiah, so it must NOT be a multiple of 100 — that would
    // mean the rounding step crept back in.
    expect(price).toBeGreaterThan(27900);
    expect(price % 100).not.toBe(0);
  });
});

describe("a real operator override is still protected", () => {
  it("is never overwritten, whatever the rule", () => {
    expect(isPricePinned({ costPrice: 27900, sellingPrice: 31500, pricingRule: MANUAL_RULE }, undefined)).toBe(true);
    // And a rule change does not un-protect it, which is the point of storing
    // the marker instead of inferring it.
    expect(isPricePinned({ costPrice: 27900, sellingPrice: 31500, pricingRule: MANUAL_RULE }, "PULSA")).toBe(true);
  });

  it("survives the case the old inference got wrong", () => {
    // An override that HAPPENS to equal the old derivation: the old check could
    // not tell this from a derived row at all. The marker can.
    expect(isPricePinned({ costPrice: 27900, sellingPrice: 29100, pricingRule: MANUAL_RULE }, undefined)).toBe(true);
  });
});

describe("rows written before the column existed", () => {
  it("falls back to the old comparison so nothing is destroyed", () => {
    // No fingerprint: a price that matches the current derivation is treated as
    // derived; one that does not is treated as an override.
    const derived = sellingPriceFromCost(27900, {});
    expect(isPricePinned({ costPrice: 27900, sellingPrice: derived, pricingRule: null }, undefined)).toBe(false);
    expect(isPricePinned({ costPrice: 27900, sellingPrice: derived + 500, pricingRule: null }, undefined)).toBe(true);
  });
});

describe("pricingRuleFingerprint", () => {
  it("is stable for an unchanged rule", () => {
    expect(pricingRuleFingerprint(undefined)).toBe(pricingRuleFingerprint(undefined));
  });

  // The fingerprint must distinguish the two regimes, because they are priced by
  // different numbers: a PULSA row repriced under the GAME rule would be wrong.
  it("separates the game and pulsa regimes", () => {
    expect(pricingRuleFingerprint(undefined)).not.toBe(pricingRuleFingerprint("PULSA"));
  });

  it("encodes the inputs that decide the output", () => {
    const fp = pricingRuleFingerprint(undefined);
    // multiplier : flat : roundTo, prefixed with a version.
    expect(fp).toMatch(/^v1:/);
    expect(fp.split(":")).toHaveLength(4);
  });

  // It must never collide with the manual marker, or an override would be read
  // as a derivation and silently repriced.
  it("can never equal the manual marker", () => {
    expect(pricingRuleFingerprint(undefined)).not.toBe(MANUAL_RULE);
    expect(pricingRuleFingerprint("PULSA")).not.toBe(MANUAL_RULE);
  });
});
