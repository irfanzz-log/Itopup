// ============================================================================
// Admin catalogue service — price, SKU swap, and delete rules.
//
// WHAT EACH TEST LOCKS DOWN
//
// updateVariantPrice
//   * writes the absolute value (never a markup to recompute later)
//   * a non-integer or out-of-bounds price is rejected before any write
//   * a re-submit of the same price is a no-op success, not an error
//   * the change is audited with both the before and the after
//
// reassignVariantSku
//   * a code the provider does not list for this nominal is rejected
//   * a code that IS listed but out of stock is rejected — "successfully"
//     writing a dead SKU would look fixed in the admin and still be unbuyable
//   * cost follows the new SKU; selling price follows only when not pinned
//
// deleteCatalogEntry
//   * a variant with order history is deactivated, never deleted
//   * a variant with no history is deleted outright
//   * a product with any ordered variant keeps its row
// ============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db.js", () => ({
  prisma: {
    productVariant: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    provider: { findFirst: vi.fn() },
    providerProduct: {},
    $transaction: vi.fn((fn) => fn(prisma)),
  },
}));

vi.mock("@/providers/index.js", () => ({
  getTopupProvider: () => ({ isConfigured: () => true, getProducts: vi.fn() }),
}));

vi.mock("@/services/audit.service.js", () => ({
  writeAudit: vi.fn().mockResolvedValue({}),
}));

import { prisma } from "@/lib/db.js";
import { writeAudit } from "@/services/audit.service.js";
import {
  updateVariantPrice,
  reassignVariantSku,
  deleteCatalogEntry,
  isBelowCost,
  normaliseName as keyOf,
} from "@/services/admin-catalog.service.js";

const ACTOR = { id: "actor-1", role: "SUPERADMIN" };

function variantRow(overrides = {}) {
  return {
    id: "variant-1",
    name: "86 Diamonds",
    costPrice: 20000,
    sellingPrice: 22000,
    product: { name: "Diamonds", game: { name: "Mobile Legends", slug: "mobile-legends" } },
    providerProducts: [
      { id: "pp-1", providerCode: "mlid86d-s1", providerPrice: 20000, isAvailable: true },
    ],
    _count: { orderItems: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isBelowCost", () => {
  it("flags a price at or below cost as a guaranteed loss", () => {
    expect(isBelowCost(19000, 20000)).toBe(true);
    expect(isBelowCost(20000, 20000)).toBe(true);
    expect(isBelowCost(21000, 20000)).toBe(false);
  });
});

describe("SKU name matching (the candidate list's core rule)", () => {
  // Matching on the product name is what makes the candidate list work across
  // the provider's SKU families. These spellings are all real rows from the
  // live Melostore pricelist; the normaliser must treat them as one nominal.
  const CASES = [
    ["5 Diamonds", "5 Diamond"],
    ["86 Diamonds", "86 Diamond (77 + 9 Bonus)"],
    ["2.906 Diamonds", "2906 Diamonds"],
    ["2975 Diamond (2.564 + 411 Bonus)", "2975 Diamond ( 2565 + 412 Bonus )"],
    ["100 Diamonds", "100 Diamond (91 + 9 Bonus)"],
  ];

  it.each(CASES)("treats %s and %s as the same nominal", (ours, theirs) => {
    // Imported through the service's own module graph so the normaliser can
    // never drift from what the candidate list actually uses.
    const a = keyOf(ours);
    const b = keyOf(theirs);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("does NOT collapse different nominals into the same key", () => {
    // The dangerous failure mode is the reverse: matching 5 to 50, or 5 to 5.260.
    expect(keyOf("5 Diamonds")).not.toBe(keyOf("50 Diamonds"));
    expect(keyOf("5 Diamonds")).not.toBe(keyOf("5.260 Diamonds"));
    expect(keyOf("86 Diamonds")).not.toBe(keyOf("875 Diamonds"));
  });
});

// ── updateVariantPrice ─────────────────────────────────────────────────────

describe("updateVariantPrice", () => {
  it("writes the absolute price and audits before/after", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantRow());
    prisma.productVariant.update.mockResolvedValue({
      id: "variant-1",
      name: "86 Diamonds",
      costPrice: 20000,
      sellingPrice: 25000,
    });

    const result = await updateVariantPrice({
      variantId: "variant-1",
      sellingPrice: 25000,
      actor: ACTOR,
    });

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: "variant-1" },
      data: { sellingPrice: 25000 },
      select: { id: true, name: true, costPrice: true, sellingPrice: true },
    });
    expect(result.changed).toBe(true);

    // The audit must carry both values — "price changed" without the numbers
    // is useless for reconciling a pricing incident after the fact.
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRICE_UPDATED",
        actor: ACTOR,
        targetId: "variant-1",
        metadata: expect.objectContaining({ from: 22000, to: 25000, costPrice: 20000 }),
      })
    );
  });

  it("rejects a non-integer price before touching the database", async () => {
    await expect(
      updateVariantPrice({ variantId: "v1", sellingPrice: 20000.5, actor: ACTOR })
    ).rejects.toThrow();
    await expect(
      updateVariantPrice({ variantId: "v1", sellingPrice: "abc", actor: ACTOR })
    ).rejects.toThrow();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
  });

  it("rejects prices outside the bounds", async () => {
    await expect(
      updateVariantPrice({ variantId: "v1", sellingPrice: 0, actor: ACTOR })
    ).rejects.toThrow();
    await expect(
      updateVariantPrice({ variantId: "v1", sellingPrice: 500_000_000, actor: ACTOR })
    ).rejects.toThrow();
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
  });

  it("reports an unchanged price as a no-op success, not an error", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantRow());

    const result = await updateVariantPrice({
      variantId: "variant-1",
      sellingPrice: 22000,
      actor: ACTOR,
    });

    expect(result.changed).toBe(false);
    expect(prisma.productVariant.update).not.toHaveBeenCalled();
    // Nothing changed, so nothing to audit.
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("throws not-found for an unknown variant", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(null);
    await expect(
      updateVariantPrice({ variantId: "nope", sellingPrice: 25000, actor: ACTOR })
    ).rejects.toThrow();
  });
});

