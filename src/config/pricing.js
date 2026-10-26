// ============================================================================
// Pricing rules.
//
// The customer's price is ALWAYS computed on the server from ProductVariant
// rows. Nothing here may be imported by a client component to "preview" a price
// and then be trusted; a preview is fine, the authoritative number is the one
// the order service computes inside the checkout transaction.
// ============================================================================

/**
 * Default markup applied when a variant has no explicit sellingPrice.
 *
 * Two regimes, because pulsa is not a percentage business:
 *   * GAME products take a margin on the cost (default 4%).
 *   * PULSA products take a FIXED margin in rupiah, because airtime is sold at
 *     a near-zero spread. A percentage would give Rp 240 on a Rp 6.000 card,
 *     which does not cover the payment fee, and a percentage big enough to
 *     matter would make a Rp 100.000 card cost more than its face value.
 *     Default is Rp 1.000 on top of the cost, flat, no percentage.
 */
export const DEFAULT_MARKUP = {
  /** Multiplier applied to the provider cost. 1.04 = 4% margin. */
  multiplier: Number(process.env.PRICING_MARKUP_MULTIPLIER || 1.04),
  /** Added after the multiplier, in rupiah. Covers payment-gateway fees. */
  flat: Number(process.env.PRICING_MARKUP_FLAT || 0),
  /**
   * Rounding step for the derived price. 1 = NO rounding: the price is exactly
   * cost × multiplier, to the rupiah.
   *
   * WAS 100, and that step was hiding real price changes. A markup moved from
   * 1.03 to 1.02 changes a Rp 1.648 cost by ~Rp 16, which rounds to the same
   * Rp 1.700 — so an operator changed the multiplier, repriced, and saw the
   * prices stay put. With a step of 1 every change to the rule is visible on
   * the page, which is what "jangan di-round" asks for.
   *
   * Still configurable: set PRICING_ROUND_TO=100 (or 500) to get the
   * "prices look intentional" behaviour back.
   */
  roundTo: Number(process.env.PRICING_ROUND_TO || 1),
};

/**
 * Pricing for airtime (category kind PULSA): a fixed spread, never a
 * percentage. Overridable with PRICING_PULSA_FLAT, disabled by setting it to 0.
 *
 * `roundTo` is 1 here, deliberately. Provider airtime costs are not round
 * (Rp 10.950, Rp 54.950) and rounding UP to the nearest 100 adds up to Rp 50 on
 * top of the spread, which would break the "Rp 1.000, not more" rule. Airtime
 * is priced at face value plus the spread, exactly.
 */
export const PULSA_MARKUP = {
  multiplier: 1,
  flat: Number(process.env.PRICING_PULSA_FLAT ?? 1000),
  roundTo: 1,
};

/**
 * Marker stored in `ProductVariant.pricingRule` for a price an operator typed.
 *
 * Deliberately NOT a fingerprint of a rule: it records the ABSENCE of a rule,
 * which is the one thing a price comparison cannot distinguish from "the rule
 * changed since this row was written".
 */
export const MANUAL_RULE = "manual";

/**
 * Fingerprint of a pricing rule: the identity of "how this price was derived".
 *
 * Stored on ProductVariant.pricingRule so the sync can tell a stale derivation
 * from an admin override. WITHOUT THIS the two are indistinguishable, because
 * the old check compared the stored price against a recomputation under the
 * CURRENT rule — so changing the rule made every derived row look hand-edited
 * and the sync silently stopped repricing anything.
 *
 * The fingerprint must change whenever the produced NUMBER would change, and
 * must NOT change when it would not (otherwise a cosmetic edit to the env file
 * would reprice the whole catalogue). multiplier/flat/roundTo are exactly the
 * inputs that decide the output, so they are the fingerprint.
 *
 * @param {"GAME"|"PULSA"|undefined|null} kind which regime applies
 * @returns {string}
 */
