// ============================================================================
// SEO metadata builders: titles and descriptions for game pages.
//
// WHY THESE ARE TESTED
//
// The builders decide what 30+ pages announce in search results. They are pure
// functions of catalogue data, which makes them cheap to test exhaustively —
// and they are exactly the kind of code where a silent bug (an empty title, a
// description naming a price that does not exist) ships unnoticed because the
// page still renders. A customer never sees a missing meta description; Search
// Console does, weeks later.
// ============================================================================
import { describe, it, expect } from "vitest";
import { buildGameTitle, buildGameDescription, buildOperatorDescription } from "@/lib/seo-meta.js";

describe("buildGameTitle", () => {
  it("names the currency the page sells, not just the game", () => {
    expect(buildGameTitle("Mobile Legends", "GAME", ["Diamonds", "Weekly Pass"]))
      .toBe("Top Up Mobile Legends (Diamonds, Weekly Pass)");
  });

  it("uses only the first two product names so the title stays a sentence", () => {
    const title = buildGameTitle("Genshin Impact", "GAME", [
      "Genesis Crystals",
      "Blessing of the Welkin Moon",
      "Something Else",
    ]);
    expect(title).toBe("Top Up Genshin Impact (Genesis Crystals, Blessing of the Welkin Moon)");
  });

  it("falls back to the game name alone when products are unknown", () => {
    expect(buildGameTitle("Roblox", "GAME", [])).toBe("Top Up Roblox");
  });

  it("ignores empty and non-string product names", () => {
    expect(buildGameTitle("Roblox", "GAME", ["", null, undefined])).toBe("Top Up Roblox");
  });

  it("returns undefined for a missing game name so the caller can noindex", () => {
    expect(buildGameTitle(undefined, "GAME", ["Diamonds"])).toBeUndefined();
    expect(buildGameTitle("", "GAME", ["Diamonds"])).toBeUndefined();
    expect(buildGameTitle(null, "GAME", ["Diamonds"])).toBeUndefined();
  });

  it("collapses region products that share one currency word", () => {
    // "CP (Global), CP (Indonesia)" reads as a list of two CPs; the currency is
    // named once and the region labels follow it.
    expect(buildGameTitle("Call of Duty Mobile", "GAME", ["CP (Global)", "CP (Indonesia)"]))
      .toBe("Top Up Call of Duty Mobile (CP Global / Indonesia)");
  });

  it("keeps a single region product intact", () => {
    expect(buildGameTitle("Call of Duty Mobile", "GAME", ["CP (Global)"]))
      .toBe("Top Up Call of Duty Mobile (CP (Global))");
  });

  it("keeps distinct product names side by side", () => {
    expect(buildGameTitle("eFootball", "GAME", ["eFootball Coins (iOS)", "eFootball Coins (Android)"]))
      .toBe("Top Up eFootball (eFootball Coins (iOS), eFootball Coins (Android))");
  });
});

describe("buildGameDescription", () => {
  it("prefers the human-written game description and appends the price", () => {
    const description = buildGameDescription({
      gameName: "Mobile Legends",
      description: "Top up Diamond Mobile Legends: Bang Bang secara instan.",
      productNames: ["Diamonds"],
      minPrice: 1700,
    });

    expect(description).toBe(
      "Top up Diamond Mobile Legends: Bang Bang secara instan. mulai dari Rp 1.700"
    );
  });

  it("does not append a price line when there is no price", () => {
    const description = buildGameDescription({
      gameName: "Genshin Impact",
      description: "Top up Genesis Crystals Genshin Impact.",
      productNames: ["Genesis Crystals"],
      minPrice: null,
    });

    expect(description).toBe("Top up Genesis Crystals Genshin Impact.");
  });

  it("builds a generated description naming the nominal and the process", () => {
    expect(
      buildGameDescription({
        gameName: "Free Fire",
        description: null,
        productNames: ["Diamond"],
        minPrice: 1000,
      })
    ).toBe("Top up Free Fire, pilih nominal Diamond, proses otomatis 24 jam. mulai dari Rp 1.000");
  });

  it("generated description without currencies omits the nominal clause", () => {
    expect(
      buildGameDescription({
        gameName: "Free Fire",
        description: "",
        productNames: [],
        minPrice: 5000,
      })
    ).toBe("Top up Free Fire, proses otomatis 24 jam. mulai dari Rp 5.000");
  });

  it("returns undefined without a game name", () => {
    expect(
      buildGameDescription({ gameName: null, description: "x", productNames: [], minPrice: 100 })
    ).toBeUndefined();
  });

  it("never claims an exact price, only a starting threshold", () => {
    const description = buildGameDescription({
      gameName: "PUBG Mobile",
      description: null,
      productNames: ["UC"],
      minPrice: 7600,
    });

    // 7.600 rounds DOWN to 7.600, but an odd figure like 7.647 becomes 7.600,
    // so a small price move does not make the cached description wrong.
    expect(description).toContain("mulai dari");
    expect(description).not.toContain("Rp 7.647");
  });

  it("rounds larger prices down to a credible step", () => {
    const description = buildGameDescription({
      gameName: "PUBG Mobile",
      description: null,
      productNames: ["UC"],
      minPrice: 256440,
    });

    expect(description).toContain("Rp 256.000");
  });

  it("omits the price line for a zero or negative price", () => {
    expect(
      buildGameDescription({ gameName: "X", description: null, productNames: [], minPrice: 0 })
    ).not.toContain("mulai dari");

    expect(
      buildGameDescription({ gameName: "X", description: null, productNames: [], minPrice: -5 })
    ).not.toContain("mulai dari");
  });
});

describe("buildOperatorDescription", () => {
  it("builds a nominal-and-price description so operator pages differ", () => {
    expect(
      buildOperatorDescription({ operatorName: "Telkomsel", description: null, minPrice: 6900 })
    ).toBe(
      "Isi pulsa Telkomsel dengan nominal pilihan, proses otomatis 24 jam, harga transparan, mulai dari Rp 6.900"
    );
  });

  it("prefers a stored operator description and appends the price", () => {
    expect(
      buildOperatorDescription({
        operatorName: "Indosat",
        description: "Pulsa Indosat Ooredoo.",
        minPrice: 6700,
      })
    ).toBe("Pulsa Indosat Ooredoo. mulai dari Rp 6.700");
  });

  it("omits the price line when the operator has no price", () => {
    expect(
      buildOperatorDescription({ operatorName: "XL", description: null, minPrice: null })
    ).toBe("Isi pulsa XL dengan nominal pilihan, proses otomatis 24 jam, harga transparan");
  });

  it("returns undefined without an operator name", () => {
    expect(
      buildOperatorDescription({ operatorName: null, description: null, minPrice: 1000 })
    ).toBeUndefined();
  });
});
