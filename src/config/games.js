// ============================================================================
// Game / service definitions.
//
// Config-driven on purpose. Adding a game means adding an entry here (and
// running the seed) — NOT scattering `if (game === "ml")` through components.
// Nothing in the UI branches on a game slug; it reads `inputFields` and renders
// whatever the contract says.
//
// `inputFields` uses the presets in ./input-fields.js. A game whose provider
// flow needs a different parameter set simply lists different fields.
// ============================================================================
import { field } from "./input-fields.js";

/** @typedef {{slug:string,name:string,publisher:string,description:string,popular:boolean,
 *             supportsValidation:boolean,sortOrder:number,inputFields:object[]}} GameSeed */

/** @type {GameSeed[]} */
export const GAME_SEED = [
  {
    slug: "mobile-legends",
    name: "Mobile Legends",
    publisher: "Moonton",
    description:
      "Top up Diamond Mobile Legends: Bang Bang secara instan. Cukup masukkan User ID dan Zone ID, tanpa login akun.",
    popular: true,
    // MLBB publishes a dedicated account-validation endpoint on most H2H
    // providers (User ID + Zone ID → nickname). Whether Melostore exposes one
    // is unconfirmed — see src/providers/melostore/README.md.
    supportsValidation: true,
    sortOrder: 1,
    inputFields: [field("userId"), field("zoneId")],
  },
  {
    slug: "pubg-mobile",
    name: "PUBG Mobile",
    publisher: "Level Infinite",
    description:
      "Beli UC PUBG Mobile dengan proses otomatis. Masukkan Player ID tanpa perlu password akun.",
    popular: true,
    supportsValidation: true,
    sortOrder: 2,
    inputFields: [field("playerId", { label: "Player ID" })],
  },
  {
    slug: "free-fire",
    name: "Free Fire",
    publisher: "Garena",
    description:
      "Top up Diamond Free Fire cepat dan aman. Cukup Player ID, tanpa login.",
    popular: true,
    supportsValidation: true,
    sortOrder: 3,
    inputFields: [field("playerId", { label: "Player ID" })],
  },
  {
    slug: "codm",
    name: "Call of Duty Mobile",
    publisher: "Activision",
    description:
      "Isi CP Call of Duty Mobile untuk battle pass dan bundle terbaru.",
    popular: true,
    supportsValidation: false,
    sortOrder: 4,
    inputFields: [field("playerId", { label: "Open ID" })],
  },
  {
    slug: "roblox",
    name: "Roblox",
    publisher: "Roblox Corporation",
    description:
      "Beli Robux Roblox dengan berbagai pilihan nominal dan proses otomatis.",
    popular: true,
    supportsValidation: false,
    sortOrder: 5,
    // Roblox identifies an account by username; the provider may additionally
    // require the region. Confirmed against the provider's product list before
    // enabling validation.
    inputFields: [field("username")],
  },
  {
    slug: "genshin-impact",
    name: "Genshin Impact",
    publisher: "HoYoverse",
    description:
      "Top up Genesis Crystals Genshin Impact. Butuh UID dan Server tempat kamu bermain.",
    popular: true,
    supportsValidation: true,
    sortOrder: 6,
    inputFields: [
      field("userId", { label: "UID", placeholder: "Contoh: 812345678" }),
      field("serverId", {
        label: "Server",
        placeholder: "Contoh: 2001",
        helpText: "Asia 2001 · TW/HK/MO 2002 · Europe 2003 · America 2004.",
      }),
    ],
  },
  {
    // eFootball (PES) — added on request.
    //
    // ⚠️  NOT YET SELLABLE. The provider's inquiry form for this brand is
    // {"target": "Login", "zone": "Password"} — it wants the customer's GAME
    // ACCOUNT PASSWORD to top up. This platform does not collect game passwords,
    // and doing so would make it a credential-handling system with a far larger
    // blast radius than a top-up shop should carry. The game is therefore seeded
    // with `supportsValidation: false` and NO provider links, so the catalogue
    // lists it but checkout refuses with ITP_PRODUCT_UNAVAILABLE instead of
    // quietly asking for a password.
    //
    // To make it sellable, either Melostore exposes a password-free flow for
    // this brand, or a provider that takes a login-free player id is wired up.
    slug: "efootball",
    name: "eFootball",
    publisher: "Konami",
    description:
      "Top up eFootball Coins. Masukkan User ID eFootball Anda — tanpa perlu login akun.",
    popular: false,
    supportsValidation: false,
    sortOrder: 7,
    inputFields: [field("userId", { label: "User ID eFootball" })],
  },
  {
    // ONE game row for every operator, not one row per operator.
    //
    // WHY: the provider exposes pulsa as a SINGLE game_code ("pulsa") whose
    // brands are the operators — see GAME_MAP and PRIMARY_TARGET_FIELD in
    // src/providers/melostore/mapper.js, where the key is literally "pulsa".
    // Seven Game rows would require seven provider game_codes that do not
    // exist, and the adapter would throw on the first one. So the operator is
    // modelled as a Product inside this game.
    slug: "pulsa",
    name: "Pulsa",
    publisher: "Semua Operator",
    description:
      "Isi pulsa semua operator Indonesia — Telkomsel, Indosat, XL, Axis, Tri, Smartfren, dan by.U. Proses otomatis 24 jam.",
    popular: false,
    supportsValidation: false,
    sortOrder: 30,
    inputFields: [field("phoneNumber", { label: "Nomor HP" })],
  },
];

