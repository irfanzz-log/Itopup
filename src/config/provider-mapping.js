// ============================================================================
// Provider → internal catalogue mapping rules.
//
// WHY THIS FILE EXISTS
//
// The sync service imports the provider's pricelist into `ProviderProduct` rows,
// and every one of those rows must point at a `ProductVariant`. The provider's
// SKU codes (`ml-id-1045`, `ML86`, …) have no algorithmic relationship to our
// slugs, and the provider's own product names change without notice.
//
// So the link is DECLARED here, explicitly, and nothing is guessed. An SKU with
// no rule is reported as `unmatched` by the sync and must be linked by an
// operator on /dev/products. That is slower than a name-matching heuristic and
// it is the correct trade: a wrong link means the customer pays for one product
// and receives another.
//
// ── HOW TO ADD A LINK ───────────────────────────────────────────────────────
//
//   1. Run the sync and read the `unmatched` list (it prints SKU, name, price,
//      brand).
//   2. Add an entry below.
//   3. Run the sync again.
//
// Nothing else in the app needs to change — the provider's SKU code lives only
// in the ProviderProduct row.
// ============================================================================

export const PROVIDER_MAPPING = {
  /**
   * Direct SKU → variant rules. Highest precedence.
   *
   * Shape: "PROVIDER_SKU_CODE": { gameSlug, variantSlug }
   *
   * Every entry below was read off the live pricelist
   * (GET /api/v1/h2h/pricelists, 20.887 SKUs, 51 brands in meta.brands) and
   * matched to a real `product_variants` row by the amount the provider's
   * product name delivers.
   *
   * WHY THE PROVIDER'S NAME, NOT THE SKU NUMBER
   *
   * Several brands encode a bonus in the SKU, so the digits in the code are not
   * the amount the customer receives:
   *
   *   codmacca88c-s7   "80 + 8 CP"                    → 88 CP, matches our d80
   *   mlid86dd-s12     "86 Diamond (77 + 9 Bonus)"    → 86, matches our d86
   *   dnt10ko-s4       "Rp. 10.000"                   → 10.000, matches d10000
   *   pubgmgl62100ucuc "8100 Unknown Cash"            → 8.100, SKU digits are 62100
   *
   * Matching on SKU digits would have linked the wrong variant for all of those.
   * The name states what the buyer actually gets, so that is what is matched.
   *
   * ⚠️  GENERATED FROM THE LIVE PRICELIST — do not hand-edit.
   *
   * Every entry below was produced by joining the provider's live pricelist
   * against our variants on the DELIVERED AMOUNT, then keeping the cheapest
   * ACTIVE SKU per amount. Re-derive rather than patching a line by hand: a
   * hand-typed entry is how this table previously ended up mapping
   * `mlid36d-s81` ("33 + 3 Diamonds", i.e. 36) to the 36-diamond variant via the
   * *first* number in the name — right by luck, wrong by rule.
   *
   * Amounts with a "+" are summed ("33 + 3" → 36). Where no SKU delivers exactly
   * our denomination, the entry notes the bonus actually granted, and the
   * selling price follows that SKU's real cost.
   */
  byProviderCode: {
    // ── Call of Duty Mobile ─────────────────────────────────────
    // cp
    "codmacca88c-s7": { gameSlug: "codm", variantSlug: "d80" }, // 80 + 8 CP  [+8 bonus (88)]
    "codmacca460c-s7": { gameSlug: "codm", variantSlug: "d420" }, // 400 + 60 CP  [+40 bonus (460)]
    "codmacca960c-s7": { gameSlug: "codm", variantSlug: "d880" }, // 800 + 160 CP  [+80 bonus (960)]
    "codmacca2600c-s7": { gameSlug: "codm", variantSlug: "d2400" }, // 2000 + 600 CP  [+200 bonus (2600)]
    "codmacca5400c-s7": { gameSlug: "codm", variantSlug: "d5000" }, // 4000 + 1400 CP  [+400 bonus (5400)]
    "codm11190c-s121": { gameSlug: "codm", variantSlug: "d10800" }, // 11190 CP  [+390 bonus (11190)]

    // ── Free Fire ───────────────────────────────────────────────
    // diamonds
    "ffid5d-s1": { gameSlug: "free-fire", variantSlug: "d5" }, // 5 Diamonds
    "ffid12d-s7": { gameSlug: "free-fire", variantSlug: "d12" }, // 12 Diamonds
    "ffid50d-s1": { gameSlug: "free-fire", variantSlug: "d50" }, // 50 Diamonds
    "ffid70d-s1": { gameSlug: "free-fire", variantSlug: "d70" }, // 70 Diamonds
    "ffid140d-s1": { gameSlug: "free-fire", variantSlug: "d140" }, // 140 Diamonds
    "ffid355d-s1": { gameSlug: "free-fire", variantSlug: "d355" }, // 355 Diamonds
    "ffid720d-s1": { gameSlug: "free-fire", variantSlug: "d720" }, // 720 Diamonds
    "ffid1450d-s1": { gameSlug: "free-fire", variantSlug: "d1450" }, // 1450 Diamonds
    "ff2180d-s5": { gameSlug: "free-fire", variantSlug: "d2180" }, // 2180 Diamonds
    "ffid3640d-s1": { gameSlug: "free-fire", variantSlug: "d3640" }, // 3640 Diamonds
    "ffid7290d-s1": { gameSlug: "free-fire", variantSlug: "d7290" }, // 7290 Diamonds

    // ── Genshin Impact ──────────────────────────────────────────
    // genesis-crystals
    "giggl60gc-s7": { gameSlug: "genshin-impact", variantSlug: "d60" }, // 60 Genesis Crystals
    "giggl330gc-s7": { gameSlug: "genshin-impact", variantSlug: "d300" }, // 300 + 30 Genesis Crystals  [+30 bonus (330)]
    "giggl1090gc-s7": { gameSlug: "genshin-impact", variantSlug: "d980" }, // 980 + 110 Genesis Crystals  [+110 bonus (1090)]
    "giggl2240gc-s7": { gameSlug: "genshin-impact", variantSlug: "d1980" }, // 1980 + 260 Genesis Crystals  [+260 bonus (2240)]

    // ── Mobile Legends ──────────────────────────────────────────
    // diamonds
    "mlid5d-s7": { gameSlug: "mobile-legends", variantSlug: "d5" }, // 5 Diamonds
    "mlid12d-s5": { gameSlug: "mobile-legends", variantSlug: "d12" }, // 12 Diamonds
    "mlid19d-s1": { gameSlug: "mobile-legends", variantSlug: "d19" }, // 19 Diamonds
    "mlid28d-s5": { gameSlug: "mobile-legends", variantSlug: "d28" }, // 28 Diamonds
    "mlid36d-s81": { gameSlug: "mobile-legends", variantSlug: "d36" }, // 33 + 3 Diamonds
    "mlid44d-s5": { gameSlug: "mobile-legends", variantSlug: "d44" }, // 44 Diamonds
    "mlid56d-s5": { gameSlug: "mobile-legends", variantSlug: "d56" }, // 56 Diamond ( 51 + 5 Bonus )
    "mlid86dd-s12": { gameSlug: "mobile-legends", variantSlug: "d86" }, // 86 Diamond (77 + 9 Bonus)
    "mlid172d-s5": { gameSlug: "mobile-legends", variantSlug: "d172" }, // 172 Diamond ( 156 + 16 Bonus )
    "mlid257d-s5": { gameSlug: "mobile-legends", variantSlug: "d257" }, // 257 Diamonds
    "mlb355d-s13": { gameSlug: "mobile-legends", variantSlug: "d355" }, // 355 Diamonds
    "mlid429d-s5": { gameSlug: "mobile-legends", variantSlug: "d429" }, // 429 Diamond (387 + 42 Bonus)
    "mlid514d-s5": { gameSlug: "mobile-legends", variantSlug: "d514" }, // 514 Diamond (463 + 51 Bonus)
    "mlid706dd-s12": { gameSlug: "mobile-legends", variantSlug: "d706" }, // 706 Diamond (629 + 77 Bonus)
    "mlid878dd-s12": { gameSlug: "mobile-legends", variantSlug: "d878" }, // 878 Diamond (777 + 101 Bonus)
    "mlid963d-s5": { gameSlug: "mobile-legends", variantSlug: "d963" }, // 963 Diamond (854 + 109 Bonus)
    "mlid1412d-s5": { gameSlug: "mobile-legends", variantSlug: "d1412" }, // 1.412 Diamonds
    "mlid2195dd-s12a": { gameSlug: "mobile-legends", variantSlug: "d2195" }, // 2195 Diamond (1.877 + 318 Bonus)
    "mlid2975d-s5": { gameSlug: "mobile-legends", variantSlug: "d2906" }, // 2975 Diamond (2.564 + 411 Bonus)  [+69 bonus (2975)]
    "mlid3688dd-s12": { gameSlug: "mobile-legends", variantSlug: "d3688" }, // 3688 Diamond (3.263 + 425 Bonus)
    "mlid5532dd-s12": { gameSlug: "mobile-legends", variantSlug: "d5532" }, // 5532 Diamond (4.628 + 904 Bonus)
    "mlid9288dd-s12": { gameSlug: "mobile-legends", variantSlug: "d9288" }, // 9288 Diamond (7.813+ 1.475 Bonus)

    // ── PUBG Mobile ─────────────────────────────────────────────
    // uc
    "pubgmid60ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d60" }, // 60 UC
    "pubgmid325ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d325" }, // 300 + 25 UC
    "pubgmid660ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d660" }, // 600 + 60 UC
    "pubgmid1800ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d1800" }, // 1500 + 300 UC
    "pubgmid3850ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d3850" }, // 3000 + 850 UC
    "pubgmid8100ucuc-s5": { gameSlug: "pubg-mobile", variantSlug: "d8100" }, // 6000 + 2100 UC

    // ── pulsa ───────────────────────────────────────────────────
    // axis
    "axis5ko-s13": { gameSlug: "pulsa", productSlug: "axis", variantSlug: "d5000" }, // 5.000
    "axisp10ka-s12": { gameSlug: "pulsa", productSlug: "axis", variantSlug: "d10000" }, // Pulsa 10.000
    "axisp25ka-s12": { gameSlug: "pulsa", productSlug: "axis", variantSlug: "d25000" }, // 25.000
    "axisp50ka-s12a": { gameSlug: "pulsa", productSlug: "axis", variantSlug: "d50000" }, // 50.000
    "axisp100ka-s12a": { gameSlug: "pulsa", productSlug: "axis", variantSlug: "d100000" }, // 100.000
    // byu
    "t5btko-s4": { gameSlug: "pulsa", productSlug: "byu", variantSlug: "d5000" }, // Pulsa 5.000
    "byup10ka-s12": { gameSlug: "pulsa", productSlug: "byu", variantSlug: "d10000" }, // Pulsa 10.000
    "trbb25ko-s9": { gameSlug: "pulsa", productSlug: "byu", variantSlug: "d25000" }, // Pulsa 25.000
    "trbb50ko-s9": { gameSlug: "pulsa", productSlug: "byu", variantSlug: "d50000" }, // Pulsa 50.000
    "trbb100ko-s9": { gameSlug: "pulsa", productSlug: "byu", variantSlug: "d100000" }, // Pulsa 100.000
    // indosat
    "isatid5ko-s13": { gameSlug: "pulsa", productSlug: "indosat", variantSlug: "d5000" }, // Pulsa 5.000
    "isatid10ko-s13": { gameSlug: "pulsa", productSlug: "indosat", variantSlug: "d10000" }, // Pulsa 10.000
    "isatid25ko-s13": { gameSlug: "pulsa", productSlug: "indosat", variantSlug: "d25000" }, // Pulsa 25.000
    "i1iphid50ko-s4": { gameSlug: "pulsa", productSlug: "indosat", variantSlug: "d50000" }, // Pulsa 50.000
    "i1iphid100ko-s4": { gameSlug: "pulsa", productSlug: "indosat", variantSlug: "d100000" }, // Pulsa 100.000
    // smartfren
    "sfp5ka-s12": { gameSlug: "pulsa", productSlug: "smartfren", variantSlug: "d5000" }, // Pulsa 5.000
    "sfp10ka-s12": { gameSlug: "pulsa", productSlug: "smartfren", variantSlug: "d10000" }, // Pulsa 10.000
    "sfp25ka-s12": { gameSlug: "pulsa", productSlug: "smartfren", variantSlug: "d25000" }, // Pulsa 25.000
    "sfp50ka-s12": { gameSlug: "pulsa", productSlug: "smartfren", variantSlug: "d50000" }, // Pulsa 50.000
    "sf100ko-s13": { gameSlug: "pulsa", productSlug: "smartfren", variantSlug: "d100000" }, // Pulsa 100.000
    // telkomsel
    "t1kmtm5ko-s4": { gameSlug: "pulsa", productSlug: "telkomsel", variantSlug: "d5000" }, // Pulsa 5.000
    "tselp10ka-s121": { gameSlug: "pulsa", productSlug: "telkomsel", variantSlug: "d10000" }, // Pulsa 10.000
    "t1kmtm25ko-s4": { gameSlug: "pulsa", productSlug: "telkomsel", variantSlug: "d25000" }, // Pulsa 25.000
    "tselp50ka-s121": { gameSlug: "pulsa", productSlug: "telkomsel", variantSlug: "d50000" }, // Pulsa 50.000
    "tselp100ka-s121": { gameSlug: "pulsa", productSlug: "telkomsel", variantSlug: "d100000" }, // Pulsa 100.000
    // tri
    "t2tr5ko-s4": { gameSlug: "pulsa", productSlug: "tri", variantSlug: "d5000" }, // Pulsa 5.000
    "t2tr10ko-s4": { gameSlug: "pulsa", productSlug: "tri", variantSlug: "d10000" }, // Pulsa 10.000
    "t2tr25ko-s4": { gameSlug: "pulsa", productSlug: "tri", variantSlug: "d25000" }, // Pulsa 25.000
    "t2tr50ko-s4": { gameSlug: "pulsa", productSlug: "tri", variantSlug: "d50000" }, // Pulsa 50.000
    "t2tr100ko-s4": { gameSlug: "pulsa", productSlug: "tri", variantSlug: "d100000" }, // Pulsa 100.000
    // xl
    "xlp5ka-s12a": { gameSlug: "pulsa", productSlug: "xl", variantSlug: "d5000" }, // Pulsa 5.000
    "xlp10ka-s12": { gameSlug: "pulsa", productSlug: "xl", variantSlug: "d10000" }, // Pulsa 10.000
    "xlp25ka-s12": { gameSlug: "pulsa", productSlug: "xl", variantSlug: "d25000" }, // Pulsa 25.000
    "xlp50ka-s12a": { gameSlug: "pulsa", productSlug: "xl", variantSlug: "d50000" }, // Pulsa 50.000
    "xrsp100ka-s9": { gameSlug: "pulsa", productSlug: "xl", variantSlug: "d100000" }, // Pulsa 100.000

    // ── Roblox ──────────────────────────────────────────────────
    // robux
    "rob800roa-s121": { gameSlug: "roblox", variantSlug: "d800" }, // 800 Robux
    "rob1700ro-s121": { gameSlug: "roblox", variantSlug: "d1700" }, // 1.700 Robux
    "rob4500ro-s121": { gameSlug: "roblox", variantSlug: "d4500" }, // 4.500 Robux
    "rob10kroa-s121": { gameSlug: "roblox", variantSlug: "d10000" }, // 10.000 Robux
  },

  /**
   * Provider brand name → our game slug.
   *
   * ⚠️  THIS TABLE CAN ONLY EVER RESOLVE 51 OF 755 BRANDS.
   *
   * Measured on the live pricelist: products carry 755 distinct `brand_id`
   * values, but `meta.brands` names only 51 of them. The other 704 brand_ids —
   * 93.2% of the catalogue, including Free Fire, PUBG, CODM, Roblox and every
   * airtime operator — arrive with NO name at all, so a name lookup returns
   * undefined for them and `resolveNewSkuRule` bails out.
   *
   * That is why `byProviderCode` above is the real link and this table is only a
   * fallback. Do not rely on brand names to wire a game up: the sync report's
   * `unmatched` list will show an unnamed brand and no rule can match it.
   *
   * The one entry below is the only one of our six games the provider names.
   */
  gameSlugByBrandName: {
    "Mobile Legends (ID)": "mobile-legends",
  },

  /**
   * Provider SKU → our variant slug, when the game is already known from the
   * brand. Still explicit — no string munging on the SKU name.
   *
   * Only useful for brands that ARE named (see above). Kept because it lets a
   * named brand pick up its whole pricelist without listing every SKU twice.
   */
  variantSlugByProviderCode: {
    // "mlid28d-s1": "d28",   // (byProviderCode already covers these)
  },
};

/** True when at least one rule exists, so the UI can explain why nothing links. */
export function hasMappingRules() {
  return (
    Object.keys(PROVIDER_MAPPING.byProviderCode).length > 0 ||
    Object.keys(PROVIDER_MAPPING.gameSlugByBrandName).length > 0
  );
}
