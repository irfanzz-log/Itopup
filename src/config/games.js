// ============================================================================
// Game / service definitions.
//
// Config-driven on purpose. Adding a game means adding an entry here (and
// running the seed)), NOT scattering `if (game === "ml")` through components.
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
    // is unconfirmed; see src/providers/melostore/README.md.
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
    inputFields: [field("email")],
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
    // eFootball (PES).
    //
    // SELLABLE NOW, with the customer's own game login, stored encrypted.
    //
    // The provider's inquiry form for this brand is {"target": "Login",
    // "zone": "Password"} (form key a72a0ff…, brand 2693 "eFootball (PES)"):
    // it asks for the player's OWN account login and password, not a player
    // id. That is why this game is on needsGameLogin: the secret half of the
    // login is encrypted at rest (see src/lib/crypto.js + GameCredential) and
    // only ever held in memory for the one provider call that needs it.
    //
    // The platform therefore never asks for a credential it cannot use, and it
    // never asks for a free-form "User ID" it would then fail to dispatch:
    // the catalogue now describes exactly what the provider requires.
    slug: "efootball",
    name: "eFootball",
    publisher: "Konami",
    description:
      "Top up eFootball Coins. Masukkan login akun eFootball Anda (email/ID + password). Data diamankan dengan enkripsi.",
    popular: false,
    supportsValidation: false,
    needsGameLogin: true,
    sortOrder: 7,
    inputFields: [field("gameLogin"), field("gamePassword")],
  },
  {
    // ONE game row for every operator, not one row per operator.
    //
    // WHY: the provider exposes pulsa as a SINGLE game_code ("pulsa") whose
    // brands are the operators; see GAME_MAP and PRIMARY_TARGET_FIELD in
    // src/providers/melostore/mapper.js, where the key is literally "pulsa".
    // Seven Game rows would require seven provider game_codes that do not
    // exist, and the adapter would throw on the first one. So the operator is
    // modelled as a Product inside this game.
    slug: "pulsa",
    name: "Pulsa",
    publisher: "Semua Operator",
    description:
      "Isi pulsa semua operator Indonesia: Telkomsel, Indosat, XL, Axis, Tri, Smartfren, dan by.U. Proses otomatis 24 jam.",
    popular: false,
    supportsValidation: false,
    sortOrder: 30,
    inputFields: [field("phoneNumber", { label: "Nomor HP" })],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Indonesia-only ladders, imported from the provider's pricelist
  // (h2h_pricelist_2026-10-04.xlsx). Every brand below carries an (ID) /
  // (Indonesia) marker in the provider's Brand column, i.e. it is the ladder
  // that delivers to an Indonesian account. Global ladders (e.g. "Free Fire
  // (Global)") are deliberately NOT here — selling a global card to an ID
  // account delivers the wrong region.
  //
  // One Game per game; brands that sell the same currency on two ladders
  // ("Valorant (ID)" + "Valorant (Indonesia)", "Wild Rift (ID)" +
  // "League of Legends: Wild Rift (ID)", the two Razer Gold brands, the two LoL
  // brands) are merged into a single game and the SKU rules in
  // provider-mapping.js point each ladder at the same variants.
  //
  // ⚠️  costPrice values are the CHEAPEST ACTIVE SKU on that pricelist, i.e.
  // real provider cost — not placeholders. sellingPrice is derived at seed time
  // by prisma/seed.js via sellingPriceFromCost().
  {
    slug: "8-ball-pool",
    name: "8 Ball Pool",
    publisher: "Miniclip",
    description: "Top up Coins dan Cash 8 Ball Pool. Masukkan Player ID untuk proses instan.",
    popular: false,
    supportsValidation: false,
    sortOrder: 21,
    inputFields: [field("playerId")],
  },
  {
    slug: "apex-legends-mobile",
    name: "Apex Legends Mobile",
    publisher: "EA",
    description: "Top up Syndicate Gold Apex Legends Mobile (ID). Masukkan Player ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 22,
    inputFields: [field("playerId")],
  },
  {
    slug: "arena-of-valor",
    name: "Arena of Valor",
    publisher: "TiMi Studio",
    description: "Top up Voucher Arena of Valor (ID). Masukkan User ID dan Zone ID.",
    popular: false,
    supportsValidation: true,
    sortOrder: 23,
    inputFields: [field("userId"), field("zoneId")],
  },
  {
    slug: "battlenet-gift-card",
    name: "Battle.net Gift Card",
    publisher: "Blizzard",
    description: "Voucher Battle.net IDR untuk game Blizzard. Masukkan email akun Battle.net tujuan.",
    popular: false,
    supportsValidation: false,
    sortOrder: 24,
    inputFields: [field("email")],
  },
  {
    slug: "dead-target",
    name: "Dead Target",
    publisher: "VNG",
    description: "Top up Diamond, Gold, dan Cash Dead Target (ID). Masukkan Player ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 25,
    inputFields: [field("playerId")],
  },
  {
    slug: "dunk-city-dynasty",
    name: "Dunk City Dynasty",
    publisher: "Habby",
    description: "Top up Tokens Dunk City Dynasty (ID). Masukkan Player ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 26,
    inputFields: [field("playerId")],
  },
  {
    slug: "eafc-mobile",
    name: "EAFC Mobile",
    publisher: "EA",
    description: "Top up FC Points dan Silver EAFC Mobile (ID). Masukkan Player ID atau EA Account ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 27,
    inputFields: [field("playerId")],
  },
  {
    slug: "garena-shells",
    name: "Garena Shells",
    publisher: "Garena",
    description: "Top up Shells Garena (ID) untuk semua game Garena. Masukkan email akun Garena kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 28,
    inputFields: [field("email")],
  },
  {
    slug: "garena-undawn",
    name: "Undawn",
    publisher: "Level Infinite",
    description: "Top up RC, Kartu Mingguan, dan Glory Pass Undawn (ID). Masukkan Player ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 29,
    inputFields: [field("playerId")],
  },
  {
    slug: "google-play",
    name: "Google Play",
    publisher: "Google",
    description: "Voucher Google Play IDR. Masukkan email akun Google Play tujuan.",
    popular: false,
    supportsValidation: false,
    sortOrder: 30,
    inputFields: [field("email")],
  },
  {
    slug: "honkai-star-rail",
    name: "Honkai: Star Rail",
    publisher: "HoYoverse",
    description: "Top up Oneiric Shard Honkai: Star Rail. Butuh UID dan Server.",
    popular: false,
    supportsValidation: true,
    sortOrder: 31,
    inputFields: [field("userId"), field("serverId")],
  },
  {
    slug: "league-of-legends",
    name: "League of Legends",
    publisher: "Riot Games",
    description: "Top up RP League of Legends (ID). Masukkan Riot ID akun LoL kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 32,
    inputFields: [field("riotId")],
  },
  {
    slug: "wild-rift",
    name: "Wild Rift",
    publisher: "Riot Games",
    description: "Top up Wild Cores League of Legends: Wild Rift (ID). Masukkan Riot ID kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 33,
    inputFields: [field("riotId")],
  },
  {
    slug: "legends-of-runeterra",
    name: "Legends of Runeterra",
    publisher: "Riot Games",
    description: "Top up Coins Legends of Runeterra (ID). Masukkan Riot ID kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 34,
    inputFields: [field("riotId")],
  },
  {
    slug: "magic-chess-go-go",
    name: "Magic Chess Go Go",
    publisher: "Moonton",
    description: "Top up Diamond Magic Chess Go Go (ID). Masukkan User ID dan Zone ID.",
    popular: false,
    supportsValidation: true,
    sortOrder: 35,
    inputFields: [field("userId"), field("zoneId")],
  },
  {
    slug: "point-blank",
    name: "Point Blank",
    publisher: "Zepetto",
    description: "Top up PB Cash Point Blank (ID). Masukkan ID Point Blank.",
    popular: false,
    supportsValidation: false,
    sortOrder: 36,
    inputFields: [field("playerId")],
  },
  {
    slug: "pokemon-unite",
    name: "Pokémon UNITE",
    publisher: "TiMi Studio",
    description: "Top up Aeos Gems Pokémon UNITE (ID). Masukkan Trainer ID atau Player ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 37,
    inputFields: [field("playerId")],
  },
  {
    slug: "rainbow-six-mobile",
    name: "Rainbow Six Mobile",
    publisher: "Ubisoft",
    description: "Top up Platinum Rainbow Six Mobile (ID). Masukkan Player ID atau Ubisoft Connect ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 38,
    inputFields: [field("playerId")],
  },
  {
    slug: "razer-gold",
    name: "Razer Gold",
    publisher: "Razer",
    description: "Voucher Razer Gold IDR untuk semua game yang menerima Razer Gold. Masukkan email akun Razer tujuan.",
    popular: false,
    supportsValidation: false,
    sortOrder: 39,
    inputFields: [field("email")],
  },
  {
    slug: "tft-mobile",
    name: "Teamfight Tactics",
    publisher: "Riot Games",
    description: "Top up TFT Coins Teamfight Tactics (ID). Masukkan Riot ID kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 40,
    inputFields: [field("riotId")],
  },
  {
    slug: "the-moonlit-oath",
    name: "The Moonlit Oath",
    publisher: "FooRid",
    description: "Top up Ingot The Moonlit Oath (ID). Masukkan Player ID atau Character ID.",
    popular: false,
    supportsValidation: false,
    sortOrder: 41,
    inputFields: [field("playerId")],
  },
  {
    slug: "tiktok-gift-card",
    name: "TikTok Gift Card",
    publisher: "TikTok",
    description: "Voucher TikTok IDR untuk top up koin TikTok. Masukkan email akun TikTok kamu.",
    popular: false,
    supportsValidation: false,
    sortOrder: 42,
    inputFields: [field("email")],
  },
  {
    slug: "unipin-gift-card",
    name: "Unipin Voucher",
    publisher: "Unipin",
    description: "Voucher Unipin IDR untuk ratusan game. Masukkan email akun Unipin tujuan.",
    popular: false,
    supportsValidation: false,
    sortOrder: 43,
    inputFields: [field("email")],
  },
  {
    slug: "valorant",
    name: "Valorant",
    publisher: "Riot Games",
    description: "Top up VP Valorant (ID). Masukkan Riot ID akun Valorant kamu.",
    popular: true,
    supportsValidation: false,
    sortOrder: 44,
    inputFields: [field("riotId")],
  },
  {
    slug: "zenless-zone-zero",
    name: "Zenless Zone Zero",
    publisher: "HoYoverse",
    description: "Top up Monochromes ZZZ. Butuh UID dan Server.",
    popular: false,
    supportsValidation: true,
    sortOrder: 45,
    inputFields: [field("userId"), field("serverId")],
  },];

