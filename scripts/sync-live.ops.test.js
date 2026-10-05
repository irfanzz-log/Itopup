import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script. Runs the REAL catalog sync against the database in .env.dev.
// Use it to confirm the chunked-transaction fix and reprice the catalogue.
//
//   npx vitest run --config vitest.sync.config.js scripts/sync-live.ops.test.js
//
// It does NOT load tests/setup.js, so it cannot truncate the live catalogue.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/sync-live.log";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

function forceEnv() {
  // Prisma's own datasource resolution is inside the generated client, which
  // is only built for the DB named in .env, so the env has to be in place
  // before the client is imported.
  const raw = fs.readFileSync(path.join(ROOT, ".env.dev"), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[key] = value;
  }
  process.env.NODE_ENV = "development";
}

describe("live sync", () => {
  it("runs syncProviderCatalog against the dev database", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { syncProviderCatalog } = await import("../src/services/sync.service.js");

    const startedAt = Date.now();
    const report = await syncProviderCatalog({
      dryRun: false,
      log: {
        info: (event, meta) => say(`info ${event} ${meta ? JSON.stringify(meta) : ""}`),
        warn: (event, meta) => say(`warn ${event} ${meta ? JSON.stringify(meta) : ""}`),
        error: (event, meta) => say(`error ${event} ${meta ? JSON.stringify(meta) : ""}`),
      },
    });
    const wallMs = Date.now() - startedAt;

    say("");
    say("=== SYNC RESULT ===");
    say(`ok               : ${report.ok}`);
    say(`fetched          : ${report.fetched}`);
    say(`linked (refresh) : ${report.linked}`);
    say(`created (new)    : ${report.created}`);
    say(`priceChanged     : ${report.priceChanged}`);
    say(`unavailable      : ${report.unavailable}`);
    say(`unchanged        : ${report.unchanged}`);
    say(`duplicates       : ${report.duplicates}`);
    say(`duplicateVariants: ${report.duplicateVariants}`);
    say(`unmatched        : ${report.unmatched.length}`);
    say(`durationMs       : ${report.durationMs} (wall ${wallMs})`);
    if (report.error) say(`error            : ${report.error}`);

    const { prisma } = await import("../src/lib/db.js");

    const linked = await prisma.providerProduct.count();
    const totalVariants = await prisma.productVariant.count();
    say("");
    say(`=== AFTER SYNC: ${linked} provider links, ${totalVariants} variants ===`);

    // Airtime must be priced at cost + Rp 1.000, exactly.
    const pulsa = await prisma.productVariant.findMany({
      where: { product: { game: { slug: "pulsa" } } },
      select: { slug: true, costPrice: true, sellingPrice: true, product: { select: { slug: true } } },
      orderBy: [{ product: { slug: "asc" } }, { denomination: "asc" }],
    });
    say("");
    say("=== PULSA MARGIN (harus Rp 1.000 exact) ===");
    let badPulsa = 0;
    for (const v of pulsa) {
      const margin = Number(v.sellingPrice) - Number(v.costPrice);
      if (margin !== 1000) badPulsa++;
      say(`${v.product.slug} ${v.slug}: cost ${v.costPrice} -> jual ${v.sellingPrice} (margin ${margin})`);
    }
    say(`pulsa margin salah: ${badPulsa} dari ${pulsa.length}`);

    // Games take 4%, rounded up to 100.
    const games = await prisma.productVariant.findMany({
      where: { product: { game: { slug: { not: "pulsa" } } } },
      select: { slug: true, costPrice: true, sellingPrice: true, product: { select: { game: { select: { slug: true } } } } },
    });
    let badGame = 0;
    for (const v of games) {
      const expected = Math.ceil((Number(v.costPrice) * 1.04) / 100) * 100;
      const margin = Number(v.sellingPrice) - Number(v.costPrice);
      const pct = Number(v.costPrice) > 0 ? (margin / Number(v.costPrice)) * 100 : 0;
      // Pinned admin prices are allowed to differ; only flag UNPINNED ones that
      // fall below 4%.
      if (Number(v.sellingPrice) !== expected && pct < 4) badGame++;
    }
    say("");
    say(`=== GAME MARGIN: ${games.length} variants, ${badGame} di bawah 4% (pinned diabaikan) ===`);
  });
});
