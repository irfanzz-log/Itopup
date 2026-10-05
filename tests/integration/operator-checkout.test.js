// Proves the operator guard runs inside the real order-creation path, not just
// the prefix helper. Creates its own fixtures in the test database and removes
// them again, so it leaves nothing behind.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { prisma } from "../../src/lib/db.js";
import { createOrder } from "../../src/services/order.service.js";
import { ORDER_STATUS } from "../../src/lib/constants.js";
import { FIELD_PRESETS } from "../../src/config/input-fields.js";

afterAll(async () => {
  await prisma.$disconnect();
});

const GAME_SLUG = "pulsa-operator-test";
// The guard reads `variant.product.slug` AS the operator slug, so this must be a
// real operator name for the check to apply, an arbitrary slug is treated as an
// unknown operator and skipped by design.
const PRODUCT_SLUG = "indosat";
const PAYMENT_METHOD = "qris";

let user = null;
let variant = null;

describe("operator mismatch at order creation", () => {
  beforeEach(async () => {
    // The integration suite runs against a test database that starts empty, so
    // the fixtures are created here rather than looked up.
    await prisma.order.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.productVariant.deleteMany({ where: { product: { slug: PRODUCT_SLUG } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { slug: PRODUCT_SLUG } }).catch(() => {});
    await prisma.game.deleteMany({ where: { slug: GAME_SLUG } }).catch(() => {});

    user = await prisma.user.create({
      data: {
        email: `op-${Date.now()}@itopup.test`,
        name: "Operator Test User",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
      },
    });

    const game = await prisma.game.create({
      data: {
        slug: GAME_SLUG,
        name: "Operator Test Pulsa",
        // The game must declare the phone-number field, or createOrder never
        // looks at a number at all.
        inputFields: [structuredClone(FIELD_PRESETS.phoneNumber)],
        supportsValidation: false,
        isActive: true,
        sortOrder: 999,
        category: {
          connectOrCreate: {
            where: { slug: "pulsa" },
            create: { slug: "pulsa", name: "Pulsa", kind: "PULSA", isActive: true },
          },
        },
      },
    });

    const product = await prisma.product.create({
      data: {
        // The product slug IS the operator, that is what the guard reads.
        slug: PRODUCT_SLUG,
        name: "Indosat (test)",
        game: { connect: { id: game.id } },
        isActive: true,
        sortOrder: 1,
        sortMode: "NOMINAL",
      },
    });

    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "Pulsa Indosat 10.000",
        slug: "indosat-10000",
        denomination: 10000,
        unit: "IDR",
        costPrice: 10000,
        sellingPrice: 11000,
        isActive: true,
        sortOrder: 1,
      },
    });

    // createOrder refuses a variant with no provider mapping
    // ("Produk belum terhubung ke provider"), so the fixture has to carry one.
    const provider = await prisma.provider.upsert({
      where: { code: "melostore" },
      update: {},
      create: { code: "melostore", name: "Melostore", status: "ACTIVE", priority: 1 },
    });
    await prisma.providerProduct.create({
      data: {
        productVariantId: variant.id,
        providerId: provider.id,
        providerCode: "TEST-INDOSAT-10000",
        providerName: "Pulsa Indosat 10.000",
        providerPrice: 10000,
        providerStock: 999,
        isAvailable: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.productVariant.deleteMany({ where: { product: { slug: PRODUCT_SLUG } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { slug: PRODUCT_SLUG } }).catch(() => {});
    await prisma.game.deleteMany({ where: { slug: GAME_SLUG } }).catch(() => {});
    if (user) await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  /** Arguments in the shape `createOrder` actually takes. */
  function place({ phoneNumber, key }) {
    return createOrder({
      userId: user.id,
      input: {
        variantId: variant.id,
        fields: { phoneNumber },
        paymentMethod: PAYMENT_METHOD,
        idempotencyKey: `${key}-${Date.now()}`,
      },
      request: {},
    });
  }

  it("refuses a Telkomsel number on an Indosat product", async () => {
    // 0812 is Telkomsel. This is the exact case the guard exists for: the
    // customer picked the wrong operator product and must be stopped before any
    // payment exists for a top-up the provider cannot deliver.
    let thrown = null;
    try {
      await place({ phoneNumber: "081234567890", key: "ops-opmismatch" });
    } catch (err) {
      thrown = err;
    }

    expect(thrown, "the operator mismatch guard should have thrown").toBeTruthy();
    // The guard names the operator, so the message tells the customer which
    // product to pick instead of a bare "tidak valid".
    const message = String(thrown?.message ?? thrown);
    expect(message).toContain("Indosat");

    // And no order was created, this is the protection claim itself.
    const count = await prisma.order.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });

  it("accepts an Indosat number on an Indosat product", async () => {
    // 0857 is IM3/Indosat. The order is created, the guard passed. Payment
    // issuance is a separate step that intentionally does not roll the order
    // back, and this suite has no live Midtrans credentials, so the claim here
    // is that the ORDER exists and is awaiting payment, not that a charge went
    // through.
    const { order } = await place({ phoneNumber: "085776191048", key: "ops-opmatch" });

    expect(order).toBeTruthy();
    expect(order.status).toBe(ORDER_STATUS.PENDING_PAYMENT);
  });

  it("accepts a +62 number and stores it in the 08… form", async () => {
    // The customer typed the international form. The stored value must be the
    // canonical local form, that is the shape the provider expects and the
    // shape the prefix lookup keys on.
    const { order } = await place({ phoneNumber: "+6285776191048", key: "ops-opplus62" });

    const stored = await prisma.order.findUnique({
      where: { id: order.id },
      select: { customerInput: true },
    });
    expect(stored.customerInput.phoneNumber).toBe("085776191048");
  });
});
