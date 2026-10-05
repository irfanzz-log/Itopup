// ============================================================================
// seed-game-products.ops.test.js — fill the imported games with real products.
//
// The Melostore game sync created 46 Game rows with NOTHING under them: no
// products, no nominals, no provider links. This script fills the ones that
// have a clean denomination ladder from the pricelist, so /topup shows real
// buyable nominals instead of an empty grid.
//
// WHAT IT WRITES, per game:
//   * Game.inputFields — derived from the brand's inquiry form shape (a
//     "target" field becomes playerId/userId, "target+zone" adds a server).
//     Games whose form asks for a PASSWORD are skipped, exactly as the hand-
//     written seed does for eFootball: this platform does not collect game
//     credentials.
//   * One Product per game, carrying the currency name (Diamonds, CP, …).
//   * One ProductVariant per nominal, with costPrice straight from the
//     provider SKU and sellingPrice derived by the pricing rule in ONE place
//     (sellingPriceFromCost) — never typed by hand.
//   * The ProviderProduct link, so checkout can actually dispatch the order.
//
// Read-only against the provider: the pricelist was already cached to
// /tmp/pricelist-full.json by melo-full.ops.test.js.
//
// Run:  set -a && . ./.env.dev && set +a && npx vitest run scripts/seed-game-products.ops.test.js --config vitest.sync.config.js
// ============================================================================
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "../src/lib/db.js";
import { sellingPriceFromCost } from "../src/config/pricing.js";
import { CATEGORY_KIND } from "../src/lib/constants.js";
import { field } from "../src/config/input-fields.js";

/** Inquiry-form shape → the checkout fields we collect for it. */
function fieldsForForm(form, forms) {
  const def = form ? forms[form] : null;
  const keys = def ? (def.fields ?? []).map((f) => f.key) : [];
  const isPassword = def
    ? (def.fields ?? []).some((f) => /password/i.test(f.name || "") || /password/i.test(f.key || ""))
    : false;

  if (isPassword) return { password: true, fields: [] };

  // target_id/target_zone is the ML-style pair: a numeric user id + a zone.
  if (keys.includes("target_id")) {
    return {
      password: false,
      fields: [field("userId"), ...(keys.includes("target_zone") ? [field("zoneId")] : [])],
    };
  }
  // A plain target is either a player id or a user id — the form's own label
  // distinguishes them ("Player ID" vs "User ID").
  const label = def?.fields?.[0]?.name ?? "";
  const isPlayer = /player|riot|character|role|uid/i.test(label);
  return {
    password: false,
    fields: [
      isPlayer
        ? field("playerId", { label: label || "Player ID" })
        : field("userId", { label: label || "User ID" }),
      ...(keys.includes("zone") ? [field("serverId", { label: "Server" })] : []),
    ],
  };
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A variant slug that matches the seed convention (d<denomination>). */
function variantSlug(denom) {
  const n = Number(denom);
  if (!Number.isInteger(n)) return `d${String(n).replace(".", "")}`;
  return `d${n}`;
}

describe("game product seed", () => {
  it("creates products, nominals and provider links", async () => {
    const data = JSON.parse(readFileSync("/tmp/game-products.json", "utf8"));
    const forms = JSON.parse(readFileSync("/tmp/inquiry-forms.json", "utf8"));

    const gameCategory = await prisma.category.findFirst({
      where: { kind: CATEGORY_KIND.GAME },
      select: { id: true },
    });
    expect(gameCategory, "Kategori GAME belum ada.").not.toBeNull();

    const provider = await prisma.provider.findFirst({
      where: { code: "melostore" },
      select: { id: true },
    });
    expect(provider, "Provider melostore belum ada. Jalankan sync katalog dulu.").not.toBeNull();

    const report = { seeded: [], skipped: [], games: 0, variants: 0, links: 0 };

    for (const g of data) {
      const resolved = fieldsForForm(g.form, forms);

      // A game that wants a game-account password is NOT seeded as sellable.
      // We keep the catalogue row (the admin can wire a password-free provider
      // later) but we do not build a purchasable product for it.
      if (resolved.password) {
        report.skipped.push({ family: g.family, reason: "inquiry form meminta password" });
        continue;
      }

      // Find the Game row: the earlier import created rows keyed on the
      // documented game code, so match by slug, else by name.
      let game = await prisma.game.findFirst({
        where: { slug: slugify(g.family) },
        select: { id: true, slug: true },
      });
      if (!game) {
        game = await prisma.game.create({
          data: {
            categoryId: gameCategory.id,
            name: g.brandName,
            slug: slugify(g.family),
            description: `Top up ${g.brandName} cepat dan aman. Proses otomatis 24 jam.`,
            inputFields: resolved.fields,
            supportsValidation: false,
            isActive: false,
            sortOrder: 200 + report.games,
          },
          select: { id: true, slug: true },
        });
      } else {
        // The DB is the source of truth for what the form collects; only write
        // inputFields for games that do not already have them, so an existing
        // hand-tuned contract (free-fire → playerId) is never clobbered.
        const existingFields = await prisma.game.findUnique({
          where: { id: game.id },
          select: { inputFields: true },
        });
        const hasFields =
          Array.isArray(existingFields?.inputFields) && existingFields.inputFields.length > 0;
        if (!hasFields) {
          await prisma.game.update({
            where: { id: game.id },
            data: { inputFields: resolved.fields },
          });
        }
      }
      report.games++;

      const product = await prisma.product.upsert({
        where: { gameId_slug: { gameId: game.id, slug: slugify(g.unit) || "topup" } },
        create: {
          gameId: game.id,
          name: g.unit,
          slug: slugify(g.unit) || "topup",
          sortMode: "NOMINAL",
          sortOrder: 1,
        },
        update: {},
        select: { id: true },
      });

      for (const rung of g.ladder) {
        const cost = Math.max(1, Math.round(Number(rung.price) || 0));
        const variant = await prisma.productVariant.upsert({
          where: { productId_slug: { productId: product.id, slug: variantSlug(rung.denom) } },
          create: {
            productId: product.id,
            name: rung.name,
            slug: variantSlug(rung.denom),
            denomination: Math.round(Number(rung.denom)) || null,
            unit: g.unit,
            costPrice: cost,
            sellingPrice: sellingPriceFromCost(cost),
            isActive: true,
            sortOrder: Math.round(Number(rung.denom)) || 0,
          },
          update: {},
          select: { id: true },
        });
        report.variants++;

        // The link is what makes this nominal actually purchasable. Without it
        // checkout refuses with ITP_PRODUCT_UNAVAILABLE rather than dispatching
        // to a guessed SKU — the same guard the hand-written seed relies on.
        await prisma.providerProduct.upsert({
          where: {
            providerId_providerCode: { providerId: provider.id, providerCode: rung.sku },
          },
          create: {
            providerId: provider.id,
            productVariantId: variant.id,
            providerCode: rung.sku,
            providerName: rung.name,
            providerPrice: cost,
            isAvailable: true,
            lastSyncAt: new Date(),
          },
          update: {
            providerName: rung.name,
            providerPrice: cost,
            isAvailable: true,
            lastSyncAt: new Date(),
          },
        });
        report.links++;
      }

      report.seeded.push({ family: g.family, rungs: g.ladder.length });
    }

    writeFileSync("/tmp/seed-game-products.json", JSON.stringify(report, null, 2));
  });
});