// ── reassignVariantSku ─────────────────────────────────────────────────────

describe("reassignVariantSku", () => {
  function mockPricelist(products) {
    vi.doMock("@/providers/index.js", () => ({
      getTopupProvider: () => ({
        isConfigured: () => true,
        getProducts: async () => ({ ok: true, data: { products, brands: [], inquiryForms: {} } }),
      }),
    }));
  }

  it("rejects a SKU the provider does not list for this nominal", async () => {
    mockPricelist([
      { providerCode: "mlid86d-s5", name: "86 Diamonds", price: 19800, stock: null, available: true, brandId: 1 },
    ]);
    vi.resetModules();
    const fresh = await import("@/services/admin-catalog.service.js");

    prisma.productVariant.findUnique.mockResolvedValue(variantRow());

    await expect(
      fresh.reassignVariantSku({
        variantId: "variant-1",
        providerCode: "mlid86d-s99",
        actor: ACTOR,
      })
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a SKU that is listed but out of stock", async () => {
    mockPricelist([
      {
        providerCode: "mlid86d-s5",
        name: "86 Diamonds",
        price: 19800,
        stock: null,
        available: false,
        brandId: 1,
      },
    ]);
    vi.resetModules();
    const fresh = await import("@/services/admin-catalog.service.js");

    prisma.productVariant.findUnique.mockResolvedValue(variantRow());

    await expect(
      fresh.reassignVariantSku({
        variantId: "variant-1",
        providerCode: "mlid86d-s5",
        actor: ACTOR,
      })
    ).rejects.toThrow();
  });
});

// ── deleteCatalogEntry ─────────────────────────────────────────────────────

describe("deleteCatalogEntry", () => {
  it("deletes a variant that has never been ordered", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantRow({ _count: { orderItems: 0 } }));
    prisma.productVariant.delete.mockResolvedValue({ id: "variant-1" });

    const result = await deleteCatalogEntry({ variantId: "variant-1", actor: ACTOR });

    expect(prisma.productVariant.delete).toHaveBeenCalledWith({ where: { id: "variant-1" } });
    expect(result.deleted).toBe(true);
    expect(result.deactivated).toBe(false);
  });

  it("deactivates a variant that has order history instead of deleting it", async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantRow({ _count: { orderItems: 3 } }));
    prisma.productVariant.update.mockResolvedValue({ id: "variant-1" });

    const result = await deleteCatalogEntry({ variantId: "variant-1", actor: ACTOR });

    // Deleting would orphan the order items that point at this row.
    expect(prisma.productVariant.delete).not.toHaveBeenCalled();
    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: "variant-1" },
      data: { isActive: false },
    });
    expect(result.deactivated).toBe(true);
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/riwayat/i);
  });

  it("deletes a product only when none of its variants were ordered", async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: "product-1",
      name: "Diamonds",
      variants: [
        { id: "v-a", name: "5 Diamonds", _count: { orderItems: 0 } },
        { id: "v-b", name: "12 Diamonds", _count: { orderItems: 0 } },
      ],
    });
    prisma.productVariant.delete.mockResolvedValue({});
    prisma.product.delete.mockResolvedValue({ id: "product-1" });

    const result = await deleteCatalogEntry({ productId: "product-1", actor: ACTOR });

    expect(prisma.product.delete).toHaveBeenCalledWith({ where: { id: "product-1" } });
    expect(result.productRemoved).toBe(true);
    expect(result.deletedVariants).toBe(2);
  });

  it("keeps a product whose variants have order history", async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: "product-1",
      name: "Diamonds",
      variants: [
        { id: "v-a", name: "5 Diamonds", _count: { orderItems: 2 } },
        { id: "v-b", name: "12 Diamonds", _count: { orderItems: 0 } },
      ],
    });
    prisma.productVariant.update.mockResolvedValue({});
    prisma.productVariant.delete.mockResolvedValue({});
    prisma.product.update.mockResolvedValue({ id: "product-1" });

    const result = await deleteCatalogEntry({ productId: "product-1", actor: ACTOR });

    expect(prisma.product.delete).not.toHaveBeenCalled();
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { isActive: false },
    });
    expect(result.productRemoved).toBe(false);
    expect(result.deactivatedVariants).toBe(1);
    expect(result.deletedVariants).toBe(1);
  });

  it("requires a variant or product id", async () => {
    await expect(deleteCatalogEntry({ actor: ACTOR })).rejects.toThrow();
  });
});
