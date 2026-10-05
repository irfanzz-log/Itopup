// ============================================================================
// Category resolution, the catalogue has exactly two kinds.
//
// THE CHANGE THESE TESTS LOCK DOWN
//
// The E_WALLET catalogue (DANA / OVO / GoPay / ShopeePay) was removed: the
// seed config no longer lists it, the routes no longer accept the segment, and
// the DB rows are gone. `resolveCategoryKind` is the boundary between a URL a
// customer may type and a Prisma query, it must resolve only what exists, and
// return null for everything else so the caller 404s rather than silently
// defaulting to GAME (which would make /topup/e-wallet render the game list
// and look like a bug rather than a 404).
//
// Accepting the removed kind is worse than refusing it: the query would return
// no rows, and the page would render an empty category with no explanation.
// ============================================================================
import { describe, it, expect } from "vitest";
import { resolveCategoryKind } from "@/services/catalog.service.js";

describe("resolveCategoryKind", () => {
  it("resolves the two kinds that still exist", () => {
    // URL segment and the kind itself both work; the two spellings appear in
    // different callers and a refactor must not silently break either.
    expect(resolveCategoryKind("game")).toBe("GAME");
    expect(resolveCategoryKind("pulsa")).toBe("PULSA");
    expect(resolveCategoryKind("GAME")).toBe("GAME");
    expect(resolveCategoryKind("PULSA")).toBe("PULSA");
  });

  it("refuses the removed e-wallet catalogue", () => {
    // Both spellings a customer or a stale link might carry.
    expect(resolveCategoryKind("e-wallet")).toBe(null);
    expect(resolveCategoryKind("E_WALLET")).toBe(null);
    expect(resolveCategoryKind("E-Wallet")).toBe(null);
  });

  it("refuses a removed wallet game as a category", () => {
    // A game slug is not a category; resolving it would run a category query
    // against game data and return an empty list.
    expect(resolveCategoryKind("dana")).toBe(null);
    expect(resolveCategoryKind("gopay")).toBe(null);
  });

  it("refuses empty and nonsense input instead of defaulting to game", () => {
    // Defaulting would make any typo render the game list, the customer thinks
    // the category exists and something is merely broken.
    expect(resolveCategoryKind(null)).toBe(null);
    expect(resolveCategoryKind("")).toBe(null);
    expect(resolveCategoryKind("    ")).toBe(null);
    expect(resolveCategoryKind("qris")).toBe(null);
  });
});
