// Operator script: run the REAL provider sync against dev OR prod.
//
// scripts/sync-live.ops.test.js is hardcoded to .env.dev. This wrapper is the
// same sync with a TARGET switch, because the Indonesia catalogue was seeded to
// both databases and both need their provider links built from the rules in
// src/config/provider-mapping.js.
//
//   TARGET=dev  (default)
//   TARGET=prod
//
//   npx vitest run --config vitest.sync.config.js scripts/sync-target.ops.test.js
//
import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "..");
const REPORT = process.env.SYNC_LOG || "/tmp/sync-target.log";
const TARGET = String(process.env.TARGET || "dev").toLowerCase();
const ENV_FILE = TARGET === "prod" ? ".env.prod" : ".env.dev";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

function forceEnv() {
  // Prisma resolves its datasource inside the generated client, so the env must
  // be in place before the client is imported. override:false in src/lib/env.js
  // would let .env.test win under VITEST; set the values explicitly here.
  const raw = fs.readFileSync(path.join(ROOT, ENV_FILE), "utf8");
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

describe(`live sync (${TARGET})`, () => {
  it("runs syncProviderCatalog against the target database", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    say(`target: ${TARGET} (${ENV_FILE})`);
    say(`host  : ${safeHost(process.env.DATABASE_URL)}`);
    say("");

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
    say(`unmatched        : ${report.unmatched}`);
    say(`durationMs       : ${report.durationMs} (wall ${wallMs})`);

    if (!report.ok) throw new Error(`sync failed: ${JSON.stringify(report)}`);

    // ── Verify the catalogue the sync left behind ───────────────────────────
    const { prisma } = await import("../src/lib/db.js");
    const linked = await prisma.providerProduct.count();
    const totalVariants = await prisma.productVariant.count();
    say("");
    say(`=== AFTER SYNC: ${linked} provider links, ${totalVariants} variants ===`);

    // Pulsa must stay at a flat spread, never a percentage.
    const pulsa = await prisma.productVariant.findMany({
      where: { product: { game: { slug: "pulsa" } } },
      select: { slug: true, costPrice: true, sellingPrice: true, product: { select: { slug: true } } },
      orderBy: [{ product: { slug: "asc" } }, { denomination: "asc" }],
    });
    say("");
    say("=== PULSA MARGIN (harus Rp 1.000 exact) ===");
    let wrong = 0;
    for (const v of pulsa) {
      const margin = v.sellingPrice - v.costPrice;
      if (margin !== 1000) wrong++;
      say(`${v.product.slug} ${v.slug}: cost ${v.costPrice} -> jual ${v.sellingPrice} (margin ${margin})`);
    }
    say(`pulsa margin salah: ${wrong} dari ${pulsa.length}`);

    // Game margins must never go negative.
    const games = await prisma.productVariant.findMany({
      where: { product: { game: { slug: { not: "pulsa" } } } },
      select: { costPrice: true, sellingPrice: true },
    });
    const below = games.filter((v) => v.sellingPrice < v.costPrice * 1.04).length;
    say("");
    say(`=== GAME MARGIN: ${games.length} variants, ${below} di bawah 4% (pinned diabaikan) ===`);
    if (below > 0) throw new Error(`${below} game variants priced below 4% margin`);
  });
});

function safeHost(url) {
  try {
    return new URL(String(url)).host;
  } catch {
    return "<unreadable>";
  }
}