/**
 * Product *types* seeded per game. Each becomes a `Product` row, and the seed
 * creates its nominal `ProductVariant` cards.
 *
 * IMPORTANT: the nominal lists below are DEVELOPMENT PLACEHOLDERS. Real prices
 * and real SKU names must come from the provider (Phase 2 sync) or from admin
 * input; see prisma/seed.js for the explicit warning.
 */
export const PRODUCT_SEED = {
  "mobile-legends": [
    { slug: "diamonds", name: "Diamonds", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "weekly-pass", name: "Weekly Pass", sortOrder: 2, sortMode: "MANUAL" },
    { slug: "twilight-pass", name: "Twilight Pass", sortOrder: 3, sortMode: "MANUAL" },
  ],
  "pubg-mobile": [{ slug: "uc", name: "UC", sortOrder: 1, sortMode: "NOMINAL" }],
  "free-fire": [{ slug: "diamond", name: "Diamond", sortOrder: 1, sortMode: "NOMINAL" }],
  // CODM is sold by the provider in two region ladders, "Call Of Duty Mobile"
  // (global, brand 23) and "Call of Duty: Mobile (Indonesia ID)" (brand 864/23-ID).
  // They are separate SKUs at separate prices and the region is part of what the
  // customer is buying, so it is a Product, not a variant attribute. Keeping them
  // as two games instead would be two pages selling the same currency.
  codm: [
    { slug: "cp-global", name: "CP (Global)", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "cp-id", name: "CP (Indonesia)", sortOrder: 2, sortMode: "NOMINAL" },
  ],
  roblox: [{ slug: "robux", name: "Robux", sortOrder: 1, sortMode: "NOMINAL" }],
  // eFootball. The provider sells this as TWO ladders, one per platform:
  // "130 Coins (IOS)" and "130 Coins (Android)" are distinct SKUs with distinct
  // prices (see the notes in VARIANT_SEED), so the platform is a Product, not a
  // variant attribute. A variant key would silently deliver the wrong platform.
  efootball: [
    { slug: "coins-ios", name: "eFootball Coins (iOS)", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "coins-android", name: "eFootball Coins (Android)", sortOrder: 2, sortMode: "NOMINAL" },
  ],
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

  // ── Indonesia-only ladders (see GAME_SEED) ──────────────────────────────
  "8-ball-pool": [
    { slug: "coins", name: "Coins", sortOrder: 1, sortMode: "MANUAL" },
    { slug: "voucher", name: "Voucher", sortOrder: 2, sortMode: "MANUAL" },
  ],
  "apex-legends-mobile": [
    { slug: "syndicate-gold", name: "Syndicate Gold", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "arena-of-valor": [
    { slug: "vouchers", name: "Vouchers", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "battlenet-gift-card": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "dead-target": [
    { slug: "diamonds", name: "Diamonds", sortOrder: 1, sortMode: "MANUAL" },
    { slug: "gold", name: "Gold", sortOrder: 2, sortMode: "MANUAL" },
    { slug: "cash", name: "Cash", sortOrder: 3, sortMode: "MANUAL" },
    { slug: "passes", name: "Passes & Packs", sortOrder: 4, sortMode: "MANUAL" },
  ],
  "dunk-city-dynasty": [
    { slug: "tokens", name: "Tokens", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "eafc-mobile": [
    { slug: "points", name: "Points", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "silver", name: "Silver", sortOrder: 2, sortMode: "NOMINAL" },
  ],
  "garena-shells": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "garena-undawn": [
    { slug: "rc", name: "RC", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "passes", name: "Passes & Memberships", sortOrder: 2, sortMode: "MANUAL" },
  ],
  "google-play": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "honkai-star-rail": [
    { slug: "oneiric-shards", name: "Oneiric Shards", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "passes", name: "Passes & Memberships", sortOrder: 2, sortMode: "MANUAL" },
  ],
  "league-of-legends": [
    { slug: "575-rp", name: "575 RP", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "1380-rp", name: "1380 RP", sortOrder: 2, sortMode: "NOMINAL" },
    { slug: "2800-rp", name: "2800 RP", sortOrder: 3, sortMode: "NOMINAL" },
    { slug: "4500-rp", name: "4500 RP", sortOrder: 4, sortMode: "NOMINAL" },
    { slug: "6500-rp", name: "6500 RP", sortOrder: 5, sortMode: "NOMINAL" },
    { slug: "13500-rp", name: "13500 RP", sortOrder: 6, sortMode: "NOMINAL" },
    { slug: "voucher", name: "Voucher", sortOrder: 7, sortMode: "NOMINAL" },
  ],
  "wild-rift": [
    { slug: "wild-cores", name: "Wild Cores", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "legends-of-runeterra": [
    { slug: "coins", name: "Coins", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "magic-chess-go-go": [
    { slug: "diamonds", name: "Diamonds", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "point-blank": [
    { slug: "points", name: "Points", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "pokemon-unite": [
    { slug: "aeos-gems", name: "Aeos Gems", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "rainbow-six-mobile": [
    { slug: "platinum", name: "Platinum", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "razer-gold": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "tft-mobile": [
    { slug: "coins", name: "Coins", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "the-moonlit-oath": [
    { slug: "ingots", name: "Ingots", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "tiktok-gift-card": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "unipin-gift-card": [
    { slug: "voucher", name: "Voucher", sortOrder: 1, sortMode: "NOMINAL" },
  ],
  "valorant": [
    { slug: "vp", name: "VP", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "points", name: "Points", sortOrder: 2, sortMode: "NOMINAL" },
  ],
  "zenless-zone-zero": [
    { slug: "monochromes", name: "Monochromes", sortOrder: 1, sortMode: "NOMINAL" },
    { slug: "passes", name: "Passes & Memberships", sortOrder: 2, sortMode: "MANUAL" },
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
      // Extra rungs the provider stocks; linked in provider-mapping.js. Costs
      // are the cheapest ACTIVE card on the 2026-09-25 pricelist.
      { denomination: 10, costPrice: 2936 }, { denomination: 33, costPrice: 9112 },
      { denomination: 59, costPrice: 17011 }, { denomination: 74, costPrice: 20605 },
      { denomination: 85, costPrice: 24707 }, { denomination: 113, costPrice: 32853 },
      { denomination: 170, costPrice: 49368 }, { denomination: 184, costPrice: 51510 },
      { denomination: 222, costPrice: 65202 }, { denomination: 240, costPrice: 68792 },
      { denomination: 284, costPrice: 82911 }, { denomination: 296, costPrice: 82056 },
      { denomination: 345, costPrice: 101181 }, { denomination: 408, costPrice: 116327 },
      { denomination: 568, costPrice: 158441 }, { denomination: 716, costPrice: 201143 },
      { denomination: 750, costPrice: 212691 }, { denomination: 758, costPrice: 203654 },
      { denomination: 875, costPrice: 242376 }, { denomination: 1050, costPrice: 292640 },
      { denomination: 1134, costPrice: 316416 }, { denomination: 1159, costPrice: 324180 },
      { denomination: 1220, costPrice: 340724 }, { denomination: 1704, costPrice: 483835 },
      { denomination: 2010, costPrice: 507281 }, { denomination: 2199, costPrice: 612753 },
      { denomination: 2904, costPrice: 777093 }, { denomination: 4026, costPrice: 1016779 },
      { denomination: 4830, costPrice: 1266417 },
    ],
    "weekly-pass": [{ name: "Weekly Pass", costPrice: 27900, sortOrder: 1 }],
    "twilight-pass": [{ name: "Twilight Pass", costPrice: 149000, sortOrder: 1 }],
  },
  "pubg-mobile": {
    uc: [
      { denomination: 30, costPrice: 6998 },
      { denomination: 60, costPrice: 15252 },
      { denomination: 120, costPrice: 32923 },
      { denomination: 180, costPrice: 49384 },
      { denomination: 210, costPrice: 67039 },
      { denomination: 240, costPrice: 65464 },
      { denomination: 325, costPrice: 75809 },
      { denomination: 385, costPrice: 98826 },
      { denomination: 445, costPrice: 115191 },
      { denomination: 475, costPrice: 115682 },
      { denomination: 505, costPrice: 132627 },
      { denomination: 565, costPrice: 147923 },
      { denomination: 660, costPrice: 150693 },
      { denomination: 720, costPrice: 181417 },
      { denomination: 780, costPrice: 197799 },
      { denomination: 810, costPrice: 218245 },
      { denomination: 840, costPrice: 212770 },
      { denomination: 900, costPrice: 229042 },
      { denomination: 985, costPrice: 238927 },
      { denomination: 1105, costPrice: 278479 },
      { denomination: 1165, costPrice: 294750 },
      { denomination: 1320, costPrice: 327438 },
      { denomination: 1440, costPrice: 359931 },
      { denomination: 1500, costPrice: 376177 },
      { denomination: 1800, costPrice: 376158 },
      { denomination: 1920, costPrice: 442192 },
      { denomination: 1980, costPrice: 458440 },
      { denomination: 2125, costPrice: 491559 },
      { denomination: 2460, costPrice: 573416 },
      { denomination: 2785, costPrice: 655276 },
      { denomination: 3120, costPrice: 737134 },
      { denomination: 3850, costPrice: 752356 },
      { denomination: 4030, costPrice: 880796 },
      { denomination: 4035, costPrice: 868135 },
      { denomination: 4175, costPrice: 901254 },
      { denomination: 4510, costPrice: 978294 },
      { denomination: 4835, costPrice: 1059751 },
      { denomination: 5170, costPrice: 1141208 },
      { denomination: 5650, costPrice: 1223067 },
      { denomination: 5975, costPrice: 1216330 },
      { denomination: 6310, costPrice: 1392810 },
      { denomination: 6635, costPrice: 1474670 },
      { denomination: 6970, costPrice: 1556528 },
      { denomination: 8100, costPrice: 1504711 },
      { denomination: 11950, costPrice: 2446310 },
      { denomination: 16200, costPrice: 3261864 },
      { denomination: 24300, costPrice: 4892795 },
      { denomination: 32400, costPrice: 6523727 },
    ],
  },
  "free-fire": {
    diamonds: [
      { denomination: 5, costPrice: 882 },
      { denomination: 10, costPrice: 2027 },
      { denomination: 12, costPrice: 1851 },
      { denomination: 20, costPrice: 3976 },
      { denomination: 25, costPrice: 4924 },
      { denomination: 30, costPrice: 5871 },
      { denomination: 50, costPrice: 7539 },
      { denomination: 55, costPrice: 8713 },
      { denomination: 70, costPrice: 8802 },
      { denomination: 80, costPrice: 11948 },
      { denomination: 100, costPrice: 15804 },
      { denomination: 120, costPrice: 17732 },
      { denomination: 130, costPrice: 19869 },
      { denomination: 140, costPrice: 18546 },
      { denomination: 145, costPrice: 20832 },
      { denomination: 150, costPrice: 21796 },
      { denomination: 190, costPrice: 27581 },
      { denomination: 200, costPrice: 29509 },
      { denomination: 210, costPrice: 29509 },
      { denomination: 280, costPrice: 39528 },
      { denomination: 355, costPrice: 44785 },
      { denomination: 500, costPrice: 69782 },
      { denomination: 510, costPrice: 71699 },
      { denomination: 565, costPrice: 78596 },
      { denomination: 635, costPrice: 88369 },
      { denomination: 720, costPrice: 89051 },
      { denomination: 800, costPrice: 110037 },
      { denomination: 860, costPrice: 117893 },
      { denomination: 930, costPrice: 127666 },
      { denomination: 1050, costPrice: 145312 },
      { denomination: 1075, costPrice: 147418 },
      { denomination: 1080, costPrice: 148376 },
      { denomination: 1450, costPrice: 177065 },
      { denomination: 2180, costPrice: 265595 },
      { denomination: 2200, costPrice: 300930 },
      { denomination: 3640, costPrice: 442011 },
      { denomination: 7290, costPrice: 885789 },
    ],
  },
  codm: {
    // Region GLOBAL, brand "Call Of Duty Mobile". Delivered amount includes the
    // provider's bonus (e.g. "80 + 8 CP" delivers 88), so denomination is the
    // TOTAL the customer receives, not the headline number on the card.
    "cp-global": [
      { denomination: 31, costPrice: 4302 },
      { denomination: 63, costPrice: 8455 },
      { denomination: 128, costPrice: 17123 },
      { denomination: 321, costPrice: 43772 },
      { denomination: 384, costPrice: 56097 },
      { denomination: 645, costPrice: 85087 },
      { denomination: 800, costPrice: 102099 },
      { denomination: 965, costPrice: 140285 },
      { denomination: 1373, costPrice: 169157 },
      { denomination: 1584, costPrice: 200794 },
      { denomination: 2059, costPrice: 260957 },
      { denomination: 2750, costPrice: 320905 },
      { denomination: 3564, costPrice: 422235 },
      { denomination: 5618, costPrice: 616449 },
      { denomination: 7656, costPrice: 844442 },
      { denomination: 11190, costPrice: 1392768 },
      { denomination: 15312, costPrice: 1688939 },
      { denomination: 38280, costPrice: 4309164 },
      { denomination: 76560, costPrice: 8618327 },
    ],
    // Region INDONESIA, brand "Call of Duty: Mobile (Indonesia ID)". Roughly
    // 3-13% above the global ladder; the customer pays for a guaranteed
    // Indonesia-region delivery. No 965/1584/11190 rungs on this ladder.
    "cp-id": [
      { denomination: 31, costPrice: 4434 },
      { denomination: 63, costPrice: 9606 },
      { denomination: 128, costPrice: 19361 },
      { denomination: 321, costPrice: 48495 },
      { denomination: 645, costPrice: 96427 },
      { denomination: 800, costPrice: 107639 },
      { denomination: 1373, costPrice: 191545 },
      { denomination: 2060, costPrice: 287411 },
      { denomination: 2750, costPrice: 338564 },
      { denomination: 3564, costPrice: 478256 },
      { denomination: 5618, costPrice: 648001 },
      { denomination: 7656, costPrice: 956325 },
      { denomination: 15312, costPrice: 1775368 },
      { denomination: 38280, costPrice: 4438602 },
      { denomination: 76560, costPrice: 8877203 },
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
  // eFootball Coins: the provider's real per-platform ladder.
  //
  // iOS and Android are SEPARATE SKUs at separate costs (Melostore `eppes*`,
  // brand 2693), verified against the live pricelist:
  //
  //   coins   iOS (eppes<N>c-s11)     Android (eppes<N>c-s11a)
  //     130       21.302                  22.056
  //     260       21.302 *                22.056 *
  //     300       48.070                  49.955
  //     550       85.461                  89.024
  //     750      115.636                 120.883
  //     840       86.586 *                89.024 *
  //    1040      155.769                 160.985
  //    1630      155.769 *               163.035 *
  //    2130      318.522                 325.964
  //    3250      477.597                     -
  //    5700      778.070                 810.442
  //   12800    1.663.490                1.729.538
  //
  // * provider name delivers a bonus ("130+130"), the SKU is a different card;
  //   cost kept because it is the cheapest ACTIVE card at that amount.
  //
  // 3250 Coins is iOS-only on Melostore; there is no Android SKU, so it is
  // absent from the Android ladder rather than offered as a purchase that
  // cannot be fulfilled (the same rule the Roblox/Genshin ladders apply).
  efootball: {
    "coins-ios": [
      { denomination: 130, costPrice: 21302 },
      { denomination: 260, costPrice: 21302 },
      { denomination: 300, costPrice: 48070 },
      { denomination: 550, costPrice: 85461 },
      { denomination: 750, costPrice: 115636 },
      { denomination: 840, costPrice: 86586 },
      { denomination: 1040, costPrice: 155769 },
      { denomination: 1630, costPrice: 155769 },
      { denomination: 2130, costPrice: 318522 },
      { denomination: 3250, costPrice: 477597 },
      { denomination: 5700, costPrice: 778070 },
      { denomination: 12800, costPrice: 1663490 },
    ],
    "coins-android": [
      { denomination: 130, costPrice: 22056 },
      { denomination: 260, costPrice: 22056 },
      { denomination: 300, costPrice: 49955 },
      { denomination: 550, costPrice: 89024 },
      { denomination: 750, costPrice: 120883 },
      { denomination: 840, costPrice: 89024 },
      { denomination: 1040, costPrice: 160985 },
      { denomination: 1630, costPrice: 163035 },
      { denomination: 2130, costPrice: 325964 },
      { denomination: 5700, costPrice: 810442 },
      { denomination: 12800, costPrice: 1729538 },
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



  // ── Indonesia-only ladders: cheapest ACTIVE SKU on the 2026-10-04 pricelist ─
  "8-ball-pool": {
    "coins": [
      { slug: "heap-of-coins", name: "Heap of Coins", costPrice: 0, sortOrder: 1 },
      { slug: "pile-of-coins", name: "Pile of Coins", costPrice: 0, sortOrder: 2 },
      { slug: "stack-of-coins", name: "Stack of Coins", costPrice: 0, sortOrder: 3 },
      { slug: "stash-of-coins", name: "Stash of Coins", costPrice: 0, sortOrder: 4 },
      { slug: "vault-of-coins", name: "Vault of Coins", costPrice: 0, sortOrder: 5 },
      { slug: "wallet-of-coins", name: "Wallet of Coins", costPrice: 0, sortOrder: 6 },
    ],
    "voucher": [
      { slug: "elite-pool-pass", name: "Elite Pool Pass", costPrice: 0, sortOrder: 1 },
      { slug: "heap-of-cash", name: "Heap of Cash", costPrice: 0, sortOrder: 2 },
      { slug: "pile-of-cash", name: "Pile of Cash", costPrice: 0, sortOrder: 3 },
      { slug: "premium-pool-pass", name: "Premium Pool Pass", costPrice: 0, sortOrder: 4 },
      { slug: "stack-of-cash", name: "Stack of Cash", costPrice: 0, sortOrder: 5 },
      { slug: "stash-of-cash", name: "Stash of Cash", costPrice: 0, sortOrder: 6 },
      { slug: "vault-of-cash", name: "Vault of Cash", costPrice: 0, sortOrder: 7 },
      { slug: "wallet-of-cash", name: "Wallet of Cash", costPrice: 0, sortOrder: 8 },
    ],
  },
  "apex-legends-mobile": {
    "syndicate-gold": [
      { slug: "d90", denomination: 90, unit: "Syndicate Gold", costPrice: 15857 },
      { slug: "d280", denomination: 280, unit: "Syndicate Gold", costPrice: 34687 },
      { slug: "d500", denomination: 500, unit: "Syndicate Gold", costPrice: 64045 },
      { slug: "d1050", denomination: 1050, unit: "Syndicate Gold", costPrice: 127105 },
      { slug: "d2150", denomination: 2150, unit: "Syndicate Gold", costPrice: 253711 },
      { slug: "d2750", denomination: 2750, unit: "Syndicate Gold", costPrice: 302689 },
      { slug: "d5650", denomination: 5650, unit: "Syndicate Gold", costPrice: 615252 },
      { slug: "d11500", denomination: 11500, unit: "Syndicate Gold", costPrice: 1221699 },
      { slug: "d23500", denomination: 23500, unit: "Syndicate Gold", costPrice: 2444377 },
    ],
  },
  "arena-of-valor": {
    "vouchers": [
      { slug: "d40", denomination: 40, unit: "Vouchers", costPrice: 8776 },
      { slug: "d90", denomination: 90, unit: "Vouchers", costPrice: 17859 },
      { slug: "d230", denomination: 230, unit: "Vouchers", costPrice: 44643 },
      { slug: "d470", denomination: 470, unit: "Vouchers", costPrice: 88770 },
      { slug: "d950", denomination: 950, unit: "Vouchers", costPrice: 176507 },
      { slug: "d1430", denomination: 1430, unit: "Vouchers", costPrice: 264759 },
      { slug: "d2390", denomination: 2390, unit: "Vouchers", costPrice: 440620 },
      { slug: "d4800", denomination: 4800, unit: "Vouchers", costPrice: 890050 },
      { slug: "d24050", denomination: 24050, unit: "Vouchers", costPrice: 4441430 },
      { slug: "d48200", denomination: 48200, unit: "Vouchers", costPrice: 8900484 },
    ],
  },
  "battlenet-gift-card": {
    "voucher": [
      { slug: "d75000", denomination: 75000, unit: "IDR", costPrice: 85078 },
      { slug: "d150000", denomination: 150000, unit: "IDR", costPrice: 169356 },
      { slug: "d300000", denomination: 300000, unit: "IDR", costPrice: 0 },
    ],
  },
  "dead-target": {
    "diamonds": [
      { slug: "red-diamond-big-pack", name: "Red Diamond Big Pack", costPrice: 0, sortOrder: 1 },
      { slug: "red-diamond-medium-pack", name: "Red Diamond Medium Pack", costPrice: 0, sortOrder: 2 },
      { slug: "red-diamond-mystic-pack", name: "Red Diamond Mystic Pack", costPrice: 0, sortOrder: 3 },
      { slug: "red-diamond-royale-pack", name: "Red Diamond Royale Pack", costPrice: 0, sortOrder: 4 },
      { slug: "red-diamond-value-pack", name: "Red Diamond Value Pack", costPrice: 0, sortOrder: 5 },
    ],
    "gold": [
      { slug: "large-gold-pack", name: "LARGE GOLD PACK", costPrice: 0, sortOrder: 1 },
      { slug: "low-price-gold", name: "LOW PRICE - GOLD", costPrice: 0, sortOrder: 2 },
      { slug: "medium-gold-pack", name: "MEDIUM GOLD PACK", costPrice: 0, sortOrder: 3 },
      { slug: "tiny-gold-pack", name: "TINY GOLD PACK", costPrice: 0, sortOrder: 4 },
    ],
    "cash": [
      { slug: "large-cash-pack", name: "LARGE CASH PACK", costPrice: 0, sortOrder: 1 },
      { slug: "low-price-cash", name: "LOW PRICE - CASH", costPrice: 0, sortOrder: 2 },
      { slug: "medium-cash-pack", name: "MEDIUM CASH PACK", costPrice: 0, sortOrder: 3 },
      { slug: "tiny-cash-pack", name: "TINY CASH PACK", costPrice: 0, sortOrder: 4 },
    ],
    "passes": [
      { slug: "battle-pass", name: "Battle Pass", costPrice: 0, sortOrder: 1 },
      { slug: "battle-pass-plus", name: "Battle Pass Plus", costPrice: 0, sortOrder: 2 },
    ],
  },
  "dunk-city-dynasty": {
    "tokens": [
      { slug: "d60", denomination: 60, unit: "Tokens", costPrice: 15244 },
      { slug: "d330", denomination: 330, unit: "Tokens", costPrice: 77426 },
      { slug: "d1110", denomination: 1110, unit: "Tokens", costPrice: 230968 },
      { slug: "d2280", denomination: 2280, unit: "Tokens", costPrice: 462176 },
      { slug: "d3880", denomination: 3880, unit: "Tokens", costPrice: 770582 },
      { slug: "d8110", denomination: 8110, unit: "Tokens", costPrice: 1537504 },
    ],
  },
  "eafc-mobile": {
    "points": [
      { slug: "d40", denomination: 40, unit: "Points", costPrice: 6286 },
      { slug: "d100", denomination: 100, unit: "Points", costPrice: 15989 },
      { slug: "d520", denomination: 520, unit: "Points", costPrice: 78353 },
      { slug: "d1070", denomination: 1070, unit: "Points", costPrice: 156723 },
      { slug: "d2200", denomination: 2200, unit: "Points", costPrice: 323568 },
      { slug: "d5750", denomination: 5750, unit: "Points", costPrice: 785992 },
      { slug: "d12000", denomination: 12000, unit: "Points", costPrice: 1573097 },
    ],
    "silver": [
      { slug: "d39", denomination: 39, unit: "Silver", costPrice: 6286 },
      { slug: "d99", denomination: 99, unit: "Silver", costPrice: 15989 },
      { slug: "d499", denomination: 499, unit: "Silver", costPrice: 78353 },
      { slug: "d999", denomination: 999, unit: "Silver", costPrice: 156723 },
      { slug: "d1999", denomination: 1999, unit: "Silver", costPrice: 323568 },
      { slug: "d4999", denomination: 4999, unit: "Silver", costPrice: 785992 },
      { slug: "d9999", denomination: 9999, unit: "Silver", costPrice: 1573097 },
    ],
  },
  "garena-shells": {
    "voucher": [
      { slug: "d66", denomination: 66, unit: "IDR", costPrice: 19374 },
      { slug: "d165", denomination: 165, unit: "IDR", costPrice: 48339 },
      { slug: "d330", denomination: 330, unit: "IDR", costPrice: 96118 },
    ],
  },
  "garena-undawn": {
    "rc": [
      { slug: "d1", denomination: 1, unit: "RC", costPrice: 375240 },
      { slug: "d2", denomination: 2, unit: "RC", costPrice: 563497 },
      { slug: "d4", denomination: 4, unit: "RC", costPrice: 939969 },
      { slug: "d9", denomination: 9, unit: "RC", costPrice: 1881213 },
      { slug: "d33", denomination: 33, unit: "RC", costPrice: 6274892 },
      { slug: "d66", denomination: 66, unit: "RC", costPrice: 12549782 },
      { slug: "d80", denomination: 80, unit: "RC", costPrice: 19062 },
      { slug: "d250", denomination: 250, unit: "RC", costPrice: 56897 },
      { slug: "d450", denomination: 450, unit: "RC", costPrice: 94797 },
      { slug: "d920", denomination: 920, unit: "RC", costPrice: 187256 },
    ],
    "passes": [
      { slug: "glory-pass-premium-s9", name: "Glory Pass Premium S9", costPrice: 180990, sortOrder: 1 },
      { slug: "growth-fund", name: "Growth Fund", costPrice: 121981, sortOrder: 2 },
      { slug: "kartu-bulanan", name: "Kartu Bulanan", costPrice: 60670, sortOrder: 3 },
      { slug: "kartu-mingguan", name: "Kartu Mingguan", costPrice: 36872, sortOrder: 4 },
    ],
  },
  "google-play": {
    "voucher": [
      { slug: "d16000", denomination: 16000, unit: "IDR", costPrice: 17493 },
      { slug: "d49000", denomination: 49000, unit: "IDR", costPrice: 53482 },
      { slug: "d79000", denomination: 79000, unit: "IDR", costPrice: 82655 },
      { slug: "d129000", denomination: 129000, unit: "IDR", costPrice: 139315 },
      { slug: "d159000", denomination: 159000, unit: "IDR", costPrice: 167509 },
    ],
  },
  "honkai-star-rail": {
    "oneiric-shards": [
      { slug: "d60", denomination: 60, unit: "Oneiric Shards", costPrice: 0 },
      { slug: "d330", denomination: 330, unit: "Oneiric Shards", costPrice: 0 },
      { slug: "d1090", denomination: 1090, unit: "Oneiric Shards", costPrice: 0 },
      { slug: "d2240", denomination: 2240, unit: "Oneiric Shards", costPrice: 0 },
      { slug: "d3880", denomination: 3880, unit: "Oneiric Shards", costPrice: 0 },
      { slug: "d8080", denomination: 8080, unit: "Oneiric Shards", costPrice: 0 },
    ],
    "passes": [
      { slug: "express-supply-pass", name: "Express Supply Pass", costPrice: 0, sortOrder: 1 },
    ],
  },
  "league-of-legends": {
    "575-rp": [
      { slug: "d575", denomination: 575, unit: "", costPrice: 58005 },
    ],
    "1380-rp": [
      { slug: "d1380", denomination: 1380, unit: "", costPrice: 135342 },
    ],
    "2800-rp": [
      { slug: "d2800", denomination: 2800, unit: "", costPrice: 269108 },
    ],
    "4500-rp": [
      { slug: "d4500", denomination: 4500, unit: "", costPrice: 422267 },
    ],
    "6500-rp": [
      { slug: "d6500", denomination: 6500, unit: "", costPrice: 595011 },
    ],
    "13500-rp": [
      { slug: "d13500", denomination: 13500, unit: "", costPrice: 1151631 },
    ],
    "voucher": [
      { slug: "d575", denomination: 575, unit: "IDR", costPrice: 0 },
      { slug: "d1240", denomination: 1240, unit: "IDR", costPrice: 0 },
      { slug: "d1895", denomination: 1895, unit: "IDR", costPrice: 0 },
      { slug: "d2540", denomination: 2540, unit: "IDR", costPrice: 0 },
      { slug: "d6500", denomination: 6500, unit: "IDR", costPrice: 0 },
    ],
  },
  "wild-rift": {
    "wild-cores": [
      { slug: "d420", denomination: 420, unit: "Wild Cores", costPrice: 54137 },
      { slug: "d425", denomination: 425, unit: "Wild Cores", costPrice: 54137 },
      { slug: "d1000", denomination: 1000, unit: "Wild Cores", costPrice: 120842 },
      { slug: "d1850", denomination: 1850, unit: "Wild Cores", costPrice: 216248 },
      { slug: "d3275", denomination: 3275, unit: "Wild Cores", costPrice: 379080 },
      { slug: "d4800", denomination: 4800, unit: "Wild Cores", costPrice: 542228 },
      { slug: "d6210", denomination: 6210, unit: "Wild Cores", costPrice: 715933 },
      { slug: "d10000", denomination: 10000, unit: "Wild Cores", costPrice: 1083494 },
    ],
  },
  "legends-of-runeterra": {
    "coins": [
      { slug: "d475", denomination: 475, unit: "Coins", costPrice: 53976 },
      { slug: "d1000", denomination: 1000, unit: "Coins", costPrice: 107950 },
      { slug: "d2050", denomination: 2050, unit: "Coins", costPrice: 214643 },
      { slug: "d3650", denomination: 3650, unit: "Coins", costPrice: 372204 },
      { slug: "d5350", denomination: 5350, unit: "Coins", costPrice: 534864 },
      { slug: "d11000", denomination: 11000, unit: "Coins", costPrice: 1051547 },
    ],
  },
  "magic-chess-go-go": {
    "diamonds": [
      { slug: "d1", denomination: 1, unit: "Diamonds", costPrice: 0 },
      { slug: "d2", denomination: 2, unit: "Diamonds", costPrice: 0 },
      { slug: "d3", denomination: 3, unit: "Diamonds", costPrice: 0 },
      { slug: "d5", denomination: 5, unit: "Diamonds", costPrice: 0 },
      { slug: "d9", denomination: 9, unit: "Diamonds", costPrice: 0 },
      { slug: "d10", denomination: 10, unit: "Diamonds", costPrice: 0 },
      { slug: "d15", denomination: 15, unit: "Diamonds", costPrice: 0 },
      { slug: "d18", denomination: 18, unit: "Diamonds", costPrice: 0 },
      { slug: "d52", denomination: 52, unit: "Diamonds", costPrice: 15615 },
      { slug: "d146", denomination: 146, unit: "Diamonds", costPrice: 0 },
      { slug: "d150", denomination: 150, unit: "Diamonds", costPrice: 0 },
      { slug: "d185", denomination: 185, unit: "Diamonds", costPrice: 0 },
      { slug: "d229", denomination: 229, unit: "Diamonds", costPrice: 0 },
      { slug: "d250", denomination: 250, unit: "Diamonds", costPrice: 0 },
      { slug: "d284", denomination: 284, unit: "Diamonds", costPrice: 0 },
      { slug: "d345", denomination: 345, unit: "Diamonds", costPrice: 0 },
      { slug: "d355", denomination: 355, unit: "Diamonds", costPrice: 0 },
      { slug: "d500", denomination: 500, unit: "Diamonds", costPrice: 81801 },
      { slug: "d627", denomination: 627, unit: "Diamonds", costPrice: 0 },
      { slug: "d832", denomination: 832, unit: "Diamonds", costPrice: 0 },
      { slug: "d967", denomination: 967, unit: "Diamonds", costPrice: 0 },
    ],
  },
  "point-blank": {
    "points": [
      { slug: "d1200", denomination: 1200, unit: "Points", costPrice: 9062 },
      { slug: "d2400", denomination: 2400, unit: "Points", costPrice: 18442 },
      { slug: "d6000", denomination: 6000, unit: "Points", costPrice: 46101 },
      { slug: "d12000", denomination: 12000, unit: "Points", costPrice: 91669 },
      { slug: "d24000", denomination: 24000, unit: "Points", costPrice: 195915 },
      { slug: "d36000", denomination: 36000, unit: "Points", costPrice: 293873 },
      { slug: "d60000", denomination: 60000, unit: "Points", costPrice: 455012 },
    ],
  },
  "pokemon-unite": {
    "aeos-gems": [
      { slug: "d60", denomination: 60, unit: "Aeos Gems", costPrice: 16678 },
      { slug: "d250", denomination: 250, unit: "Aeos Gems", costPrice: 67293 },
      { slug: "d525", denomination: 525, unit: "Aeos Gems", costPrice: 133525 },
      { slug: "d1350", denomination: 1350, unit: "Aeos Gems", costPrice: 338081 },
      { slug: "d2740", denomination: 2740, unit: "Aeos Gems", costPrice: 666972 },
      { slug: "d3500", denomination: 3500, unit: "Aeos Gems", costPrice: 821107 },
      { slug: "d7100", denomination: 7100, unit: "Aeos Gems", costPrice: 1643217 },
    ],
  },
  "rainbow-six-mobile": {
    "platinum": [
      { slug: "d50", denomination: 50, unit: "Platinum", costPrice: 10908 },
      { slug: "d110", denomination: 110, unit: "Platinum", costPrice: 21340 },
      { slug: "d250", denomination: 250, unit: "Platinum", costPrice: 10908 },
      { slug: "d300", denomination: 300, unit: "Platinum", costPrice: 52803 },
      { slug: "d600", denomination: 600, unit: "Platinum", costPrice: 52803 },
      { slug: "d650", denomination: 650, unit: "Platinum", costPrice: 104661 },
      { slug: "d1350", denomination: 1350, unit: "Platinum", costPrice: 210914 },
      { slug: "d2700", denomination: 2700, unit: "Platinum", costPrice: 210914 },
      { slug: "d3500", denomination: 3500, unit: "Platinum", costPrice: 523236 },
      { slug: "d7000", denomination: 7000, unit: "Platinum", costPrice: 523236 },
      { slug: "d7250", denomination: 7250, unit: "Platinum", costPrice: 1047408 },
      { slug: "d11250", denomination: 11250, unit: "Platinum", costPrice: 1590300 },
    ],
  },
  "razer-gold": {
    "voucher": [
      { slug: "d10000", denomination: 10000, unit: "IDR", costPrice: 9795 },
      { slug: "d20000", denomination: 20000, unit: "IDR", costPrice: 20315 },
      { slug: "d50000", denomination: 50000, unit: "IDR", costPrice: 49832 },
      { slug: "d100000", denomination: 100000, unit: "IDR", costPrice: 99088 },
      { slug: "d200000", denomination: 200000, unit: "IDR", costPrice: 197022 },
      { slug: "d500000", denomination: 500000, unit: "IDR", costPrice: 491834 },
      { slug: "d1000000", denomination: 1000000, unit: "IDR", costPrice: 983667 },
    ],
  },
  "tft-mobile": {
    "coins": [
      { slug: "d575", denomination: 575, unit: "Coins", costPrice: 58905 },
      { slug: "d1380", denomination: 1380, unit: "Coins", costPrice: 137256 },
      { slug: "d2800", denomination: 2800, unit: "Coins", costPrice: 272916 },
      { slug: "d4500", denomination: 4500, unit: "Coins", costPrice: 428268 },
      { slug: "d6500", denomination: 6500, unit: "Coins", costPrice: 603324 },
      { slug: "d13500", denomination: 13500, unit: "Coins", costPrice: 1167850 },
    ],
  },
  "the-moonlit-oath": {
    "ingots": [
      { slug: "d88", denomination: 88, unit: "Ingots", costPrice: 17088 },
      { slug: "d220", denomination: 220, unit: "Ingots", costPrice: 42719 },
      { slug: "d440", denomination: 440, unit: "Ingots", costPrice: 84944 },
      { slug: "d880", denomination: 880, unit: "Ingots", costPrice: 168900 },
      { slug: "d1100", denomination: 1100, unit: "Ingots", costPrice: 211125 },
      { slug: "d2200", denomination: 2200, unit: "Ingots", costPrice: 421631 },
      { slug: "d4400", denomination: 4400, unit: "Ingots", costPrice: 843264 },
    ],
  },
  "tiktok-gift-card": {
    "voucher": [
      { slug: "d20000", denomination: 20000, unit: "IDR", costPrice: 22097 },
      { slug: "d50000", denomination: 50000, unit: "IDR", costPrice: 54923 },
    ],
  },
  "unipin-gift-card": {
    "voucher": [
      { slug: "d10000", denomination: 10000, unit: "IDR", costPrice: 0 },
      { slug: "d20000", denomination: 20000, unit: "IDR", costPrice: 0 },
      { slug: "d50000", denomination: 50000, unit: "IDR", costPrice: 0 },
      { slug: "d100000", denomination: 100000, unit: "IDR", costPrice: 0 },
      { slug: "d300000", denomination: 300000, unit: "IDR", costPrice: 0 },
      { slug: "d500000", denomination: 500000, unit: "IDR", costPrice: 0 },
    ],
  },
  "valorant": {
    "vp": [
      { slug: "d475", denomination: 475, unit: "VP", costPrice: 54979 },
      { slug: "d1000", denomination: 1000, unit: "VP", costPrice: 109769 },
      { slug: "d2050", denomination: 2050, unit: "VP", costPrice: 218259 },
      { slug: "d3650", denomination: 3650, unit: "VP", costPrice: 378517 },
      { slug: "d5350", denomination: 5350, unit: "VP", costPrice: 543921 },
      { slug: "d11000", denomination: 11000, unit: "VP", costPrice: 1069462 },
    ],
    "points": [
      { slug: "d7", denomination: 7, unit: "Points", costPrice: 803267 },
    ],
  },
  "zenless-zone-zero": {
    "monochromes": [
      { slug: "d60", denomination: 60, unit: "Monochromes", costPrice: 0 },
      { slug: "d330", denomination: 330, unit: "Monochromes", costPrice: 0 },
      { slug: "d1090", denomination: 1090, unit: "Monochromes", costPrice: 0 },
      { slug: "d2240", denomination: 2240, unit: "Monochromes", costPrice: 0 },
      { slug: "d3880", denomination: 3880, unit: "Monochromes", costPrice: 0 },
      { slug: "d8080", denomination: 8080, unit: "Monochromes", costPrice: 0 },
    ],
    "passes": [
      { slug: "inter-knot-membership", name: "Inter-Knot Membership", costPrice: 0, sortOrder: 1 },
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