/**
 * Product *types* seeded per game. Each becomes a `Product` row, and the seed
 * creates its nominal `ProductVariant` cards.
 *
 * IMPORTANT: the nominal lists below are DEVELOPMENT PLACEHOLDERS. Real prices
 * and real SKU names must come from the provider (Phase 2 sync) or from admin
 * input — see prisma/seed.js for the explicit warning.
 */
export const PRODUCT_SEED = {
  "mobile-legends": [
    { slug: "diamonds", name: "Diamonds", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "weekly-pass", name: "Weekly Pass", sortOrder: 2, sortMode: "MANUAL" },
    { slug: "twilight-pass", name: "Twilight Pass", sortOrder: 3, sortMode: "MANUAL" },
  ],
  "pubg-mobile": [{ slug: "uc", name: "UC", sortOrder: 1, sortMode: "NOMINAL" }],
  "free-fire": [{ slug: "diamonds", name: "Diamonds", sortOrder: 1, sortMode: "NOMINAL" }],
  codm: [{ slug: "cp", name: "CP", sortOrder: 1, sortMode: "NOMINAL" }],
  roblox: [{ slug: "robux", name: "Robux", sortOrder: 1, sortMode: "NOMINAL" }],
  // eFootball exists in the catalogue but is NOT sellable yet: Melostore's
  // inquiry form for this brand asks for the customer's game Login + Password.
  // See the note on the game entry in GAME_SEED. The nominal ladder below is the
  // provider's real one, seeded inactive so the page lists what exists without
  // offering a purchase we cannot complete safely.
  efootball: [{ slug: "coins", name: "eFootball Coins", sortOrder: 1, sortMode: "NOMINAL" }],
  "genshin-impact": [
    { slug: "genesis-crystals", name: "Genesis Crystals", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "welkin-moon", name: "Blessing of the Welkin Moon", sortOrder: 2, sortMode: "MANUAL" },
  ],
  // One Product per operator. The operator IS the brand in the provider's
  // pricelist, so this is what the provider-sync matcher keys on (see
  // gameSlugByBrandName in src/config/provider-mapping.js).
  pulsa: [
    { slug: "telkomsel", name: "Telkomsel", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "indosat", name: "Indosat Ooredoo", sortOrder: 2, sortMode: "NOMINAL" },
    { slug: "xl", name: "XL Axiata", sortOrder: 3, sortMode: "NOMINAL" },
    { slug: "axis", name: "Axis", sortOrder: 4, sortMode: "NOMINAL" },
    { slug: "tri", name: "Tri (3)", sortOrder: 5, sortMode: "NOMINAL" },
    { slug: "smartfren", name: "Smartfren", sortOrder: 6, sortMode: "NOMINAL" },
    { slug: "byu", name: "by.U", sortOrder: 7, sortMode: "NOMINAL" },
  ],
};

