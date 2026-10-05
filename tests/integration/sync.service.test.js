// ============================================================================
// Catalog sync, end-to-end against a MOCKED fetch.
//
// This is the strongest available proof short of a real partner account: the
// real adapter code path runs (client → auth headers → mapper → sync service →
// database), with only the network boundary replaced. The mocked responses are
// the payloads printed in the official Melostore documentation.
//
// What it verifies:
//   * the documented auth headers are actually sent,
//   * the documented `limit`/`cursor` pagination is followed,
//   * a matched SKU updates costPrice and derives sellingPrice,
//   * an admin-pinned sellingPrice is NOT overwritten,
//   * an unmatched SKU is REPORTED, never silently linked,
//   * dryRun writes nothing.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../../src/lib/db.js";
import { syncProviderCatalog } from "../../src/services/sync.service.js";
import { AUTH_HEADERS } from "../../src/providers/melostore/signature.js";

const ENV = {
  MELOSTORE_BASE_URL: "https://api.melostore.test",
  MELOSTORE_API_KEY: "test-api-key",
  MELOSTORE_SECRET: "test-secret-key",
  MELOSTORE_WEBHOOK_SECRET: "test-webhook-secret",
};
const savedEnv = {};

/** A documented compact pricelist row. */
function row(overrides) {
  return {
    name: "1.045 Diamonds",
    sku_code: "ml-id-1045",
    price: 263316,
    category_name: "Game",
    brand_id: 12,
    type_name: "ML Diamonds",
    server_code: "S1",
    server_name: "Server 1",
    status: "active",
    inquiry_form_key: "form-key-ml",
    ...overrides,
  };
}

/** Documented `meta` block. */
function meta(overrides = {}) {
  return {
    brands: [{ id: 12, name: "Mobile Legends (Indonesia)", thumbnail: null, order: 1 }],
    inquiry_forms: {
      "form-key-ml": {
        fields: [
          { key: "target_id", name: "User ID", type: "text", placeholder: "Masukkan User ID" },
          { key: "target_zone", name: "Zone ID", type: "text", placeholder: "Masukkan Zone ID" },
        ],
      },
    },
    pagination: { cursor: null, next_cursor: null, limit: 500, total: 1, has_more: false },
    ...overrides,
  };
}

let fetchMock;

beforeEach(async () => {
  for (const [k, v] of Object.entries(ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  // Minimal catalogue the sync can link against.
  const category = await prisma.category.create({
    data: { kind: "GAME", name: "Game", slug: "game" },
  });
  const game = await prisma.game.create({
    data: { categoryId: category.id, name: "Mobile Legends", slug: "mobile-legends" },
  });
  const product = await prisma.product.create({
    data: { gameId: game.id, name: "Diamonds", slug: "diamonds" },
  });
  await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: "1045 Diamonds",
      slug: "1045-diamonds",
      denomination: 1045,
      unit: "Diamonds",
      costPrice: 250000,
      sellingPrice: 270000,
    },
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await prisma.providerProduct.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.game.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.provider.deleteMany({});
});

/** Reply to any request with a documented pricelist envelope. */
function replyWith(data, metaBlock) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ success: true, data, meta: metaBlock }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

