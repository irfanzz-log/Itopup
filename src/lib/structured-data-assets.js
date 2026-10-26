// ============================================================================
// Structured-data assets: the parts of Product markup that describe what
// ITOPUP actually is, rather than what a page happens to contain.
//
// WHY THIS IS A SEPARATE MODULE
//
// src/lib/json-ld.js builds nodes from the data a page has. Three things it
// needs are NOT page data and must not be invented per call site:
//
//   * the product IMAGE (Search Console's only critical error: "Kolom image
//     tidak ada" — a Product without an image cannot appear in a merchant
//     listing at all),
//   * the RETURN POLICY (ITOPUP's real one: digital goods, no returns once
//     delivered — the same rule /syarat §3 and §5 already state),
//   * the DELIVERY DETAILS (no physical shipping: the goods are credited to
//     the account, so the honest shipping rate is 0 and the honest delivery
//     time is the provider's processing window).
//
// Putting them here means every page's Product node describes the same
// business, and a change to the policy is one edit rather than one per route.
//
// THE RULE THAT STILL APPLIES: nothing here claims something the site does not
// do. There is no fabricated shipping fee, no invented return window, and no
// rating. Google's guidance for merchant listings asks for shippingDetails and
// hasMerchantReturnPolicy precisely so the shopper is not misled; filling them
// with guesses would defeat the point and risk a manual action.
// ============================================================================
import { absoluteUrl } from "./site-url.js";

/** Where the policies these nodes reference are actually written. */
export const TERMS_PATH = "/syarat";

/**
 * Delivery window for a top-up, in days, as a range.
 *
 * The help page promises "hitungan detik sampai beberapa menit" for most
 * orders and says a busy provider can take longer. `0–1 day` covers that
 * without overclaiming next-day service: schema.org's `QuantitativeValue`
 * takes min/max, and a 0 minimum is correct for a digital credit that usually
 * lands instantly.
 */
const DELIVERY_DAYS = { min: 0, max: 1 };

/**
 * The country the offer is sold in. ITOPUP sells Indonesian game top-ups and
 * pulsa, priced in IDR, to Indonesian accounts; `ID` is the only destination
 * this storefront serves.
 */
const SOLD_IN = "ID";

/**
 * The return policy, as schema.org wants it.
 *
 * `MerchantReturnNotPermitted` is not a placeholder — it is the policy in
 * /syarat: a top-up that has been dispatched to the provider cannot be
 * cancelled or returned (§3), and cancellation is only possible before
 * dispatch (§5). Refunds exist for a FAILED fulfilment, which is a different
 * thing from a return and is handled through the payment provider, so claiming
 * a return window here would be a promise the business does not make.
 *
 * `merchantReturnLink` points at the page that states the rule, which is what
 * makes the markup verifiable rather than an assertion in a JSON blob.
 */
export function merchantReturnPolicy() {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: SOLD_IN,
    returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
    merchantReturnLink: absoluteUrl(TERMS_PATH),
  };
}

/**
 * Shipping details for a digital product.
 *
 * A top-up is not shipped, so the truthful markup says so with the fields the
 * vocabulary has: the destination is Indonesia, the shipping rate is 0 (there
 * is nothing to pay for delivery), and the "transit" is the provider's
 * processing time. Leaving `shippingDetails` out — the previous state — is what
 * Search Console reported as missing, and it also leaves the shopper without
 * the one piece of information that matters for a digital good: how long until
 * it arrives.
 */
export function shippingDetails() {
  return {
    "@type": "OfferShippingDetails",
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: SOLD_IN,
    },
    // Free: there is no delivery cost on a digital top-up. `value: 0` is
    // explicit, and Google documents 0 as the way to say "free shipping".
    shippingRate: {
      "@type": "MonetaryAmount",
      value: 0,
      currency: "IDR",
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: DELIVERY_DAYS.min,
        maxValue: DELIVERY_DAYS.max,
        unitCode: "DAY",
      },
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: DELIVERY_DAYS.min,
        maxValue: DELIVERY_DAYS.max,
        unitCode: "DAY",
      },
    },
  };
}

/**
 * Absolute, crawlable URLs for a product's artwork.
 *
 * `image` is the ONE critical field in a merchant listing: without it the page
 * cannot be shown at all. Google additionally asks for at least 50K pixels
 * (width × height) and prefers several aspect ratios.
 *
 * BOTH OF THOSE ARE RECOMMENDATIONS, AND TREATING EITHER AS A GATE CREATES THE
 * CRITICAL ERROR IT WAS TRYING TO AVOID:
 *
 *   * The checked-in telco logos are 160×160 (25.6K pixels). Dropping them for
 *     being small leaves every pulsa page with NO image — strictly worse than
 *     an image Google merely considers sub-optimal.
 *   * eFootball's only artwork is an SVG. Google Images DOES support SVG (it is
 *     on the same supported-format list as JPEG and WebP); only the pixel-count
 *     recommendation cannot be evaluated for a vector. Excluding it left that
 *     page with the critical error too.
 *
 * So nothing is filtered out for being small or vector: candidates are ORDERED
 * best-first (raster, largest first, then vector last) and all are emitted. The
 * caller logs `meetsImageRecommendation` so the shortfall is visible in the log
 * rather than only in Search Console.
 *
 * @param {Array<{ path?: string|null, width?: number, height?: number }>} candidates
 * @returns {string[]} absolute URLs, best first
 */
export function productImageUrls(candidates = []) {
  const MIN_PIXELS = 50_000;

  const usable = candidates
    .filter((entry) => entry && typeof entry.path === "string" && entry.path.length > 0)
    .map((entry) => {
      const vector = /\.svg$/i.test(entry.path);
      const pixels = Number(entry.width ?? 0) * Number(entry.height ?? 0);
      return {
        path: entry.path,
        vector,
        // Unknown dimensions on a raster count as "probably fine": the file
        // exists and is a real bitmap, and refusing it for a missing
        // measurement would drop artwork that is in fact large enough.
        pixels: vector ? 0 : pixels > 0 ? pixels : MIN_PIXELS,
      };
    })
    // Raster before vector, then largest first. Google picks the first usable
    // URL, so the best asset must be first in the array.
    .sort((a, b) => (a.vector === b.vector ? b.pixels - a.pixels : a.vector ? 1 : -1));

  return usable.map((entry) => absoluteUrl(entry.path));
}

/**
 * True when the best available image meets Google's 50K-pixel recommendation.
 *
 * Exposed so a caller can LOG the shortfall instead of shipping a sub-standard
 * asset in silence. It is not a filter: see productImageUrls for why a small or
 * vector image still beats no image at all.
 */
export function meetsImageRecommendation(candidates = []) {
  return candidates.some(
    (entry) =>
      entry &&
      !/\.svg$/i.test(String(entry.path ?? "")) &&
      Number(entry.width ?? 0) * Number(entry.height ?? 0) >= 50_000
  );
}
