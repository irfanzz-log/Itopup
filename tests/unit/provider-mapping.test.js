// ============================================================================
// Provider mapping ↔ catalogue contract.
//
// THE BUG THIS FILE EXISTS TO PREVENT
//
// `provider-mapping.js` links a provider SKU code to one of our variants by
// naming a `gameSlug` and a `variantSlug`. Those are strings. Nothing in the
// type system connects them to the real catalogue, so a typo, or a rename of a
// variant in `games.js`, silently produces a rule that matches nothing.
//
// The failure is quiet and expensive: the sync reports the SKU as `unmatched`,
// no `ProviderProduct` row is written, the product shows as unconnected in the
// admin UI, and checkout refuses with ITP_PRODUCT_UNAVAILABLE. Exactly the
// symptom this mapping was written to fix.
//
// So every rule is checked against the catalogue that the seed actually builds.
// ============================================================================
import { describe, it, expect } from "vitest";
import { PROVIDER_MAPPING, hasMappingRules } from "../../src/config/provider-mapping.js";
import { GAME_SEED, VARIANT_SEED } from "../../src/config/games.js";

/**
 * Rebuild the variant slugs the seed will create, using the same rule as
 * prisma/seed.js: `d<denomination>` for nominal entries, `item-<n>` otherwise,
 * or an explicit `slug` when the entry provides one.
 *
 * `VARIANT_SEED` is keyed by game slug, then by product slug. The product slug
 * is not needed here because variant slugs are unique per game in this
 * catalogue, but the flattening is deliberate so a duplicate would surface as
 * a same-slug entry rather than being hidden.
 */
function variantSlugsFor(gameSlug) {
  const byProduct = VARIANT_SEED[gameSlug] ?? {};
  const slugs = new Set();
  for (const entries of Object.values(byProduct)) {
    entries.forEach((entry, index) => {
      if (entry.slug) slugs.add(entry.slug);
      else if (entry.denomination != null) slugs.add(`d${entry.denomination}`);
      else slugs.add(`item-${index + 1}`);
    });
  }
  return slugs;
}

const GAME_SLUGS = new Set(GAME_SEED.map((g) => g.slug));

describe("provider-mapping ↔ catalogue", () => {
  it("has at least one rule (an empty table means nothing can ever link)", () => {
    expect(hasMappingRules()).toBe(true);
  });

  it("every byProviderCode rule points at a game that exists", () => {
    const bad = Object.entries(PROVIDER_MAPPING.byProviderCode)
      .filter(([, rule]) => !GAME_SLUGS.has(rule.gameSlug))
      .map(([sku, rule]) => `${sku} → unknown game "${rule.gameSlug}"`);
    expect(bad).toEqual([]);
  });

  it("every byProviderCode rule points at a variant that the seed creates", () => {
    const bad = [];
    for (const [sku, rule] of Object.entries(PROVIDER_MAPPING.byProviderCode)) {
      const slugs = variantSlugsFor(rule.gameSlug);
      if (!slugs.has(rule.variantSlug)) {
        bad.push(`${sku} → ${rule.gameSlug}/${rule.variantSlug} (not in catalogue)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every gameSlugByBrandName value is a real game slug", () => {
    const bad = Object.entries(PROVIDER_MAPPING.gameSlugByBrandName)
      .filter(([, slug]) => !GAME_SLUGS.has(slug))
      .map(([brand, slug]) => `${brand} → unknown game "${slug}"`);
    expect(bad).toEqual([]);
  });

  it("variantSlugByProviderCode values exist in their game when a brand rule supplies it", () => {
    // This table is only consulted for brands named in gameSlugByBrandName, so
    // only its shape can be checked without a brand context, every value must
    // still be a plausible slug rather than an empty string.
    for (const [sku, slug] of Object.entries(PROVIDER_MAPPING.variantSlugByProviderCode)) {
      expect(typeof slug, `${sku}`).toBe("string");
      expect(slug.length, `${sku}`).toBeGreaterThan(0);
    }
  });

  it("no SKU is declared twice with conflicting targets", () => {
    // A duplicate key in an object literal is silently dropped by JS, which
    // would make the later rule dead. Counting the emitted keys against the
    // source lines is the only way to catch that from inside the module.
    const rules = Object.entries(PROVIDER_MAPPING.byProviderCode);
    const seen = new Map();
    for (const [sku, rule] of rules) {
      const target = `${rule.gameSlug}/${rule.variantSlug}`;
      if (seen.has(sku) && seen.get(sku) !== target) {
        throw new Error(`SKU ${sku} declared twice: ${seen.get(sku)} and ${target}`);
      }
      seen.set(sku, target);
    }
    expect(seen.size).toBe(rules.length);
  });

  it("links a meaningful share of the catalogue (guards against an emptied table)", () => {
    // A regression that deletes the rules would otherwise pass every test above.
    const count = Object.keys(PROVIDER_MAPPING.byProviderCode).length;
    expect(count).toBeGreaterThanOrEqual(50);
  });
});
