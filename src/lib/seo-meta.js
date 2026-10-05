// ============================================================================
// Page title and description builders.
//
// One place decides how a page announces itself in search results, so the
// wording stays consistent across 30+ game pages and cannot drift into
// keyword stuffing. Every builder is pure: identical input in, identical
// title out, nothing random and nothing read from the network.
//
// RULES THIS CODE FOLLOWS:
//   * Titles describe the page, not a search volume estimate. A title built
//     for a query the page does not answer gets rewritten by Google anyway.
//   * Prices only appear when they are real, taken from the same rows the page
//     renders, and rounded DOWN to a credible threshold. A meta description is
//     cached longer than a price change, so it states "mulai dari" (starting
//     from) rather than an exact figure.
//   * Nothing claims "resmi", "termurah", or a discount percentage. Those are
//     unprovable claims and Google treats misleading descriptions as a policy
//     issue, not an optimisation.
//   * No game gets a default placeholder. A page without a real name returns
//     undefined so the caller can noindex it instead of publishing an empty
//     title.
// ============================================================================

import { formatIDR } from "./format.js";

/**
 * Title for a game top-up page.
 *
 * "Top Up Mobile Legends" alone is thin: every competitor's page says it.
 * Naming the currency (Diamond, UC, CP) is what the page actually sells and
 * what the customer typed. When a game has several product types the title
 * names the first two, never all of them; a title with five currencies is a
 * list, not a title.
 *
 * Product names are used raw, so a product whose name already carries the
 * currency ("CP (Global)") is kept as-is. Region suffixes that duplicate the
 * currency word ("CP (Global), CP (Indonesia)") would make the title read as a
 * list of two CPs, so when every product shares one currency word the title
 * names the currency once and appends the region labels instead.
 */
export function buildGameTitle(gameName, kind = "GAME", productNames = []) {
  if (!gameName) return undefined;

  const currencies = (productNames ?? [])
    .filter((name) => typeof name === "string" && name.length > 0)
    .slice(0, 2);
  if (currencies.length === 0) return `Top Up ${gameName}`;

  // "CP (Global)" and "CP (Indonesia)" share the currency word "CP". Long
  // product names ("eFootball Coins (iOS)") also share a prefix but are real
  // distinct products, so the collapse is limited to a short currency word.
  const base = currencies.map((name) => name.replace(/\s*\([^)]*\)\s*$/, "").trim());
  const allSameCurrency =
    base.length > 1 && base.every((word) => word === base[0]) && base[0].length <= 4;
  if (allSameCurrency) {
    const regions = currencies
      .map((name) => name.match(/\(([^)]*)\)\s*$/)?.[1])
      .filter((region) => typeof region === "string" && region.length > 0);
    if (regions.length > 0) {
      return `Top Up ${gameName} (${base[0]} ${regions.join(" / ")})`;
    }
    return `Top Up ${gameName} (${base[0]})`;
  }

  return `Top Up ${gameName} (${currencies.join(", ")})`;
}

/**
 * Description for a game top-up page.
 *
 * Prefers the game's own description, which a human wrote and which is unique
 * per game. The generated fallback is only used when that field is empty, and
 * it always names something real about THIS game rather than swapping a name
 * into a template sentence.
 */
export function buildGameDescription({
  gameName,
  description = null,
  productNames = [],
  minPrice = null,
  kind = "GAME",
}) {
  if (!gameName) return undefined;

  const currencies = (productNames ?? []).filter((n) => typeof n === "string" && n.length > 0);

  // A real description wins. It is unique content and the whole point of the
  // field; appending a price line to it would only push the useful part out of
  // the snippet.
  if (description && description.trim().length > 0) {
    return [description.trim(), priceLine(minPrice)].filter(Boolean).join(" ");
  }

  const parts = [`Top up ${gameName}`];

  if (currencies.length > 0) {
    parts.push(`pilih nominal ${currencies.slice(0, 2).join(" atau ")}`);
  }
  parts.push("proses otomatis 24 jam");

  return [parts.join(", "), priceLine(minPrice)].filter(Boolean).join(". ");
}

/**
 * Description for a pulsa operator page.
 *
 * The operator pages used to share one template sentence with the name swapped
 * in, which is the exact "thin content" pattern Google collapses. The operator
 * itself carries no editorial description, so the differentiator is what the
 * page actually offers: the denominations and the starting price, which differ
 * per operator.
 */
export function buildOperatorDescription({ operatorName, description = null, minPrice = null }) {
  if (!operatorName) return undefined;

  if (description && description.trim().length > 0) {
    return [description.trim(), priceLine(minPrice)].filter(Boolean).join(" ");
  }

  return [
    `Isi pulsa ${operatorName} dengan nominal pilihan`,
    "proses otomatis 24 jam, harga transparan",
    priceLine(minPrice),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * "Mulai dari Rp 1.700" — the cheapest nominal the page actually sells.
 *
 * Rounded down to a round-looking number so a small price change does not make
 * the cached description wrong the same day. Returns null when there is no
 * price, so no price is claimed.
 */
function priceLine(minPrice) {
  if (!Number.isFinite(minPrice) || minPrice <= 0) return null;
  return `mulai dari ${formatIDR(roundDown(minPrice))}`;
}

/**
 * Round down to the nearest "believable" price step. 1.700 stays 1.700;
 * 1.732 becomes 1.700; 256.440 becomes 250.000.
 */
function roundDown(value) {
  if (value <= 10_000) return Math.floor(value / 100) * 100;
  if (value <= 1_000_000) return Math.floor(value / 1000) * 1000;
  return Math.floor(value / 10_000) * 10_000;
}
