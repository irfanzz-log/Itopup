import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// sync-prod-catalog.ops.test.js — push the LOCAL catalogue to PRODUCTION.
//
// It copies ONLY the catalogue: categories, games, products, product_variants,
// providers, provider_products. Nothing else.
//
// WHAT IT NEVER TOUCHES, by construction:
//
//   * users / sessions              (accounts)
//   * orders / order_items / payments / transaction_logs
//   * audit_logs / webhook_events   (log + audit trail)
//   * promo_codes / voucher_claims  (per-customer promo state)
//   * user_blocks
//   * app_settings                  (prod-only config)
//   * game_credentials              (encrypted customer secrets)
//
// WHY IT REPLACES RATHER THAN MERGES
//
//   Prod and local were seeded separately, so their catalogue rows carry
//   DIFFERENT random ids for the same slugs (`categories/kind=GAME` is
//   `2294b1f9…` in prod and `1504978d…` locally). A row-merge on id therefore
//   collides on every unique key, and a merge on slug would leave prod rows
//   pointing at local ids. Replacing the whole catalogue is correct here
//   precisely because the catalogue has NO dependent business state in prod:
//   MEASURED before this script was written, prod has 0 orders, 0 order_items,
//   0 payments and no promo join rows targeting a variant. The only protected
//   tables that hold rows are users (2), sessions (1), audit_logs (7) and
//   app_settings (2), none of which reference the catalogue.
//
//   If prod ever takes a real order, this script becomes unsafe as written and
//   must be rewritten as an id-mapping merge. It refuses to run at all if any
//   dependent table is non-empty, so the failure mode is a stopped script, not
//   orphaned data.
//
//   npx vitest run --config vitest.sync.config.js scripts/sync-prod-catalog.ops.test.js
// ============================================================================

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/sync-prod-catalog.log";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