export function pricingRuleFingerprint(kind) {
  const regime = kind === "PULSA" ? PULSA_MARKUP : DEFAULT_MARKUP;
  return `v1:${regime.multiplier}:${regime.flat}:${regime.roundTo}`;
}

/**
 * Derive a selling price from a provider cost.
 * Rounds UP (never down) so rounding can never eat into the margin.
 *
 * Pass `{ kind: "PULSA" }` (or any overrides) to switch to the flat-spread
 * regime used by airtime. Everything else uses the percentage default.
 */
export function sellingPriceFromCost(costPrice, overrides = {}) {
  const regime = overrides.kind === "PULSA" ? PULSA_MARKUP : DEFAULT_MARKUP;
  const { multiplier, flat, roundTo } = { ...regime, ...overrides };
  const raw = Number(costPrice) * multiplier + flat;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const step = roundTo > 0 ? roundTo : 1;
  return Math.ceil(raw / step) * step;
}

/** Margin in rupiah for one unit. Reporting only. */
export function unitMargin(sellingPrice, costPrice) {
  return Number(sellingPrice || 0) - Number(costPrice || 0);
}

/**
 * Has an ADMIN set this variant's price by hand?
 *
 * THE OLD CHECK WAS WRONG, and it is why changing PRICING_MARKUP_MULTIPLIER
 * appeared to do nothing:
 *
 *   isPinned = sellingPrice !== sellingPriceFromCost(costPrice)   // current rule
 *
 * That compares the stored price against a recomputation under the rule in
 * force NOW, so it answers "has the rule changed since this row was written?".
 * The moment the multiplier changes, every derived row stops matching and is
 * misread as a manual override — the sync then skips all of them, reports
 * success, and reprices nothing.
 *
 * `ProductVariant.pricingRule` replaces the guess with a fact:
 *   * MANUAL_RULE          → an operator typed this price; never overwrite it.
 *   * the current rule     → derived, reprice whenever cost moves.
 *   * any OTHER fingerprint→ derived by an older rule (the multiplier changed),
 *                            so reprice it. This is the case the old check got
 *                            backwards, and the whole reason this column exists.
 *   * null                 → a row from before the column existed; the
 *                            migration backfills these, so treat as derived.
 *
 * A hand edit is recorded as MANUAL_RULE at write time (updateVariantPrice), so
 * an override survives a markup change instead of being inferred from a price
 * comparison that a rule change invalidates.
 *
 * @param {{ sellingPrice: number, costPrice: number, pricingRule?: string|null }} variant
 * @param {"GAME"|"PULSA"|undefined|null} kind
 * @returns {boolean} true when the price must NOT be overwritten
 */
export function isPricePinned(variant, kind) {
  const rule = variant?.pricingRule ?? null;

  // The only definitive override marker.
  if (rule === MANUAL_RULE) return true;

  // Derived by the rule in force, or by an older one: both are repricable.
  if (rule) return false;

  // No fingerprint at all. Fall back to the old comparison so a row inserted by
  // a code path that does not record the rule still behaves sanely: it is
  // treated as an override only when the number does not match the current
  // derivation.
  return Number(variant?.sellingPrice ?? 0) !== sellingPriceFromCost(variant?.costPrice ?? 0, { kind });
}

/** Margin as a percentage of the selling price, 2dp. Reporting only. */
export function marginPercent(sellingPrice, costPrice) {
  const sell = Number(sellingPrice || 0);
  if (sell <= 0) return 0;
  return Math.round(((sell - Number(costPrice || 0)) / sell) * 10000) / 100;
}

/**
 * Minimum acceptable margin. An admin editing a price below this is warned
 * (and the change is written to the audit log) rather than silently blocked;
 * loss-leader pricing is a legitimate business decision.
 */
export const MIN_HEALTHY_MARGIN_PERCENT = Number(process.env.MIN_MARGIN_PERCENT || 3);
