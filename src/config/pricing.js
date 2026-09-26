// ============================================================================
// Pricing rules.
//
// The customer's price is ALWAYS computed on the server from ProductVariant
// rows. Nothing here may be imported by a client component to "preview" a price
// and then be trusted — a preview is fine, the authoritative number is the one
// the order service computes inside the checkout transaction.
// ============================================================================

/** Default markup applied when a variant has no explicit sellingPrice. */
export const DEFAULT_MARKUP = {
  /** Multiplier applied to the provider cost. 1.08 = 8% margin. */
  multiplier: Number(process.env.PRICING_MARKUP_MULTIPLIER || 1.08),
  /** Added after the multiplier, in rupiah. Covers payment-gateway fees. */
  flat: Number(process.env.PRICING_MARKUP_FLAT || 0),
  /** Round the result up to this step so prices look intentional (e.g. 500). */
  roundTo: Number(process.env.PRICING_ROUND_TO || 100),
};

/**
 * Derive a selling price from a provider cost.
 * Rounds UP (never down) so rounding can never eat into the margin.
 */
export function sellingPriceFromCost(costPrice, overrides = {}) {
  const { multiplier, flat, roundTo } = { ...DEFAULT_MARKUP, ...overrides };
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
 * (and the change is written to the audit log) rather than silently blocked —
 * loss-leader pricing is a legitimate business decision.
 */
export const MIN_HEALTHY_MARGIN_PERCENT = Number(process.env.MIN_MARGIN_PERCENT || 3);
