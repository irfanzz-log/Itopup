/**
 * Indonesian mobile-number prefixes, per operator.
 *
 * Pulsa and data products are sold ONE PRODUCT PER OPERATOR (see
 * PRODUCT_SEED.pulsa in src/config/games.js): the customer picks "Indosat" and
 * that selects the provider SKU. Nothing else in the flow checks that the NUMBER
 * the customer then types actually belongs to that operator, so a customer who
 * picks Indosat and types a Telkomsel number pays for a top-up the provider
 * rejects, or worse, silently delivers to the wrong network.
 *
 * The check happens at checkout, before payment is created.
 *
 * SOURCES: These are the prefixes allocated in Kemkominfo's national numbering
 * plan. Cross-checked against the operators' own published lists (Telkomsel's
 * area-code page, Indosat/IM3 Care, myXL) and the ITU-T E.164 structure for
 * Indonesian mobile numbers.
 *
 * BY.U shares the Telkomsel network but is a separate digital provider with its
 * own prefix range (0851), so it is listed separately from Telkomsel: a by.U
 * number is not a Telkomsel number for product-matching purposes.
 *
 * After the 2022 Indosat–Tri merger both brands still keep separate prefix
 * ranges, so they stay separate here too.
 *
 * Prefixes are stored WITHOUT the leading 0 and WITHOUT the country code, in the
 * form they are compared against: `normalisePhoneId("0857…")` → "0857…" →
 * `phone.slice(1)` → "857". Three digits is enough to disambiguate every
 * operator, and 0851 (by.U) vs 0852/0853 (Telkomsel Kartu As) is the one case
 * where two digits would wrongly collapse two operators into one.
 */
import { normalisePhoneId } from "./input-fields.js";

export const OPERATOR_PREFIXES = {
  telkomsel: ["811", "812", "813", "821", "822", "823", "852", "853"],
  indosat: ["814", "815", "816", "855", "856", "857", "858"],
  xl: ["817", "818", "819", "859", "877", "878"],
  axis: ["831", "832", "833", "838"],
  tri: ["895", "896", "897", "898", "899"],
  smartfren: ["881", "882", "883", "884", "885", "886", "887", "888", "889"],
  byu: ["851"],
};

/**
 * Reverse lookup: which operator does this number belong to?
 *
 * Returns null when the number does not start with a known prefix. That is the
 * signal the checkout check uses, so it distinguishes "wrong operator" (a prefix
 * that belongs to someone else) from "not a mobile number at all" (no prefix
 * match).
 *
 * @param {string} input anything the customer might have typed.
 * @returns {string|null} the operator slug, or null if no prefix matches.
 */
export function operatorOfPhone(input) {
  const local = normalisePhoneId(input);
  if (!local.startsWith("0")) return null;
  const three = local.slice(1, 4);
  for (const [operator, prefixes] of Object.entries(OPERATOR_PREFIXES)) {
    if (prefixes.includes(three)) return operator;
  }
  return null;
}

/**
 * Does this number belong to the operator whose product the customer selected?
 *
 * @param {string} input the number the customer typed.
 * @param {string} operatorSlug the `Product.slug` of the selected operator
 *   (e.g. "indosat"). Null/undefined means the product has no operator, so the
 *   check does not apply and the number is accepted.
 * @returns {boolean}
 */
export function phoneMatchesOperator(input, operatorSlug) {
  if (!operatorSlug) return true;
  const prefixes = OPERATOR_PREFIXES[operatorSlug];
  if (!prefixes) return true; // unknown operator slug: not our problem to police
  return prefixes.includes(normalisePhoneId(input).slice(1, 4));
}

/**
 * The operator name to show the customer in the error message, so the rejection
 * tells them exactly which product they should have picked instead.
 */
export const OPERATOR_DISPLAY_NAME = {
  telkomsel: "Telkomsel",
  indosat: "Indosat",
  xl: "XL",
  axis: "Axis",
  tri: "Tri",
  smartfren: "Smartfren",
  byu: "by.U",
};
