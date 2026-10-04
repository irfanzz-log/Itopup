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
// Nothing else in the app needs to change; the provider's SKU code lives only
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
   * ⚠️  GENERATED FROM THE LIVE PRICELIST: do not hand-edit.
   *
   * Every entry below was produced by joining the provider's live pricelist
   * against our variants on the DELIVERED AMOUNT, then keeping the cheapest
   * ACTIVE SKU per amount. Re-derive rather than patching a line by hand: a
   * hand-typed entry is how this table previously ended up mapping
   * `mlid36d-s81` ("33 + 3 Diamonds", i.e. 36) to the 36-diamond variant via the
   * *first* number in the name: right by luck, wrong by rule.
   *
   * Amounts with a "+" are summed ("33 + 3" → 36). Where no SKU delivers exactly
   * our denomination, the entry notes the bonus actually granted, and the
   * selling price follows that SKU's real cost.
   */
  byProviderCode: {
    // ── Call of Duty Mobile ─────────────────────────────────────
    // Two region ladders, each mapped to its own Product on the codm game so
    // the customer picks the region as a subcategory at checkout:
    //   * "cp-global" ← brand "Call Of Duty Mobile" (global, s12/s13)
    //   * "cp-id"     ← brand "Call of Duty: Mobile (Indonesia ID)" (s7)
    // denomination = the TOTAL CP delivered, including the provider's bonus.
    // cp-global
    "codm31c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d31" },
    "codm63c-s12a": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d63" },
    "codm128c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d128" },
    "codm321c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d321" },
    "codm384c-s121": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d384" },
    "codm645c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d645" },
    "codm800c-s12a": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d800" },
    "codm965c-s121": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d965" },
    "codm1373c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d1373" },
    "codm1584c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d1584" },
    "codm2059c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d2059" },
    "codm2750c-s12a": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d2750" },
    "codm3564c-s12b": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d3564" },
    "codm5618c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d5618" },
    "codm7656c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d7656" },
    "codm11190c-s121": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d11190" },
    "codm15312c-s12b": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d15312" },
    "codm38280c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d38280" },
    "codm76560c-s12": { gameSlug: "codm", productSlug: "cp-global", variantSlug: "d76560" },
    // cp-id (Indonesia)
    "cgiid31ca-s71": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d31" },
    "cgiid63c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d63" },
    "cgiid128c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d128" },
    "cgiid321c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d321" },
    "cgiid645c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d645" },
    "cgiid800c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d800" },
    "cgiid1373c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d1373" },
    "cgiid2060c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d2060" },
    "cgiid2750c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d2750" },
    "cgiid3564c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d3564" },
    "cgiid5618ca-s71": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d5618" },
    "cgiid7656c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d7656" },
    "cgiid15312c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d15312" },
    "cgiid38280c-s7": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d38280" },
    "cgiid76560ca-s71": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d76560" },
    // The second Indonesia ladder the provider publishes under a different
    // prefix; same amounts, same brand. Kept as alternates, not linked by
    // default, so one ladder per region stays the source of truth.
    // "codmiiid63c-s2": { gameSlug: "codm", productSlug: "cp-id", variantSlug: "d63" },

    // Legacy Activision (CA) ladder. These were mapped to the old single "cp"
    // product; the region is neither ID nor global-Indonesia, so they are
    // intentionally NOT linked to either new product. An operator can link one
    // from /dev/products if the CA ladder is ever wanted again.
    // "codmacca88c-s7":   88 CP  (80 + 8)
    // "codmacca460c-s7":  460 CP (400 + 60)
    // "codmacca960c-s7":  960 CP (800 + 160)
    // "codmacca2600c-s7": 2600 CP (2000 + 600)
    // "codmacca5400c-s7": 5400 CP (4000 + 1400)

    // ── eFootball ─────────────────────────────────────────────────
    // The provider sells Coins as TWO ladders: every amount has a distinct iOS
    // SKU (eppes<N>c-s11) and Android SKU (eppes<N>c-s11a) at a different cost
    // (iOS is cheaper; see the live pricelist notes in VARIANT_SEED). They are
    // mapped to separate Products, so the platform is part of the lookup key.
    //
    // Some SKUs deliver a bonus ("130+130 Coins"); they are a different card at
    // the same amount and the cheapest ACTIVE card wins, same rule as the other
    // games. Android has no 3250 SKU at all, so that rung is iOS-only; it is
    // simply absent from the Android ladder in the seed.
    "eppes130c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d130" },
    "eppes130c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d130" },
    "eppes260c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d260" },
    "eppes260c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d260" },
    "eppes300c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d300" },
    "eppes300c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d300" },
    "eppes550c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d550" },
    "eppes550c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d550" },
    "eppes750c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d750" },
    "eppes750c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d750" },
    "eppes840c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d840" },
    "eppes840c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d840" },
    "eppes1040c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d1040" },
    "eppes1040c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d1040" },
    "eppes1630c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d1630" },
    "eppes1630c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d1630" },
    "eppes2130c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d2130" },
    "eppes2130c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d2130" },
    "eppes3250c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d3250" },
    "eppes5700c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d5700" },
    "eppes5700c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d5700" },
    "eppes12800c-s11": { gameSlug: "efootball", productSlug: "coins-ios", variantSlug: "d12800" },
    "eppes12800c-s11a": { gameSlug: "efootball", productSlug: "coins-android", variantSlug: "d12800" },

    // ── Free Fire (ID) ── region Indonesia. "Cek dulu apakah itu untuk region
    // id": VERIFIED. The `ffid*` family is the Indonesia ladder — the provider
    // also lists ff* (global), ffg*, ffph*, ffmy*, ffth*, ffsg*, ffeu*, ffvn*,
    // ffpk*, flatam*, fftw*, fmena*, but the existing rules and the catalogue
    // are the ID ladder, so the mapping stays ID-only. MEASURED on the live
    // pricelist: 36 of the 37 SKUs below are ACTIVE (ffid10d-s11 is off), and
    // the ffid* family undercuts or matches the other ladders on the same
    // amount in every denomination where both exist except a few, so keeping
    // the ID ladder also keeps the price honest. Cheapest ACTIVE per
    // denomination is what the sync would pick anyway.
    "ffid5d-s1": { gameSlug: "free-fire", variantSlug: "d5" }, // 5 Diamonds
    "ffid10d-s11": { gameSlug: "free-fire", variantSlug: "d10" }, // 10 Diamonds
    "ffid12d-s1": { gameSlug: "free-fire", variantSlug: "d12" }, // 12 Diamonds
    "ffid20d-s7": { gameSlug: "free-fire", variantSlug: "d20" }, // 20 Diamonds
    "ffid25d-s7": { gameSlug: "free-fire", variantSlug: "d25" }, // 25 Diamonds
    "ffid30d-s7": { gameSlug: "free-fire", variantSlug: "d30" }, // 30 Diamonds
    "ffid50d-s1": { gameSlug: "free-fire", variantSlug: "d50" }, // 50 Diamonds
    "ffid55d-s7": { gameSlug: "free-fire", variantSlug: "d55" }, // 55 Diamonds
    "ffid70d-s1": { gameSlug: "free-fire", variantSlug: "d70" }, // 70 Diamonds
    "ffid80d-s7": { gameSlug: "free-fire", variantSlug: "d80" }, // 80 Diamonds
    "ffid100d-s7": { gameSlug: "free-fire", variantSlug: "d100" }, // 100 Diamonds
    "ffid120d-s7": { gameSlug: "free-fire", variantSlug: "d120" }, // 120 Diamonds
    "ffid130d-s7": { gameSlug: "free-fire", variantSlug: "d130" }, // 130 Diamonds
    "ffid140d-s1": { gameSlug: "free-fire", variantSlug: "d140" }, // 140 Diamonds
    "ffid145d-s7": { gameSlug: "free-fire", variantSlug: "d145" }, // 145 Diamonds
    "ffid150d-s7": { gameSlug: "free-fire", variantSlug: "d150" }, // 150 Diamonds
    "ffid190d-s7": { gameSlug: "free-fire", variantSlug: "d190" }, // 190 Diamonds
    "ffid200d-s7": { gameSlug: "free-fire", variantSlug: "d200" }, // 200 Diamonds
    "ffid210d-s7": { gameSlug: "free-fire", variantSlug: "d210" }, // 210 Diamonds
    "ffid280d-s7": { gameSlug: "free-fire", variantSlug: "d280" }, // 280 Diamonds
    "ffid355d-s1": { gameSlug: "free-fire", variantSlug: "d355" }, // 355 Diamonds
    "ffid500d-s7": { gameSlug: "free-fire", variantSlug: "d500" }, // 500 Diamonds
    "ffid510d-s7": { gameSlug: "free-fire", variantSlug: "d510" }, // 510 Diamonds
    "ffid565d-s7": { gameSlug: "free-fire", variantSlug: "d565" }, // 565 Diamonds
    "ffid635d-s7": { gameSlug: "free-fire", variantSlug: "d635" }, // 635 Diamonds
    "ffid720d-s1": { gameSlug: "free-fire", variantSlug: "d720" }, // 720 Diamonds
    "ffid800d-s7": { gameSlug: "free-fire", variantSlug: "d800" }, // 800 Diamonds
    "ffid860d-s7": { gameSlug: "free-fire", variantSlug: "d860" }, // 860 Diamonds
    "ffid930d-s7": { gameSlug: "free-fire", variantSlug: "d930" }, // 930 Diamonds
    "ffid1050d-s7": { gameSlug: "free-fire", variantSlug: "d1050" }, // 1050 Diamonds
    "ffid1075d-s7": { gameSlug: "free-fire", variantSlug: "d1075" }, // 1075 Diamonds
    "ffid1080d-s7": { gameSlug: "free-fire", variantSlug: "d1080" }, // 1080 Diamonds
    "ffid1450d-s1": { gameSlug: "free-fire", variantSlug: "d1450" }, // 1450 Diamonds
    "ffid2180d-s1": { gameSlug: "free-fire", variantSlug: "d2180" }, // 2180 Diamonds
    "ffid2200d-s7": { gameSlug: "free-fire", variantSlug: "d2200" }, // 2200 Diamonds
    "ffid3640d-s1": { gameSlug: "free-fire", variantSlug: "d3640" }, // 3640 Diamonds
    "ffid7290d-s1": { gameSlug: "free-fire", variantSlug: "d7290" }, // 7290 Diamonds
    // ── Genshin Impact ──────────────────────────────────────────
    // genesis-crystals
    "giggl60gc-s7": { gameSlug: "genshin-impact", variantSlug: "d60" }, // 60 Genesis Crystals
    "giggl330gc-s7": { gameSlug: "genshin-impact", variantSlug: "d300" }, // 300 + 30 Genesis Crystals  [+30 bonus (330)]
    "giggl1090gc-s7": { gameSlug: "genshin-impact", variantSlug: "d980" }, // 980 + 110 Genesis Crystals  [+110 bonus (1090)]
    "giggl2240gc-s7": { gameSlug: "genshin-impact", variantSlug: "d1980" }, // 1980 + 260 Genesis Crystals  [+260 bonus (2240)]
    // d3280/d6480 were seeded isActive=false with no link. The provider only
    // sells them as bonus bundles ("3280 + 600" delivers 3880, "6480 + 1600"
    // delivers 8080) at a higher cost than the variant's placeholder price, so
    // linking them is a business decision: the customer pays for 3880 and
    // receives 3880. Rules added so an operator can flip the variants on after
    // confirming the bonus-inclusive price is what they want to sell.
    "giggl3880gc-s7": { gameSlug: "genshin-impact", productSlug: "genesis-crystals", variantSlug: "d3280" }, // 3280 + 600 (delivers 3880)
    "giggl8080gc-s7": { gameSlug: "genshin-impact", productSlug: "genesis-crystals", variantSlug: "d6480" }, // 6480 + 1600 (delivers 8080)
    // Blessing of the Welkin Moon. The cheapest ACTIVE card on the pricelist
    // (MEASURED: Rp 93.500 on the 2026-09-25 sheet, "Genshin Impact (Global)").
    "gigglbowmmp-s7": { gameSlug: "genshin-impact", productSlug: "welkin-moon", variantSlug: "item-1" },

    // ── Mobile Legends ──────────────────────────────────────────
    // diamonds
    "mlid5d-s7": { gameSlug: "mobile-legends", variantSlug: "d5" }, // 5 Diamonds
    "mlid12d-s5": { gameSlug: "mobile-legends", variantSlug: "d12" }, // 12 Diamonds
    "mlid19d-s1": { gameSlug: "mobile-legends", variantSlug: "d19" }, // 19 Diamonds
    "mlid28d-s5": { gameSlug: "mobile-legends", variantSlug: "d28" }, // 28 Diamonds
    "mlid36dd-s12a": { gameSlug: "mobile-legends", variantSlug: "d36" }, // 33 + 3 Diamonds
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

    // ── Mobile Legends: extra diamond rungs ─────────────────────
    // The provider stocks 51 ML denominations; the 22 above were the original
    // catalogue and these 29 close the remaining gaps. Each maps to the
    // CHEAPEST ACTIVE card for its denomination on the 2026-09-25 pricelist
    // (brand "Mobile Legends (ID)", with mlb* being the ID-region reseller
    // line that undercuts the direct one). Duplicate denominations already
    // covered above are deliberately NOT repeated here; the sync collapses
    // same-variant collisions anyway, but an explicit duplicate would just
    // silently point the same variant at a second SKU that never wins.
    "mlid10d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d10" }, // 10 Diamonds
    // The `-s8` ladder the original rungs pointed at is no longer listed
    // (audit-mapping: STALE), so these seven never linked. Re-pointed at the
    // cheapest ACTIVE SKU per denomination on the current pricelist.
    "mlid33d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d33" }, // 33 Diamonds
    "mlid59d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d59" }, // 59 Diamonds
    "mlid74d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d74" }, // 74 Diamonds
    "mlid85d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d85" }, // 85 Diamonds
    "mlid113d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d113" }, // 113 Diamonds
    "mlid170d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d170" }, // 170 Diamonds
    "mlid184d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d184" }, // 184 Diamonds
    "mlid222d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d222" }, // 222 Diamonds
    "mlid240dd-s12": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d240" }, // 240 Diamonds
    "mlid284d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d284" }, // 284 Diamonds
    "mlid296d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d296" }, // 296 Diamonds
    "mlb345d-s13": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d345" }, // 345 Diamonds
    "mlid408d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d408" }, // 408 Diamonds
    "mlid568d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d568" }, // 568 Diamonds
    "mlid716d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d716" }, // 716 Diamonds
    "mlid750dd-s12a": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d750" }, // 750 Diamonds
    "mlid758d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d758" }, // 758 Diamonds
    "mlid875d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d875" }, // 875 Diamonds
    "mlid1050d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d1050" }, // 1.050 Diamonds
    "mlid1134d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d1134" }, // 1.134 Diamonds
    "mlid1159d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d1159" }, // 1.159 Diamonds
    "mlid1220dd-s12a": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d1220" }, // 1.220 Diamonds
    "mlid1704dd-s12": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d1704" }, // 1.704 Diamonds
    "mlid2010d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d2010" }, // 2.010 Diamonds
    "mlb2199d-s13": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d2199" }, // 2.199 Diamonds
    "mlid2904d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d2904" }, // 2.904 Diamonds
    "mlid4026d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d4026" }, // 4.026 Diamonds
    "mlid4830d-s5": { gameSlug: "mobile-legends", productSlug: "diamonds", variantSlug: "d4830" }, // 4.830 Diamonds

    // ── Mobile Legends: subscription passes ─────────────────────
    // Both passes are single-run products (variant item-1). The ID region is
    // what the catalogue sells; both SKUs below are the cheapest ACTIVE card
    // for their product on the 2026-09-25 pricelist (MEASURED).
    "mlidwp-s1": { gameSlug: "mobile-legends", productSlug: "weekly-pass", variantSlug: "item-1" }, // Weekly Diamond Pass (ID), Rp 31.265
    "mltp-s13": { gameSlug: "mobile-legends", productSlug: "twilight-pass", variantSlug: "item-1" }, // Twilight Pass (ID), Rp 149.499

    // ── PUBG Mobile (ID) ── region Indonesia, brand 3081 = "PUBG Mobile (ID)"
    "pubgmid30u-s12": { gameSlug: "pubg-mobile", variantSlug: "d30" }, // 30 UC
    "pubgmid60u-s12d": { gameSlug: "pubg-mobile", variantSlug: "d60" }, // 60 UC
    "pubgmid120u-s12": { gameSlug: "pubg-mobile", variantSlug: "d120" }, // 120 UC
    "pubgmid180u-s12": { gameSlug: "pubg-mobile", variantSlug: "d180" }, // 180 UC
    "pubgmid210u-s12": { gameSlug: "pubg-mobile", variantSlug: "d210" }, // 210 UC
    "pubgmid240u-s12": { gameSlug: "pubg-mobile", variantSlug: "d240" }, // 240 UC
    "pubgmid325u-s12": { gameSlug: "pubg-mobile", variantSlug: "d325" }, // 325 UC
    "pubgmid385u-s12": { gameSlug: "pubg-mobile", variantSlug: "d385" }, // 385 UC
    "pubgmid445u-s12": { gameSlug: "pubg-mobile", variantSlug: "d445" }, // 445 UC
    "pubgmid475u-s12": { gameSlug: "pubg-mobile", variantSlug: "d475" }, // 475 UC
    "pubgmid505u-s12": { gameSlug: "pubg-mobile", variantSlug: "d505" }, // 505 UC
    "pubgmid565u-s12": { gameSlug: "pubg-mobile", variantSlug: "d565" }, // 565 UC
    "pubgmid660u-s12": { gameSlug: "pubg-mobile", variantSlug: "d660" }, // 660 UC
    "pubgmid720u-s12a": { gameSlug: "pubg-mobile", variantSlug: "d720" }, // 720 UC
    "pubgmid780u-s12": { gameSlug: "pubg-mobile", variantSlug: "d780" }, // 780 UC
    "pubgmid810u-s12": { gameSlug: "pubg-mobile", variantSlug: "d810" }, // 810 UC
    "pubgmid840u-s12": { gameSlug: "pubg-mobile", variantSlug: "d840" }, // 840 UC
    "pubgmid900u-s12": { gameSlug: "pubg-mobile", variantSlug: "d900" }, // 900 UC
    "pubgmid985u-s12": { gameSlug: "pubg-mobile", variantSlug: "d985" }, // 985 UC
    "pubgmid1105u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1105" }, // 1105 UC
    "pubgmid1165u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1165" }, // 1165 UC
    "pubgmid1320u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1320" }, // 1320 UC
    "pubgmid1440u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1440" }, // 1440 UC
    "pubgmid1500u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1500" }, // 1500 UC
    "pubgmid1800u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1800" }, // 1800 UC
    "pubgmid1920u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1920" }, // 1920 UC
    "pubgmid1980u-s12": { gameSlug: "pubg-mobile", variantSlug: "d1980" }, // 1980 UC
    "pubgmid2125u-s12a": { gameSlug: "pubg-mobile", variantSlug: "d2125" }, // 2125 UC
    "pubgmid2460u-s12": { gameSlug: "pubg-mobile", variantSlug: "d2460" }, // 2460 UC
    "pubgmid2785u-s12": { gameSlug: "pubg-mobile", variantSlug: "d2785" }, // 2785 UC
    "pubgmid3120u-s12": { gameSlug: "pubg-mobile", variantSlug: "d3120" }, // 3120 UC
    "pubgmid3850u-s12": { gameSlug: "pubg-mobile", variantSlug: "d3850" }, // 3850 UC
    "pubgmid4030u-s12": { gameSlug: "pubg-mobile", variantSlug: "d4030" }, // 4030 UC
    "pubgmid4035u-s12": { gameSlug: "pubg-mobile", variantSlug: "d4035" }, // 4035 UC
    "pubgmid4175u-s12": { gameSlug: "pubg-mobile", variantSlug: "d4175" }, // 4175 UC
    "pubgmid4510u-s12": { gameSlug: "pubg-mobile", variantSlug: "d4510" }, // 4510 UC
    "pubgmid4835u-s12": { gameSlug: "pubg-mobile", variantSlug: "d4835" }, // 4835 UC
    "pubgmid5170u-s12": { gameSlug: "pubg-mobile", variantSlug: "d5170" }, // 5170 UC
    "pubgmid5650u-s12": { gameSlug: "pubg-mobile", variantSlug: "d5650" }, // 5650 UC
    "pubgmid5975u-s12": { gameSlug: "pubg-mobile", variantSlug: "d5975" }, // 5975 UC
    "pubgmid6310u-s12": { gameSlug: "pubg-mobile", variantSlug: "d6310" }, // 6310 UC
    "pubgmid6635u-s12": { gameSlug: "pubg-mobile", variantSlug: "d6635" }, // 6635 UC
    "pubgmid6970u-s12": { gameSlug: "pubg-mobile", variantSlug: "d6970" }, // 6970 UC
    "pubgmid8100u-s12": { gameSlug: "pubg-mobile", variantSlug: "d8100" }, // 8100 UC
    "pubgmid11950u-s12": { gameSlug: "pubg-mobile", variantSlug: "d11950" }, // 11950 UC
    "pubgmid16200u-s12": { gameSlug: "pubg-mobile", variantSlug: "d16200" }, // 16200 UC
    "pubgmid24300u-s12": { gameSlug: "pubg-mobile", variantSlug: "d24300" }, // 24300 UC
    "pubgmid32400u-s12": { gameSlug: "pubg-mobile", variantSlug: "d32400" }, // 32400 UC
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

    // ── Roblox ──────────────────────────────────────────────────────────────
    // robux. The original rules pointed at a `rob*` ladder the provider no
    // longer lists (audit-mapping: STALE), so they never linked. Re-pointed at
    // the cheapest ACTIVE SKU per denomination on the current pricelist.
    //
    // Region note: the provider carries many Roblox ladders (rgc*/rge*/rggl*
    // "Global", rgci* IDR gift cards, rgccca* CAD, rgcaat* EUR, …). The ones
    // below are all "Global" Robux top-ups — names say the currency, not a
    // card, so they deliver real Robux.
    "rgc800ro-s13": { gameSlug: "roblox", productSlug: "robux", variantSlug: "d800" }, // 800 Robux
    "rge1rog-s101": { gameSlug: "roblox", productSlug: "robux", variantSlug: "d1700" }, // 1.700 Robux
    "rgc4500ro-s13": { gameSlug: "roblox", productSlug: "robux", variantSlug: "d4500" }, // 4.500 Robux
    // d400: the provider stocks an ACTIVE 400 Robux ladder (rge4*), so this one
    // links. d80 has NO active Robux SKU at all — only "80 BRL"/"80 AUD" gift
    // cards, which are currency cards, not Robux — so it stays unlinked and
    // hidden rather than being wired to something that delivers the wrong thing.
    "rge4rruso-s101": { gameSlug: "roblox", productSlug: "robux", variantSlug: "d400" }, // 400 Robux - US - Other - Other (RoW)
    // The only 10.000 Robux SKUs are all OFF as of the audit; rgc10kro-s13 was
    // the cheapest of them and is linked so the variant restocks the moment the
    // provider flips it back on. Until then the sync records it unavailable.
    "rgc10kro-s13": { gameSlug: "roblox", productSlug: "robux", variantSlug: "d10000" }, // 10.000 Robux
  },

  /**
   * Provider brand name → our game slug.
   *
   * ⚠️  THIS TABLE CAN ONLY EVER RESOLVE 51 OF 755 BRANDS.
   *
   * Measured on the live pricelist: products carry 755 distinct `brand_id`
   * values, but `meta.brands` names only 51 of them. The other 704 brand_ids (
   * 93.2% of the catalogue, including Free Fire, PUBG, CODM, Roblox and every
   * airtime operator) arrive with NO name at all, so a name lookup returns
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
   * brand. Still explicit: no string munging on the SKU name.
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