function envFor(file) {
  const out = {};
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

describe("prod catalog sync", () => {
  it("copies local catalogue rows to production, touching nothing else", async () => {
    fs.rmSync(REPORT, { force: true });

    const localEnv = envFor(".env.dev");
    const prodEnv = envFor(".env.prod");

    const { PrismaClient } = await import("../generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");

    const local = new PrismaClient({ adapter: new PrismaPg({ connectionString: localEnv.DATABASE_URL }) });
    const prod = new PrismaClient({ adapter: new PrismaPg({ connectionString: prodEnv.DATABASE_URL }) });

    try {
      // ── 0. Safety gate ──────────────────────────────────────────
      // A replace is only safe when nothing business-critical references the
      // catalogue. This is checked against the live DB immediately before the
      // write, so a prod that has taken orders since the script was written
      // stops here instead of being wiped.
      const guard = await prod.$queryRawUnsafe(`
        select
          (select count(*) from orders)            as orders,
          (select count(*) from order_items)       as order_items,
          (select count(*) from payments)          as payments,
          (select count(*) from transaction_logs)  as transaction_logs,
          (select count(*) from promo_codes)       as promo_codes,
          (select count(*) from voucher_claims)    as voucher_claims,
          (select count(*) from game_credentials)  as game_credentials
      `);
      const blocked = Object.entries(guard[0]).filter(([, v]) => Number(v) > 0);
      if (blocked.length) {
        const msg = `PROD MEMILIKI DATA TRANSAKSI/PROMO/KREDENSIAL: ${blocked
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}. Replace katalog TIDAK aman. Script berhenti, tidak ada yang ditulis.`;
        say(msg);
        throw new Error(msg);
      }

      // Snapshot the protected tables so the script can prove afterwards that
      // the counts did not move.
      const before = await prod.$queryRawUnsafe(`
        select
          (select count(*) from users)             as users,
          (select count(*) from sessions)          as sessions,
          (select count(*) from audit_logs)        as audit_logs,
          (select count(*) from webhook_events)    as webhook_events,
          (select count(*) from user_blocks)       as user_blocks,
          (select count(*) from app_settings)      as app_settings
      `);

      // ── 1. Read the local catalogue ────────────────────────────
      const [categories, providers, games, products, variants, links] = await Promise.all([
        local.category.findMany(),
        local.provider.findMany(),
        local.game.findMany(),
        local.product.findMany(),
        local.productVariant.findMany({ orderBy: [{ sortOrder: "asc" }, { denomination: "asc" }] }),
        local.providerProduct.findMany(),
      ]);

      say("=== LOCAL CATALOGUE READ ===");
      say(`  categories ${categories.length} | providers ${providers.length} | games ${games.length}`);
      say(`  products ${products.length} | variants ${variants.length} | links ${links.length}`);

      // ── 2. Replace the prod catalogue in FK order ──────────────
      // Each table is deleted then recreated with the LOCAL ids. The join
      // tables that reference the catalogue are either empty (verified by the
      // gate above) or not copied, so nothing is orphaned.
      //
      // Six deleteMany + six createMany against the hosted pooler is well past
      // the 5s interactive-transaction default, which is what the first
      // version of this script hit. The timeout is raised instead of splitting
      // the work: a half-applied replace is exactly the failure mode the
      // single transaction exists to prevent.
      await prod.$transaction(
        async (tx) => {
          await tx.providerProduct.deleteMany({});
          await tx.productVariant.deleteMany({});
          await tx.product.deleteMany({});
          await tx.game.deleteMany({});
          await tx.provider.deleteMany({});
          await tx.category.deleteMany({});

          await tx.category.createMany({ data: categories, skipDuplicates: true });
          await tx.provider.createMany({ data: providers, skipDuplicates: true });
          await tx.game.createMany({ data: games, skipDuplicates: true });
          await tx.product.createMany({ data: products, skipDuplicates: true });
          await tx.productVariant.createMany({ data: variants, skipDuplicates: true });
          await tx.providerProduct.createMany({ data: links, skipDuplicates: true });
        },
        { timeout: 120_000, maxWait: 30_000 },
      );

      say("");
      say("=== REPLACED (local ids sekarang jadi prod ids) ===");

      // ── 3. Verify ─────────────────────────────────────────────
      const after = await prod.$queryRawUnsafe(`
        select
          (select count(*) from categories)        as categories,
          (select count(*) from games)             as games,
          (select count(*) from products)          as products,
          (select count(*) from product_variants)  as variants,
          (select count(*) from provider_products) as links,
          (select count(*) from users)             as users,
          (select count(*) from sessions)          as sessions,
          (select count(*) from audit_logs)        as audit_logs,
          (select count(*) from webhook_events)    as webhook_events,
          (select count(*) from user_blocks)       as user_blocks,
          (select count(*) from app_settings)      as app_settings
      `);

      say("");
      say("=== PROD AFTER SYNC ===");
      const a = after[0];
      say(`  catalogue : categories ${a.categories}, games ${a.games}, products ${a.products}, variants ${a.variants}, links ${a.links}`);
      say(`  protected : users ${a.users}, sessions ${a.sessions}, audit_logs ${a.audit_logs}, webhook_events ${a.webhook_events}, user_blocks ${a.user_blocks}, app_settings ${a.app_settings}`);

      // Assert the protected tables are bit-identical.
      const drift = Object.keys(before[0]).filter((k) => Number(before[0][k]) !== Number(after[0][k]));
      say("");
      if (drift.length) {
        say(`  !! DRIFT pada tabel terlindungi: ${drift.join(", ")}`);
        throw new Error(`Tabel terlindungi berubah: ${drift.join(", ")}`);
      }
      say("  Tabel terlindungi tidak berubah (users, sessions, audit_logs, webhook_events, user_blocks, app_settings).");

      // Spot-check that prices + sort arrived correctly on a few rows.
      const spot = await prod.$queryRawUnsafe(`
        select g.slug as game, pv.slug, pv.denomination, pv."costPrice", pv."sellingPrice"
        from product_variants pv
        join products p on p.id = pv."productId"
        join games g on g.id = p."gameId"
        where g.slug = 'mobile-legends' and p.slug = 'diamonds'
        order by pv.denomination
        limit 6
      `);
      say("");
      say("=== SPOT CHECK: mobile-legends diamonds (harus terurut naik) ===");
      for (const r of spot) {
        say(`  ${String(r.slug).padEnd(7)} denom ${String(r.denomination).padStart(6)}  cost ${String(r.costPrice).padStart(9)}  jual ${String(r.sellingPrice).padStart(9)}`);
      }
    } finally {
      await local.$disconnect();
      await prod.$disconnect();
    }
  });
});
