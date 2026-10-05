// ============================================================================
// Seed: catalogue, provider rows, an initial staff account, and sample promos.
//
// WHAT THIS SEED DOES NOT DO: it does not invent Melostore SKUs, prices, or
// credentials. The `costPrice` values in src/config/games.js are development
// placeholders and the provider mapping table (provider_products) is left EMPTY
// on purpose — the sync job (Phase 2) fills it from the provider's own product
// list, and until then checkout refuses with ITP_PRODUCT_UNAVAILABLE rather than
// dispatching to a guessed SKU.
//
// Safety rails:
//   * refuses to run when NODE_ENV=production unless SEED_ALLOW_PRODUCTION=1,
//   * refuses to run against a database that already has users (idempotent
//     re-runs would otherwise silently reprice live products),
//   * --dry-run prints exactly what it would write.
//
// Usage:
//   npm run db:seed
//   npm run db:seed -- --dry-run
//   npm run db:seed -- --force          # re-run over existing data (upserts)
//
// NOTE ON IMPORTS: this file runs under plain `node`, not through Next's
// bundler, so it must import the generated Prisma client with its explicit .ts
// extension and must NOT import src/lib/db.js (whose extensionless generated
// import only resolves inside the bundler).
// ============================================================================
import { randomBytes } from "node:crypto";
import "dotenv/config";

import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { CATEGORY_SEED } from "../src/config/categories.js";
import { GAME_SEED, PRODUCT_SEED, VARIANT_SEED } from "../src/config/games.js";
import { sellingPriceFromCost } from "../src/config/pricing.js";
import { PAYMENT_METHODS } from "../src/config/payment.js";
import { ROLES } from "../src/lib/constants.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");

const log = (...parts) => console.log("[seed]", ...parts);

// ── Guard rails ─────────────────────────────────────────────────────────────

function assertEnvironment() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    throw new Error(
      "Seed ditolak: NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=1 jika ini memang disengaja."
    );
  }
  const url = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DIRECT_URL / DATABASE_URL belum diisi. Salin .env.example ke .env lalu isi.");
  }
  return url;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic slug for a variant, so a re-run updates instead of duplicating. */
function variantSlug(entry, index) {
  if (entry.slug) return entry.slug;
  if (entry.denomination != null) return `d${entry.denomination}`;
  return `item-${index + 1}`;
}

/** Display name for a variant card. */
function variantName(entry, unit) {
  if (entry.name) return entry.name;
  if (entry.denomination != null) return `${entry.denomination.toLocaleString("id-ID")} ${unit ?? ""}`.trim();
  return `Item ${entry.denomination}`;
}

/**
 * A generated staff password, printed once and never stored in plaintext.
 * The account is created with `mustChangePassword` semantics: the operator is
 * told to change it immediately after first login.
 */
