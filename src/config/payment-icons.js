// ============================================================================
// Payment-method icons: client-safe.
//
// WHY THIS FILE IS SPLIT FROM icons.js
//
// icons.js builds the GAME icon map by scanning /public/icons/games, which
// needs node:fs via icons.server.js. TopupForm and PaymentInstructions are
// CLIENT components and import icons.js for paymentIcon()/walletIcon(), so the
// server-only scan leaked into the browser chunk and Turbopack refused to emit
// it: "the chunking context does not support external modules (request:
// node:fs)".
//
// The payment maps are STATIC: no directory scan, no fs, nothing server-only.
// They live here so a client component can resolve a bank or e-wallet logo
// without pulling the game-icon scan into its bundle.
// ============================================================================

/** Base path served by Next.js from /public. */
const ICON_BASE = "/icons";

// `va_permata` → brand `permata`. Permata is the odd one out: Midtrans returns
// its VA number as a top-level `permata_va_number` rather than a `va_numbers`
// array (see src/providers/payment/midtrans/client.js), but the BRAND resolves
// the same way as the other banks.
const BANK_ICONS = {
  bca: "banks/bank-bca.png",
  mandiri: "banks/bank-mandiri.png",
  bni: "banks/bank-bni.png",
  bri: "banks/bank-bri.png",
  permata: "banks/bank-permata.svg",
};

const EWALLET_ICONS = {
  dana: "ewallets/ewallet-dana.png",
  ovo: "ewallets/ewallet-ovo.png",
  gopay: "ewallets/ewallet-gopay.png",
  shopeepay: "ewallets/ewallet-shopee-pay.png",
};

/**
 * Resolve a payment method's logo.
 *
 * @param {string} methodKey the PAYMENT_METHODS key, e.g. `manual_bank_bca`
 * @returns {string|null} the brand's logo, or null for methods with no art
 *   (the generic "bank lainnya" and the gateway methods that are not live yet)
 */
export function paymentIcon(methodKey) {
  const key = String(methodKey ?? "");

  // `manual_bank_bca` → brand `bca`; `va_permata` → brand `permata`.
  const bankBrand = key.match(/_(bca|mandiri|bni|bri|permata)$/)?.[1];
  if (bankBrand && BANK_ICONS[bankBrand]) {
    return `${ICON_BASE}/${BANK_ICONS[bankBrand]}`;
  }

  const walletBrand = key.match(/ewallet_(dana|ovo|gopay|shopeepay)$/)?.[1];
  if (walletBrand && EWALLET_ICONS[walletBrand]) {
    return `${ICON_BASE}/${EWALLET_ICONS[walletBrand]}`;
  }

  // `manual_transfer` is a legacy alias and `manual_bank_lainnya` is the
  // generic fallback; neither has a brand mark. Returning null here is what
  // tells the caller to render its initials instead of a broken image.
  return null;
}

export function walletIcon(wallet) {
  const brand = EWALLET_ICONS[String(wallet ?? "").toLowerCase()];
  return brand ? `${ICON_BASE}/${brand}` : null;
}

export { BANK_ICONS, EWALLET_ICONS };
