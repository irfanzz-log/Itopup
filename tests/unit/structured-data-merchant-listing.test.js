// ============================================================================
// Merchant-listing structured data: the four fields Search Console reported.
//
// THE REPORT (22 Oct, 4 affected item types):
//
//   critical   Kolom "image" tidak ada
//   non-crit   Kolom "hasMerchantReturnPolicy" tidak ada (dalam "offers")
//   non-crit   Kolom "shippingDetails" tidak ada (dalam "offers")
//   non-crit   Kolom "description" tidak ada
//
// Confirmed against production before changing anything: the live Product node
// for /topup/game/mobile-legends had keys [@type, name, description, url,
// brand, offers] and its Offer had no return policy or shipping details, and
// /topup/pulsa/telkomsen had no description at all. So these are not stale
// findings — the markup really was missing all four.
//
// Every assertion below FAILS against that markup, which is the point: a test
// that merely checked "offers exist" passed happily while Search Console was
// refusing to show the pages.
// ============================================================================
import { describe, it, expect } from "vitest";
import { productJsonLd } from "../../src/lib/json-ld.js";
import {
  merchantReturnPolicy,
  shippingDetails,
  productImageUrls,
  meetsImageRecommendation,
} from "../../src/lib/structured-data-assets.js";

/** The Product node out of a productJsonLd() graph. */
function productNode(payload) {
  return payload["@graph"].find((node) => node["@type"] === "Product");
}

const BASE = {
  name: "Top Up Mobile Legends",
  description: "Top up Diamond Mobile Legends: Bang Bang secara instan.",
  path: "/topup/game/mobile-legends",
  offers: [{ price: 1600, availability: "https://schema.org/InStock" }],
  images: ["https://itopup.my.id/icons/games/mobile-legends.png"],
};

describe("Product.image (the critical finding)", () => {
  it("emits the image the caller resolved", () => {
    const node = productNode(productJsonLd(BASE));
    expect(node.image).toBe("https://itopup.my.id/icons/games/mobile-legends.png");
  });

  it("emits several images as an array when the caller has them", () => {
    const node = productNode(
      productJsonLd({
        ...BASE,
        images: ["https://itopup.my.id/a.webp", "https://itopup.my.id/b.png"],
      })
    );
    expect(Array.isArray(node.image)).toBe(true);
    expect(node.image).toHaveLength(2);
  });

  it("omits the key entirely rather than emitting an empty value", () => {
    // An empty string or [] is a broken image reference; absence is honest and
    // shows up in the validator as the one remaining error.
    const node = productNode(productJsonLd({ ...BASE, images: [] }));
    expect("image" in node).toBe(false);
  });
});

describe("Offer.hasMerchantReturnPolicy", () => {
  it("is present on every offer", () => {
    const offer = productNode(productJsonLd(BASE)).offers;
    expect(offer.hasMerchantReturnPolicy).toBeTruthy();
  });

  it("states the policy the terms page actually has, not a return window", () => {
    const policy = merchantReturnPolicy();
    // /syarat §3 and §5: a dispatched top-up cannot be cancelled or returned.
    expect(policy.returnPolicyCategory).toBe("https://schema.org/MerchantReturnNotPermitted");
    expect(policy.applicableCountry).toBe("ID");
    // A finite window would be a promise the business does not make.
    expect(policy.merchantReturnDays).toBeUndefined();
  });

  it("links to the page that states the rule, so the claim is checkable", () => {
    expect(merchantReturnPolicy().merchantReturnLink).toMatch(/\/syarat$/);
  });
});

describe("Offer.shippingDetails", () => {
  it("is present on every offer", () => {
    const offer = productNode(productJsonLd(BASE)).offers;
    expect(offer.shippingDetails).toBeTruthy();
  });

  it("says delivery costs nothing and is confined to Indonesia", () => {
    const shipping = shippingDetails();
    expect(shipping.shippingRate.value).toBe(0);
    expect(shipping.shippingRate.currency).toBe("IDR");
    expect(shipping.shippingDestination.addressCountry).toBe("ID");
  });

  // Google requires deliveryTime, and a digital good is the one case where a
  // sub-day window is the truthful answer.
  it("carries a delivery window", () => {
    const { deliveryTime } = shippingDetails();
    expect(deliveryTime["@type"]).toBe("ShippingDeliveryTime");
    expect(deliveryTime.handlingTime.unitCode).toBe("DAY");
    expect(deliveryTime.transitTime.maxValue).toBeLessThanOrEqual(1);
  });
});

describe("Product.description", () => {
  it("is emitted when the caller supplies one", () => {
    expect(productNode(productJsonLd(BASE)).description).toBe(BASE.description);
  });

  it("is omitted rather than empty when there is nothing true to say", () => {
    const node = productNode(productJsonLd({ ...BASE, description: "" }));
    expect("description" in node).toBe(false);
  });
});

describe("productImageUrls", () => {
  it("makes local paths absolute and crawlable", () => {
    const urls = productImageUrls([{ path: "/icons/games/x.png", width: 500, height: 500 }]);
    // Absolute, not a bare "/icons/..." — Search Console cannot resolve a
    // relative image URL in structured data. The origin itself is whatever
    // SITE_URL resolves to (localhost under test, the real domain in prod).
    expect(urls[0]).toMatch(/^https?:\/\/[^/]+\/icons\/games\/x\.png$/);
  });

  // The regression this guards: treating Google's 50K-pixel RECOMMENDATION as
  // a filter drops the 160×160 telco logos and leaves those pages with the
  // CRITICAL missing-image error — strictly worse than a small image.
  it("keeps a small image rather than returning none", () => {
    const small = [{ path: "/icons/telcos/telco-xl.png", width: 160, height: 160 }];
    expect(productImageUrls(small)).toHaveLength(1);
    expect(meetsImageRecommendation(small)).toBe(false);
  });

  it("puts the largest image first", () => {
    const urls = productImageUrls([
      { path: "/icons/small.png", width: 160, height: 160 },
      { path: "/icons/big.webp", width: 1200, height: 1200 },
    ]);
    expect(urls[0]).toMatch(/big\.webp$/);
  });

  it("orders raster before vector, largest first", () => {
    const urls = productImageUrls([
      { path: "/icons/games/x.svg" },
      { path: "/icons/small.png", width: 160, height: 160 },
      { path: "/icons/big.webp", width: 1200, height: 1200 },
    ]);
    expect(urls[0]).toMatch(/big\.webp$/);
    expect(urls[1]).toMatch(/small\.png$/);
    expect(urls[2]).toMatch(/x\.svg$/);
  });

  // Google Images lists SVG among its supported formats, so a game whose only
  // artwork is vector must still get an image — excluding it produced the very
  // critical error this change exists to fix (eFootball).
  it("keeps an SVG rather than emitting no image at all", () => {
    const urls = productImageUrls([{ path: "/icons/games/efootball.svg" }]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/efootball\.svg$/);
  });

  it("drops empty and non-path entries instead of emitting nulls", () => {
    expect(productImageUrls([null, {}, { path: "" }, { path: "/ok.png", width: 900, height: 900 }]))
      .toHaveLength(1);
  });
});