function generatePassword() {
  return randomBytes(9).toString("base64url");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const connectionString = assertEnvironment();

  const adapter = new PrismaPg({ connectionString, max: 2 });
  const prisma = new PrismaClient({ adapter, log: ["warn", "error"] });

  try {
    // ── Preflight ──────────────────────────────────────────────────────────
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0 && !FORCE && !DRY_RUN) {
      throw new Error(
        `Database sudah berisi ${existingUsers} user. Jalankan dengan --force untuk melanjutkan ` +
          "(upsert, tidak menghapus data transaksi)."
      );
    }

    log(`mode: ${DRY_RUN ? "DRY RUN" : FORCE ? "FORCE (upsert)" : "initial"}`);

    // ── 1. Categories ──────────────────────────────────────────────────────
    const categoryIdByKind = {};

    for (const entry of CATEGORY_SEED) {
      if (DRY_RUN) {
        log(`category: ${entry.kind} (${entry.name})`);
        categoryIdByKind[entry.kind] = `dry-${entry.kind}`;
        continue;
      }
      const row = await prisma.category.upsert({
        where: { kind: entry.kind },
        update: {
          name: entry.name,
          slug: entry.slug,
          description: entry.description,
          icon: entry.icon,
          sortOrder: entry.sortOrder,
          isActive: true,
        },
        create: {
          kind: entry.kind,
          name: entry.name,
          slug: entry.slug,
          description: entry.description,
          icon: entry.icon,
          sortOrder: entry.sortOrder,
        },
        select: { id: true },
      });
      categoryIdByKind[entry.kind] = row.id;
    }
    log(`categories: ${Object.keys(categoryIdByKind).length}`);

    // ── 2. Games / services ────────────────────────────────────────────────
    // Which category each seeded game belongs to. Derived from the seed itself
    // rather than a hand-kept list: a list written here silently drifts from
    // GAME_SEED — that is how `efootball` ended up listed in the catalogue but
    // skipped by the seed, leaving the game page showing nothing to buy. The
    // pulsa game is the one entry that is not a GAME, so it is named explicitly.
    const gameCategoryBySlug = Object.fromEntries(
      GAME_SEED.map((game) => [game.slug, game.slug === "pulsa" ? "PULSA" : "GAME"])
    );

    // A game in the seed with no category is a misconfiguration, not a skip.
    // Failing here is what keeps the catalogue and the seeded products honest.
    for (const game of GAME_SEED) {
      if (!gameCategoryBySlug[game.slug]) {
        throw new Error(`Game seed "${game.slug}" tidak memiliki kategori.`);
      }
    }

    const gameIdBySlug = {};

    for (const game of GAME_SEED) {
      const kind = gameCategoryBySlug[game.slug];
      if (!kind) {
        log(`skip game tanpa kategori: ${game.slug}`);
        continue;
      }
      const categoryId = categoryIdByKind[kind];

      if (DRY_RUN) {
        log(`game: ${game.slug} → ${kind}`);
        gameIdBySlug[game.slug] = `dry-${game.slug}`;
        continue;
      }

      const row = await prisma.game.upsert({
        where: { slug: game.slug },
        update: {
          categoryId,
          name: game.name,
          publisher: game.publisher,
          description: game.description,
          inputFields: game.inputFields,
          supportsValidation: game.supportsValidation,
          needsGameLogin: Boolean(game.needsGameLogin),
          isPopular: game.popular,
          sortOrder: game.sortOrder,
          isActive: true,
        },
        create: {
          categoryId,
          name: game.name,
          slug: game.slug,
          publisher: game.publisher,
          description: game.description,
          inputFields: game.inputFields,
          supportsValidation: game.supportsValidation,
          needsGameLogin: Boolean(game.needsGameLogin),
          isPopular: game.popular,
          sortOrder: game.sortOrder,
        },
        select: { id: true },
      });
      gameIdBySlug[game.slug] = row.id;
    }
    log(`games: ${Object.keys(gameIdBySlug).length}`);

    // ── 3. Products + variants ─────────────────────────────────────────────
    let productCount = 0;
    let variantCount = 0;

    for (const [gameSlug, products] of Object.entries(PRODUCT_SEED)) {
      const gameId = gameIdBySlug[gameSlug];
      if (!gameId) {
        log(`skip produk untuk game tak dikenal: ${gameSlug}`);
        continue;
      }

      for (const product of products) {
        productCount += 1;

        if (DRY_RUN) {
          const variants = VARIANT_SEED[gameSlug]?.[product.slug] ?? [];
          log(`product: ${gameSlug}/${product.slug} (${variants.length} nominal)`);
          variantCount += variants.length;
          continue;
        }

        const productRow = await prisma.product.upsert({
          where: { gameId_slug: { gameId, slug: product.slug } },
          update: {
            name: product.name,
            sortMode: product.sortMode,
            sortOrder: product.sortOrder,
            isActive: true,
          },
          create: {
            gameId,
            name: product.name,
            slug: product.slug,
            sortMode: product.sortMode,
            sortOrder: product.sortOrder,
          },
          select: { id: true },
        });

        const variants = VARIANT_SEED[gameSlug]?.[product.slug] ?? [];

        for (const [index, entry] of variants.entries()) {
          const slug = variantSlug(entry, index);
          const costPrice = Number(entry.costPrice);
          if (!Number.isFinite(costPrice) || costPrice <= 0) {
            throw new Error(`costPrice tidak valid untuk ${gameSlug}/${product.slug}/${slug}`);
          }

          // The selling price is DERIVED, never typed twice. Changing the markup
          // in src/config/pricing.js and re-running the seed reprices everything
          // consistently. Airtime (PULSA) uses a fixed spread instead of a
          // percentage, so the category kind is passed through.
          const kind = gameCategoryBySlug[gameSlug];
          const sellingPrice =
            entry.sellingPrice ?? sellingPriceFromCost(costPrice, { kind });

          // A variant may be defined but NOT sellable — e.g. eFootball, whose
          // provider flow demands the customer's game password. The catalogue
          // still lists it so the game page is honest about what exists, while
          // checkout refuses it. Defaults to active.
          const isActive = entry.isActive !== false;

          await prisma.productVariant.upsert({
            where: { productId_slug: { productId: productRow.id, slug } },
            update: {
              name: variantName(entry, product.name),
              denomination: entry.denomination ?? null,
              unit: product.name,
              costPrice,
              sellingPrice,
              sortOrder: entry.sortOrder ?? index,
              isActive,
            },
            create: {
              productId: productRow.id,
              name: variantName(entry, product.name),
              slug,
              denomination: entry.denomination ?? null,
              unit: product.name,
              costPrice,
              sellingPrice,
              sortOrder: entry.sortOrder ?? index,
            },
          });
          variantCount += 1;
        }
      }
    }
    log(`products: ${productCount}, variants: ${variantCount}`);

    // ── 4. Provider rows ───────────────────────────────────────────────────
    // Credentials are NOT stored here — only non-secret routing data. The
    // adapter reads MELOSTORE_* from the environment at call time.
    if (!DRY_RUN) {
      await prisma.provider.upsert({
        where: { code: "melostore" },
        update: { name: "Melostore H2H", kind: "TOPUP" },
        create: {
          code: "melostore",
          kind: "TOPUP",
          name: "Melostore H2H",
          // Left DISABLED until the adapter has verified credentials and a
          // completed end-to-end test order. Enabling it early would let a
          // customer reach a half-implemented integration.
          status: "DISABLED",
          baseUrl: process.env.MELOSTORE_BASE_URL || null,
          priority: 10,
        },
      });
      log("provider: melostore (status DISABLED sampai integrasi terverifikasi)");
    }

    // ── 5. Payment method catalogue ────────────────────────────────────────
    // Stored as an AppSetting so the admin settings page can show which methods
    // are configured without importing the config file into the client.
    if (!DRY_RUN) {
      await prisma.appSetting.upsert({
        where: { key: "payment.methods" },
        update: { value: PAYMENT_METHODS },
        create: { key: "payment.methods", value: PAYMENT_METHODS },
      });
      await prisma.appSetting.upsert({
        where: { key: "catalog.sync" },
        update: {},
        create: {
          key: "catalog.sync",
          value: { lastSyncAt: null, lastSyncStatus: "NEVER", note: "Menunggu integrasi Melostore" },
        },
      });
    }

    // ── 6. Staff account ───────────────────────────────────────────────────
    // Created ONLY when there is no staff account at all, so re-running the seed
    // can never reset a real operator's password.
    const staffEmail = process.env.SEED_ADMIN_EMAIL || "admin@itopup.local";
    const existingStaff = DRY_RUN
      ? 0
      : await prisma.user.count({ where: { role: { in: [ROLES.DEV, ROLES.SUPERADMIN] } } });

    if (existingStaff === 0 && !DRY_RUN) {
      const password = process.env.SEED_ADMIN_PASSWORD || generatePassword();
      const email = staffEmail.trim().toLowerCase();

      await prisma.user.create({
        data: {
          name: "ITOPUP Admin",
          email,
          passwordHash: await bcrypt.hash(password, 12),
          role: ROLES.SUPERADMIN,
          status: "ACTIVE",
        },
      });

      // Printed once, never stored. If this is lost, reset it from the database
      // (or set SEED_ADMIN_PASSWORD before the first seed).
      log("─".repeat(64));
      log(`akun staff dibuat: ${email}`);
      log(`password (hanya ditampilkan sekali): ${password}`);
      log("GANTI password ini segera setelah login pertama.");
      log("─".repeat(64));
    } else if (existingStaff > 0) {
      log("staff account: sudah ada, dilewati");
    }

    // ── 7. Sample promo ────────────────────────────────────────────────────
    if (!DRY_RUN && FORCE) {
      const startsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const promo = await prisma.promo.upsert({
        where: { slug: "diskon-awal-itopup" },
        update: {},
        create: {
          title: "Diskon 10% Transaksi Pertama",
          slug: "diskon-awal-itopup",
          description:
            "Potongan 10% untuk transaksi pertamamu di ITOPUP, maksimal Rp 10.000. Berlaku untuk semua produk game.",
          discountType: "PERCENT",
          discountValue: 10,
          maxDiscount: 10_000,
          minSpend: 20_000,
          startsAt,
          endsAt,
          isActive: true,
        },
        select: { id: true },
      });

      await prisma.promoCode.upsert({
        where: { code: "ITOPUP10" },
        update: {},
        create: { promoId: promo.id, code: "ITOPUP10", usageLimit: 500, isActive: true },
      });
      log("promo: ITOPUP10 (hanya dengan --force, untuk lingkungan non-produksi)");
    }

    log("selesai.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed] GAGAL:", err?.message || err);
  process.exitCode = 1;
});
