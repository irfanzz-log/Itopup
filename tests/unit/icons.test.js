// ============================================================================
// Icon resolution, brand slug → asset path.
//
// WHY THE RESOLVER IS TESTED
//
// Three catalogues reach for brand art (games, pulsa operators, payment
// methods) and each keys on something different. The resolver is the single
// place a brand is tied to a file; a test here is what keeps a new game or a
// new bank from silently falling back to initials because nobody wired the
// asset. A missing icon is not a crash, it is a worse-looking page, which is
// exactly why it needs a test rather than an error to catch it.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  gameIcon,
  telcoIcon,
  paymentIcon,
  productIcon,
  GAME_ICONS,
  TELCO_ICONS,
} from "@/config/icons.js";

/**
 * Every game the catalogue actually sells. The icon map is built from the
 * /public/icons/games directory at import time (see src/config/icons.js), so
 * this asserts the property that matters, no sellable game falls back to
 * initials, instead of duplicating a hand-written list that drifts.
 */
const EXPECTED_GAMES = [
  "mobile-legends",
  "pubg-mobile",
  "free-fire",
  "codm",
  "roblox",
  "genshin-impact",
  // Added for the eFootball rollout: its provider flow needs the customer's own
  // game login, and its coins are sold as separate iOS/Android products.
  "efootball",
  // Games added from the Melostore pricelist.
  "zepeto",
  "farlight-84",
  "age-of-empires-mobile",
  "pixel-gun-3d",
  "call-of-duty-mobile",
  "honor-of-kings",
  "dragon-raja",
  "hatsune-miku-colorful-stage",
  "yalla-ludo",
  "watcher-of-realms",
  "super-sus",
  "lords-mobile",
  "telegram-stars",
  "marvel-rivals",
  "whiteout-survival",
  "football-master-2",
  "arena-breakout",
  "infinite-lagrange",
  "ensemble-stars-music",
  "hero-clash",
  "omega-legends",
  "eggy-party",
];

/** Every operator in PRODUCT_SEED under the `pulsa` game. */
const EXPECTED_TELCOS = ["telkomsel", "indosat", "xl", "axis", "tri", "smartfren", "byu"];

describe("gameIcon", () => {
  it("resolves every game in the catalogue to an asset", () => {
    for (const slug of EXPECTED_GAMES) {
      const icon = gameIcon(slug);
      expect(icon, `game "${slug}" has no icon`).toMatch(/^\/icons\/games\//);
    }
  });

  it("returns null for an unknown game rather than a broken path", () => {
    expect(gameIcon("not-a-game")).toBeNull();
    expect(gameIcon(null)).toBeNull();
    expect(gameIcon(undefined)).toBeNull();
  });

  it("covers exactly the catalogue — no orphan files, no missing games", () => {
    // The map is derived from the directory, so a game with artwork and no
    // catalogue entry (e.g. a deleted game whose file was left behind) shows
    // up here as an orphan. Both directions matter.
    expect(Object.keys(GAME_ICONS).sort()).toEqual([...EXPECTED_GAMES].sort());
  });
});

describe("telcoIcon", () => {
  it("resolves every pulsa operator to an asset", () => {
    for (const slug of EXPECTED_TELCOS) {
      const icon = telcoIcon(slug);
      expect(icon, `operator "${slug}" has no logo`).toMatch(/^\/icons\/telcos\//);
    }
  });

  it("covers exactly the operator list", () => {
    expect(Object.keys(TELCO_ICONS).sort()).toEqual([...EXPECTED_TELCOS].sort());
  });
});

describe("paymentIcon", () => {
  it("resolves each offline bank method to its bank's logo", () => {
    expect(paymentIcon("manual_bank_bca")).toBe("/icons/banks/bank-bca.png");
    expect(paymentIcon("manual_bank_mandiri")).toBe("/icons/banks/bank-mandiri.png");
    expect(paymentIcon("manual_bank_bni")).toBe("/icons/banks/bank-bni.png");
    expect(paymentIcon("manual_bank_bri")).toBe("/icons/banks/bank-bri.png");
  });

  it("resolves the Permata VA to its logo", () => {
    // Permata is a live VA method (va_permata) but has no manual-transfer twin.
    // Its artwork is an SVG, unlike the other banks' PNGs.
    expect(paymentIcon("va_permata")).toBe("/icons/banks/bank-permata.svg");
  });

  it("resolves each offline e-wallet method to its wallet's logo", () => {
    expect(paymentIcon("manual_ewallet_dana")).toBe("/icons/ewallets/ewallet-dana.png");
    expect(paymentIcon("manual_ewallet_ovo")).toBe("/icons/ewallets/ewallet-ovo.png");
    expect(paymentIcon("manual_ewallet_gopay")).toBe("/icons/ewallets/ewallet-gopay.png");
    expect(paymentIcon("manual_ewallet_shopeepay")).toBe("/icons/ewallets/ewallet-shopee-pay.png");
  });

  it("shares one logo across both of a bank's methods", () => {
    // A bank transfer and that bank's virtual account are the same brand to the
    // customer, so the icon is keyed on the brand, not the method.
    expect(paymentIcon("va_bca")).toBe(paymentIcon("manual_bank_bca"));
  });

  it("returns null for methods that have no brand mark", () => {
    // The generic fallback and the legacy alias are not brands.
    expect(paymentIcon("manual_bank_lainnya")).toBeNull();
    expect(paymentIcon("manual_transfer")).toBeNull();
    expect(paymentIcon("retail_indomaret")).toBeNull();
    expect(paymentIcon("")).toBeNull();
    expect(paymentIcon(null)).toBeNull();
  });
});

describe("productIcon", () => {
  it("resolves a pulsa product to the operator logo", () => {
    // For pulsa the PRODUCT is the operator, so the product slug carries the
    // brand, resolving by game slug here would be wrong for every operator.
    expect(productIcon({ gameSlug: "pulsa", productSlug: "telkomsel" })).toBe(
      "/icons/telcos/telco-telkomsel.png"
    );
  });

  it("resolves a game product to the game icon", () => {
    expect(productIcon({ gameSlug: "mobile-legends", productSlug: "diamonds" })).toBe(
      "/icons/games/mobile-legends.png"
    );
  });

  it("returns null when neither carries a brand", () => {
    expect(productIcon({})).toBeNull();
    expect(productIcon({ gameSlug: "unknown", productSlug: "unknown" })).toBeNull();
  });
});