describe("syncProviderCatalog", () => {
  it("sends the documented auth headers and limit parameter", async () => {
    replyWith([row()], meta());

    await syncProviderCatalog({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toContain("/api/v1/h2h/pricelists");
    // The docs make `limit` mandatory after 28 Aug 2026, so it is always sent.
    expect(url).toContain("limit=");
    expect(init.method).toBe("GET");
    expect(init.headers[AUTH_HEADERS.apiKey]).toBe("test-api-key");
    expect(init.headers[AUTH_HEADERS.secretKey]).toBe("test-secret-key");
  });

  it("follows the documented cursor pagination", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [row({ sku_code: "page-1" })],
            meta: meta({
              pagination: { cursor: null, next_cursor: "CURSOR==", limit: 500, total: 2, has_more: true },
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [row({ sku_code: "page-2" })],
            meta: meta({
              pagination: { cursor: "CURSOR==", next_cursor: null, limit: 500, total: 2, has_more: false },
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const report = await syncProviderCatalog({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=CURSOR%3D%3D");
    expect(report.fetched).toBe(2);
  });

  it("REPORTS an unmatched SKU instead of linking it", async () => {
    // No mapping rule exists for this SKU, so nothing may be attached to it.
    replyWith([row({ sku_code: "unknown-sku-999" })], meta());

    const report = await syncProviderCatalog({});

    expect(report.unmatched).toHaveLength(1);
    expect(report.unmatched[0].providerCode).toBe("unknown-sku-999");
    expect(report.unmatched[0].brand).toBe("Mobile Legends (Indonesia)");

    // Nothing was written.
    expect(await prisma.providerProduct.count()).toBe(0);
  });

  it("dryRun fetches and reports but writes nothing", async () => {
    // Pre-link the SKU so the run has work to do.
    const variant = await prisma.productVariant.findFirstOrThrow({});
    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "ml-id-1045",
        providerPrice: 1,
      },
    });

    replyWith([row()], meta());
    const report = await syncProviderCatalog({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.linked).toBe(1);
    // The stored provider price must still be the old one.
    const after = await prisma.providerProduct.findFirstOrThrow({});
    expect(after.providerPrice).toBe(1);
  });

  it("updates costPrice and derives sellingPrice for a linked SKU", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({});
    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "ml-id-1045",
        providerPrice: 1,
      },
    });

    replyWith([row({ price: 100000 })], meta());
    const report = await syncProviderCatalog({});

    expect(report.linked).toBe(1);

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    // The provider's number is authoritative for COST.
    expect(updated.costPrice).toBe(100000);
    // Selling price is derived server-side, rounded UP to the step (100).
    expect(updated.sellingPrice).toBeGreaterThanOrEqual(108000);
    expect(updated.sellingPrice % 100).toBe(0);
  });

  it("does NOT overwrite an admin-pinned selling price", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({});
    // An admin pinned 999000, deliberately far from any derived value.
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { costPrice: 250000, sellingPrice: 999000 },
    });

    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "ml-id-1045",
        providerPrice: 250000,
      },
    });

    replyWith([row({ price: 100000 })], meta());
    await syncProviderCatalog({});

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.costPrice).toBe(100000);
    // The business decision survives.
    expect(updated.sellingPrice).toBe(999000);
  });

  it("records availability from the provider status", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({});
    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "ml-id-1045",
        providerPrice: 1,
      },
    });

    replyWith([row({ status: "inactive" })], meta());
    const report = await syncProviderCatalog({});

    expect(report.unavailable).toBe(1);
    const link = await prisma.providerProduct.findFirstOrThrow({});
    expect(link.isAvailable).toBe(false);
  });

  it("prices AIRTIME with the flat Rp spread, not the 4% game markup", async () => {
    // The provider's live category_name for pulsa is the LONG string
    // "Airtime & Data (Pulsa & Data)", not "Airtime". An exact comparison fell
    // through and every airtime SKU got the game markup, so a Rp 95.265 card
    // was offered at ~Rp 99.076 instead of Rp 96.265.
    const variant = await prisma.productVariant.findFirstOrThrow({});
    // Start UNPINNED: sellingPrice exactly the derived value for the current
    // cost, so the sync is free to re-derive it.
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { costPrice: 95265, sellingPrice: 96265 },
    });
    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "ml-id-1045",
        providerPrice: 95265,
      },
    });

    replyWith(
      [row({ price: 95265, category_name: "Airtime & Data (Pulsa & Data)" })],
      meta(),
    );
    await syncProviderCatalog({});

    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(updated.costPrice).toBe(95265);
    // Flat Rp 1.000, exactly, no percentage and no rounding step.
    expect(updated.sellingPrice).toBe(96265);
  });


  it("persists the documented brand + inquiry-form reference data", async () => {
    replyWith([row({ sku_code: "unmatched-x" })], meta());
    await syncProviderCatalog({});

    const provider = await prisma.provider.findFirstOrThrow({});
    expect(provider.lastSyncStatus).toMatch(/^ok:/);
    expect(provider.catalogMeta.brands[0].name).toBe("Mobile Legends (Indonesia)");
    expect(provider.catalogMeta.inquiryForms["form-key-ml"].fields).toHaveLength(2);
  });

  it("surfaces a provider 5xx as a sync failure, not an empty catalogue", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );

    // An outage must throw. Returning an empty list would look like "the
    // provider has no products" and would empty the storefront.
    await expect(syncProviderCatalog({})).rejects.toThrow();
  });

  it("fails clearly when credentials are absent", async () => {
    delete process.env.MELOSTORE_API_KEY;
    await expect(syncProviderCatalog({})).rejects.toThrow(/belum dikonfigurasi|ITP_/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── P2002 regression ───────────────────────────────────────────────────
  //
  // REPRODUCES the 2026-09-26 sync failure. The provider lists every e-wallet
  // denomination under several SKU families: MEASURED on DANA, `dnt10ko-s4`,
  // `dzs10ko-s4`, `dgs10ko-s4` and `dpsnoa10ko-s4` all deliver "Rp. 10.000".
  // A mapping rule resolved all of them to the same variant, and because
  // provider_products has @@unique([providerId, productVariantId]) the second
  // insert raised P2002 and rolled back the entire sync, including every
  // other link in the same transaction.
  //
  // Both collision shapes are covered: two brand-new SKUs on one variant, and
  // a new SKU landing on a variant another code already links.
  it("collides two SKU families on one variant without raising P2002", async () => {
    // The storefront variant both families deliver to.
    const game = await prisma.game.findFirstOrThrow({});
    const product = await prisma.product.create({
      data: { gameId: game.id, name: "Saldo DANA", slug: "saldo" },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "10.000 Saldo DANA",
        slug: "d10000",
        denomination: 10000,
        unit: "Rp",
        costPrice: 10640,
        sellingPrice: 11500,
      },
    });

    // Family A is ALREADY LINKED, the row exists under its own provider code.
    const provider = await prisma.provider.create({ data: { code: "melostore", name: "Melostore H2H" } });
    await prisma.providerProduct.create({
      data: {
        providerId: provider.id,
        productVariantId: variant.id,
        providerCode: "dnt10ko-s4",
        providerPrice: 10640,
      },
    });

    // Both families appear in the pricelist. Family A refreshes its own link;
    // family B resolves to the SAME variant. Family C is a third, cheaper
    // family of the same denomination, also new.
    replyWith(
      [
        row({ sku_code: "dnt10ko-s4", price: 10640, name: "Rp. 10.000" }),
        row({ sku_code: "dzs10ko-s4", price: 10574, name: "Rp. 10.000" }),
        row({ sku_code: "dgs10ko-s4", price: 10615, name: "Rp. 10.000" }),
      ],
      meta()
    );

    // Register mapping rules for all three so they resolve to one variant.
    const { PROVIDER_MAPPING } = await import("../../src/config/provider-mapping.js");
    PROVIDER_MAPPING.byProviderCode["dnt10ko-s4"] = { gameSlug: "mobile-legends", variantSlug: "d10000" };
    PROVIDER_MAPPING.byProviderCode["dzs10ko-s4"] = { gameSlug: "mobile-legends", variantSlug: "d10000" };
    PROVIDER_MAPPING.byProviderCode["dgs10ko-s4"] = { gameSlug: "mobile-legends", variantSlug: "d10000" };

    const report = await syncProviderCatalog({});

    // No P2002, the sync completes.
    expect(report.ok).toBe(true);

    // The existing link is refreshed, NOT duplicated.
    expect(report.linked).toBe(1);

    // The already-linked variant is not re-pointed at a cheaper family: that
    // would change what we buy, and is an operator decision.
    expect(report.created).toBe(0);
    expect(report.duplicateVariants).toBe(2);

    // Exactly one row per variant, still under the original code.
    const links = await prisma.providerProduct.findMany({
      where: { productVariantId: variant.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0].providerCode).toBe("dnt10ko-s4");
    expect(links[0].providerPrice).toBe(10640);
  });

  it("keeps the cheapest ACTIVE SKU when two NEW codes share a variant", async () => {
    // Neither code is linked yet: two fresh families compete for one variant.
    const game = await prisma.game.findFirstOrThrow({});
    const product = await prisma.product.create({
      data: { gameId: game.id, name: "Saldo OVO", slug: "ovo-saldo" },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "10.000 Saldo OVO",
        slug: "ovo10000",
        denomination: 10000,
        unit: "Rp",
        costPrice: 11000,
        sellingPrice: 12000,
      },
    });

    replyWith(
      [
        // The cheaper row is OUT OF STOCK; the active one must win.
        row({ sku_code: "ovo10ka-s4", price: 10500, name: "Rp. 10.000", status: "inactive" }),
        row({ sku_code: "ovs10ka-s4", price: 10900, name: "Rp. 10.000", status: "active" }),
      ],
      meta()
    );

    const { PROVIDER_MAPPING } = await import("../../src/config/provider-mapping.js");
    PROVIDER_MAPPING.byProviderCode["ovo10ka-s4"] = { gameSlug: "mobile-legends", variantSlug: "ovo10000" };
    PROVIDER_MAPPING.byProviderCode["ovs10ka-s4"] = { gameSlug: "mobile-legends", variantSlug: "ovo10000" };

    const report = await syncProviderCatalog({});

    expect(report.created).toBe(1);
    expect(report.duplicateVariants).toBe(1);

    const link = await prisma.providerProduct.findFirstOrThrow({
      where: { productVariantId: variant.id },
    });
    // The active SKU won even though it was the more expensive one.
    expect(link.providerCode).toBe("ovs10ka-s4");
    expect(link.isAvailable).toBe(true);
  });
});