/**
 * Nominal cards per product type.
 *
 * ⚠️  PLACEHOLDER DATA. Every `costPrice` below is a made-up development figure,
 * NOT a Melostore price. Real SKU names and real costs must come from the
 * provider's product list (Phase 2 sync) or from admin input. Until then the
 * admin provider page reports the catalogue as unsynced, and the seed refuses to
 * run against a production database.
 *
 * `sellingPrice` is intentionally omitted: the seed derives it from `costPrice`
 * via sellingPriceFromCost(), so the markup rule lives in ONE place
 * (src/config/pricing.js) instead of being copied into a data file.
 */
export const VARIANT_SEED = {
  "mobile-legends": {
    diamonds: [
      { denomination: 5, costPrice: 1500 }, { denomination: 12, costPrice: 3400 },
      { denomination: 19, costPrice: 5300 }, { denomination: 28, costPrice: 7600 },
      { denomination: 36, costPrice: 9700 }, { denomination: 44, costPrice: 11800 },
      { denomination: 56, costPrice: 14900 }, { denomination: 86, costPrice: 22400 },
      { denomination: 172, costPrice: 44500 }, { denomination: 257, costPrice: 66200 },
      { denomination: 355, costPrice: 91300 }, { denomination: 429, costPrice: 110300 },
      { denomination: 514, costPrice: 132000 }, { denomination: 706, costPrice: 181000 },
      { denomination: 878, costPrice: 225000 }, { denomination: 963, costPrice: 246800 },
      { denomination: 1412, costPrice: 361500 }, { denomination: 2195, costPrice: 561800 },
      { denomination: 2906, costPrice: 743600 }, { denomination: 3688, costPrice: 943500 },
      { denomination: 5532, costPrice: 1414700 }, { denomination: 9288, costPrice: 2374400 },
    ],
    "weekly-pass": [{ name: "Weekly Pass", costPrice: 27900, sortOrder: 1 }],
    "twilight-pass": [{ name: "Twilight Pass", costPrice: 149000, sortOrder: 1 }],
  },
  "pubg-mobile": {
    uc: [
      { denomination: 60, costPrice: 14500 }, { denomination: 325, costPrice: 73000 },
      { denomination: 660, costPrice: 145000 }, { denomination: 1800, costPrice: 390000 },
      { denomination: 3850, costPrice: 780000 }, { denomination: 8100, costPrice: 1560000 },
    ],
  },
  "free-fire": {
    diamonds: [
      { denomination: 5, costPrice: 1400 }, { denomination: 12, costPrice: 3300 },
      { denomination: 50, costPrice: 6600 }, { denomination: 70, costPrice: 9200 },
      { denomination: 140, costPrice: 18300 }, { denomination: 355, costPrice: 45200 },
      { denomination: 720, costPrice: 91000 }, { denomination: 1450, costPrice: 182000 },
      { denomination: 2180, costPrice: 273000 }, { denomination: 3640, costPrice: 455000 },
      { denomination: 7290, costPrice: 909000 },
    ],
  },
  codm: {
    cp: [
      { denomination: 80, costPrice: 14500 }, { denomination: 420, costPrice: 72000 },
      { denomination: 880, costPrice: 145000 }, { denomination: 2400, costPrice: 390000 },
      { denomination: 5000, costPrice: 780000 }, { denomination: 10800, costPrice: 1560000 },
    ],
  },
  // Roblox: only 800/1.700/4.500/10.000 are actually obtainable from Melostore.
  // The provider's live ladder (Roblox (Via Login), active) is 800 / 1.700 /
  // 4.500 / 10.000 Robux; there is NO SKU delivering 80 or 400, so those two
  // cards are deactivated rather than left as buttons that can never be filled.
  roblox: {
    robux: [
      { denomination: 80, costPrice: 14500, isActive: false },
      { denomination: 400, costPrice: 69000, isActive: false },
      { denomination: 800, costPrice: 135000 },
      { denomination: 1700, costPrice: 285000 },
      { denomination: 4500, costPrice: 745000 },
      { denomination: 10000, costPrice: 1640000 },
    ],
  },
  "genshin-impact": {
    // Provider (Genshin Impact (Global)) delivers 60 / 330 / 1090 / 2240 only.
    // 3.280 and 6.480 have no active SKU anywhere on Melostore, so they are
    // deactivated instead of offering a purchase that cannot be fulfilled.
    "genesis-crystals": [
      { denomination: 60, costPrice: 15500 }, { denomination: 300, costPrice: 74000 },
      { denomination: 980, costPrice: 237000 }, { denomination: 1980, costPrice: 470000 },
      { denomination: 3280, costPrice: 780000, isActive: false },
      { denomination: 6480, costPrice: 1540000, isActive: false },
    ],
    "welkin-moon": [{ name: "Blessing of the Welkin Moon", costPrice: 74000, sortOrder: 1 }],
  },
  // eFootball — the provider's real ladder (130 … 12800 Coins), seeded INACTIVE.
  // Real provider costs are filled in by the catalog sync once a password-free
  // flow exists; until then these figures are development placeholders and the
  // variants are not purchasable (isActive: false).
  efootball: {
    coins: [
      { denomination: 130, costPrice: 21200, isActive: false },
      { denomination: 260, costPrice: 21200, isActive: false },
      { denomination: 300, costPrice: 47800, isActive: false },
      { denomination: 550, costPrice: 85000, isActive: false },
      { denomination: 750, costPrice: 115000, isActive: false },
      { denomination: 840, costPrice: 86100, isActive: false },
      { denomination: 1040, costPrice: 154900, isActive: false },
      { denomination: 1630, costPrice: 154900, isActive: false },
      { denomination: 2130, costPrice: 316800, isActive: false },
      { denomination: 3250, costPrice: 474900, isActive: false },
      { denomination: 5700, costPrice: 773700, isActive: false },
      { denomination: 12800, costPrice: 1654200, isActive: false },
    ],
  },
  // Pulsa nominal ladder per operator. Every operator gets the same rungs so the
  // UI is comparable across operators; cost differs slightly per operator, as it
  // does in reality (Telkomsel is the priciest, Tri the cheapest).
  pulsa: {
    telkomsel: [
      { denomination: 5000, costPrice: 6300 }, { denomination: 10000, costPrice: 11300 },
      { denomination: 25000, costPrice: 26300 }, { denomination: 50000, costPrice: 51300 },
      { denomination: 100000, costPrice: 101300 },
    ],
    indosat: [
      { denomination: 5000, costPrice: 6200 }, { denomination: 10000, costPrice: 11100 },
      { denomination: 25000, costPrice: 25900 }, { denomination: 50000, costPrice: 50900 },
      { denomination: 100000, costPrice: 100500 },
    ],
    xl: [
      { denomination: 5000, costPrice: 6200 }, { denomination: 10000, costPrice: 11100 },
      { denomination: 25000, costPrice: 25900 }, { denomination: 50000, costPrice: 50900 },
      { denomination: 100000, costPrice: 100500 },
    ],
    axis: [
      { denomination: 5000, costPrice: 6100 }, { denomination: 10000, costPrice: 11000 },
      { denomination: 25000, costPrice: 25800 }, { denomination: 50000, costPrice: 50800 },
      { denomination: 100000, costPrice: 100400 },
    ],
    tri: [
      { denomination: 5000, costPrice: 6000 }, { denomination: 10000, costPrice: 10900 },
      { denomination: 25000, costPrice: 25700 }, { denomination: 50000, costPrice: 50700 },
      { denomination: 100000, costPrice: 100300 },
    ],
    smartfren: [
      { denomination: 5000, costPrice: 6100 }, { denomination: 10000, costPrice: 11000 },
      { denomination: 25000, costPrice: 25800 }, { denomination: 50000, costPrice: 50800 },
      { denomination: 100000, costPrice: 100400 },
    ],
    byu: [
      { denomination: 5000, costPrice: 6100 }, { denomination: 10000, costPrice: 11000 },
      { denomination: 25000, costPrice: 25800 }, { denomination: 50000, costPrice: 50800 },
      { denomination: 100000, costPrice: 100400 },
    ],
  },
};

/**
 * Resolve a game seed by slug. Returns null (not undefined) so callers can use
 * an explicit `if (game === null)` rather than a falsy check.
 */
export function findGameSeed(slug) {
  return GAME_SEED.find((g) => g.slug === slug) ?? null;
}

/** Slugs that exist as routes, for sitemap generation and static params. */
export function gameSlugs() {
  return GAME_SEED.map((g) => g.slug);
}
