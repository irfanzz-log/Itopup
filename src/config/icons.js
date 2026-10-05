// ============================================================================
// Brand icon resolution: one place where a brand meets its artwork.
//
// WHY A MODULE INSTEAD OF LETTING EACH COMPONENT GUESS A PATH
//
// Three different catalogues need brand art: games, pulsa operators, and
// payment methods. Each one keys on something different (game slug,
// product slug, payment method key). Without a single resolver, the mapping
// leaks into a dozen components and they drift apart: one table shows the
// operator logo, another shows the same operator's initials, and neither is
// obviously wrong until a customer screenshots it.
//
// Here, a brand resolves to a path or to null. `null` is an explicit signal to
// the component to fall back to its initials; it is NOT a missing-image bug.
//
// ── WHERE THE FILES LIVE ────────────────────────────────────────────────────
//
// All icons are LOCAL, in /public/icons. They are not hotlinked.
//
// Hotlinking a brand's CDN (Google Play's play-lh, Apple's mzstatic, a bank's
// own asset host) fails three ways: the URL changes the day the publisher
// pushes a new app icon, the host sets a referrer policy that returns a blank
// tile, and it adds a third-party dependency to the checkout page for a
// 4KB image we could have served ourselves. The files are checked in.
//
// ── ARTWORK PROVENANCE ──────────────────────────────────────────────────────
//
// Game icons are the publisher's own app-store artwork (App Store / Play Store
// marketing icons). Bank, e-wallet, and telco logos are the official brand
// marks from the idn-finlogos brand-mark library. Both are brand assets shown
// to identify the brand the customer is choosing, used at small size in a
// product picker, not as part of the site's own identity.
// ============================================================================

import { scanGameIcons } from "./icons.server.js";

/** Base path served by Next.js from /public. */
const ICON_BASE = "/icons";

/**
 * Game slug → icon file. File names are 1:1 with the slug, so adding a game
 * means dropping one file into /public/icons/games; no edit needed here.
 *
 * The map is BUILT from the directory at server-module load: a list kept by
 * hand silently drifts from what is on disk, and a game whose file was never
 * added renders as initials forever. The scan itself lives in
 * src/config/icons.server.js; this module is imported by client components and
 * a raw `node:fs` request in it breaks the browser chunk.
 *
 * CODM's store artwork is a JPEG, the other seeds are PNGs and the Melostore
 * thumbnails are WebP; the extension is whatever the publisher's CDN returned.
 */
const GAME_ICONS = scanGameIcons();

/**
 * Pulsa operator → logo. Keyed on the PRODUCT slug under the `pulsa` game
 * (see PRODUCT_SEED), because the operator IS the product there.
 */
const TELCO_ICONS = {
  telkomsel: "telcos/telco-telkomsel.png",
  // Indosat Ooredoo Hutchison markets to consumers as IM3 / Tri; the library
  // files both brands under their consumer-facing names.
  indosat: "telcos/telco-im3.png",
  xl: "telcos/telco-xl.png",
  axis: "telcos/telco-axis.png",
  tri: "telcos/telco-tri.png",
  smartfren: "telcos/telco-smartfren.png",
  byu: "telcos/telco-by-u.png",
};

/**
 * Payment method key → logo, straight from PAYMENT_METHODS.
 *
 * NOTE the split: the method keys are `manual_bank_bca` / `manual_ewallet_dana`,
 * so the icon is keyed on the BRAND, derived from the key, never the key
 * itself. Two methods from the same brand (a bank transfer and that bank's VA)
 * share one logo, which is correct: they are the same brand to the customer.
 */
/**
 * Resolve a game's icon.
 * @param {string} slug game slug
 * @returns {string|null} a /icons path, or null when no artwork exists
 */
export function gameIcon(slug) {
  return GAME_ICONS[slug] ? `${ICON_BASE}/${GAME_ICONS[slug]}` : null;
}

/**
 * Resolve a pulsa operator's logo from its product slug.
 * @param {string} slug product slug under the `pulsa` game
 * @returns {string|null}
 */
export function telcoIcon(slug) {
  return TELCO_ICONS[slug] ? `${ICON_BASE}/${TELCO_ICONS[slug]}` : null;
}

/**
 * The icon for a product card, which may be a game OR a pulsa operator.
 *
 * A product row carries the game slug; for pulsa, the PRODUCT slug is the
 * operator. This picks the right one without the component having to know
 * which category it is rendering.
 *
 * @param {{ gameSlug?: string|null, productSlug?: string|null }} ident
 * @returns {string|null}
 */
export function productIcon({ gameSlug, productSlug }) {
  // Pulsa first: its products are operators, and a game-level icon would be
  // wrong for every one of them.
  if (productSlug && TELCO_ICONS[productSlug]) return telcoIcon(productSlug);
  if (gameSlug && GAME_ICONS[gameSlug]) return gameIcon(gameSlug);
  return null;
}

// paymentIcon/walletIcon live in payment-icons.js (client-safe; this module
// pulls a node:fs scan). Re-exported so existing imports keep working.
export { paymentIcon, walletIcon, BANK_ICONS, EWALLET_ICONS } from "./payment-icons.js";
export { GAME_ICONS, TELCO_ICONS };
