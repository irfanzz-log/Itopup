import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script. Normalises `sortOrder` to 0 for every variant under a
// NOMINAL product, so the grid orders purely by denomination.
//
// WHY THIS IS NEEDED
//
//   The catalog orders variants by [sortOrder ASC, denomination ASC]. For a
//   NOMINAL product, denomination IS the sort key and sortOrder is meant to be
//   a flat 0. But the ML diamonds ladder was seeded twice: the original 22
//   rungs carry sortOrder 0..21 and the 29 rungs added later all carry 0. The
//   29 new rungs therefore render FIRST (5..4830 before 12..9288), which is the
//   bug: a customer sees 4.830 Diamonds above 12 Diamonds.
//
//   Manual products (weekly-pass, twilight-pass, welkin-moon) keep their
//   sortOrder untouched, because those have no denomination to fall back on.
//
// Idempotent. Writes to the database named in .env.dev.
//
//   npx vitest run --config vitest.sync.config.js scripts/fix-sort-order.ops.test.js

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/fix-sort-order.log";

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
}

function forceEnv() {
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

describe("sort order normalisation", () => {
  it("zeroes sortOrder on NOMINAL variants", async () => {
    fs.rmSync(REPORT, { force: true });
    forceEnv();

    const { prisma } = await import("../src/lib/db.js");

    const affected = await prisma.productVariant.findMany({
      where: { product: { sortMode: "NOMINAL" }, NOT: { sortOrder: 0 } },
      select: { id: true, slug: true, sortOrder: true, productId: true },
    });

    say(`variants with non-zero sortOrder under a NOMINAL product: ${affected.length}`);
    for (const v of affected.slice(0, 30)) say(`  ${v.slug} (was ${v.sortOrder})`);
    if (affected.length > 30) say(`  ... and ${affected.length - 30} more`);

    if (!affected.length) {
      say("Nothing to do. Already normalised.");
      return;
    }

    const result = await prisma.productVariant.updateMany({
      where: { id: { in: affected.map((v) => v.id) } },
      data: { sortOrder: 0 },
    });

    say(`updated: ${result.count}`);

    // Verify: the only remaining non-zero sortOrder rows must sit under MANUAL
    // products, and every NOMINAL product must now sort by denomination alone.
    const stillBad = await prisma.productVariant.count({
      where: { product: { sortMode: "NOMINAL" }, NOT: { sortOrder: 0 } },
    });
    say(`remaining NOMINAL variants with sortOrder != 0: ${stillBad}`);
    if (stillBad) throw new Error(`Masih ada ${stillBad} variant NOMINAL dengan sortOrder != 0`);

    // Spot check: ML diamonds must be ascending now.
    const spot = await prisma.productVariant.findMany({
      where: { product: { slug: "diamonds", game: { slug: "mobile-legends" } }, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { denomination: "asc" }],
      select: { denomination: true },
    });
    const nums = spot.map((v) => v.denomination);
    const sorted = [...nums].sort((a, b) => a - b);
    say("");
    say(`ML diamonds: ${nums.length} variants, ascending = ${JSON.stringify(nums) === JSON.stringify(sorted)}`);
    say(`first: ${nums.slice(0, 6).join(", ")}`);
    say(`last : ${nums.slice(-6).join(", ")}`);
    if (JSON.stringify(nums) !== JSON.stringify(sorted)) {
      throw new Error("ML diamonds masih tidak terurut naik");
    }
  });
});
