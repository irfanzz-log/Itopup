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
  /** Round the result up to this step so prices look intentional (e.g. 500). */
  roundTo: Number(process.env.PRICING_ROUND_TO || 100),
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
