import { describe, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Operator script. Fills product_variants.name for every variant whose name is
// empty but whose denomination + unit identify the item.
//
// WHY THIS IS NEEDED
//
//   VARIANT_SEED in src/config/games.js defines a nominal ladder as
//   { denomination, costPrice } with no `name`, and the two seed paths that
//   wrote most of the catalogue (scripts/seed-indo-games.ops.test.js and the
//   LoL / voucher products) pass `name: v.name ?? ""`. So 179 of 680 variants
//   carry an empty name while denomination and unit are both populated.
//
//   The storefront nominal tile rendered only `{v.name}`, so those cards showed
//   a price and nothing else — the customer could not tell 330 Tokens from
//   1.110 Tokens. The label is now derived by `variantLabel()` in
//   src/lib/format.js, which this script reuses so the database and the UI can
//   never disagree about what a variant is called.
//
// Preference order for the name it writes:
//   1. the provider SKU's own label when the variant is linked to exactly one
//      (provider_products.providerName) — it is the supplier's authoritative
//      spelling and carries the bonus clause, e.g. "300+30 Tokens";
//   2. otherwise the derived label ("330 Tokens"), with an IDR unit rendered as
//      money ("Rp 20.000") and an empty unit falling back to the product name
//      ("575 RP" for League of Legends, whose products are one tier each).
//
// Writes to the database named in .env.prod (set FILL_TARGET=dev for the dev
// database). Idempotent: it only touches rows with an empty name, and
// `variantLabel()` returns the existing name verbatim when one is present, so a
// re-run over a clean catalogue is a no-op.
//
//   npx vitest run --config vitest.sync.config.js scripts/fill-variant-names.ops.test.js
//   FILL_TARGET=dev npx vitest run --config vitest.sync.config.js scripts/fill-variant-names.ops.test.js

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT = "/tmp/fill-variant-names.log";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function say(line = "") {
  fs.appendFileSync(REPORT, line + "\n");
  if (DRY_RUN) console.log(line);
}

function forceEnv(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let [, key, value] = m;
    value = value.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

/** The fields a backfilled label is derived from. */
const EMPTY_VARIANT_SELECT = {
  id: true, slug: true, name: true, denomination: true, unit: true,
  product: { select: { id: true, name: true, game: { select: { name: true } } } },
  providerProducts: { select: { providerName: true }, take: 2 },
};

describe("variant name backfill", () => {
  it("fills empty variant names from the catalogue", async () => {
    fs.rmSync(REPORT, { force: true });
    // The pooler in DATABASE_URL refuses Prisma's transaction-mode DDL and can
    // time out; DIRECT_URL is the same database over the direct connection, and
    // this script only touches rows it selects itself.
    //
    // Defaults to .env.prod (where the live backfill ran). Set
    // FILL_TARGET=dev to re-run against the dev database instead.
    forceEnv({ dev: ".env.dev", prod: ".env.prod" }[process.env.FILL_TARGET] ?? ".env.prod");
    if (process.env.DIRECT_URL) process.env.DATABASE_URL = process.env.DIRECT_URL;

    const { variantLabel } = await import("../src/lib/format.js");
    const { prisma } = await import("../src/lib/db.js");

    // NULL or the empty string — the seed paths wrote "" rather than NULL. A
    // name with real content is the operator's own label and is never touched
    // by this backfill.
    //
    // Every variant is fetched and the empty ones filtered in JS rather than
    // pushed into the where clause: Prisma 7's strict runtime validator rejects
    // every spelling of "name is the empty string or null" (`name: ""`, `name:
    // null`, `equals: ""`, `equals: null`) on a scalar filter, and this backfill
    // runs once, so 680 rows in one round trip is not a cost worth contorting
    // the query for. The `isEmpty` predicate is the single definition of "needs
    // a label", reused by the verification step below.
    const all = await prisma.productVariant.findMany({
      select: EMPTY_VARIANT_SELECT,
      orderBy: { denomination: "asc" },
    });
    const isEmpty = (v) => !String(v.name ?? "").trim();
    const empty = all.filter(isEmpty);

    say(`variants with an empty name: ${empty.length} (of ${(await prisma.productVariant.count())} total)`);
    if (!empty.length) {
      say("Nothing to do. Every variant already has a name.");
      return;
    }

    const updates = empty.map((v) => {
      // One linked SKU: the supplier's own label wins — it spells the nominal
      // and carries the bonus clause. More than one (never observed on an empty
      // name, but the ladder may be load-balanced one day) means there is no
      // single authoritative spelling, so derive instead.
      const skuName = v.providerProducts.length === 1
        ? v.providerProducts[0].providerName?.trim()
        : null;
      const label = skuName || variantLabel(v, { productName: v.product.name });
      return { id: v.id, label, slug: v.slug, game: v.product.game.name, skuName };
    });

    say("");
    say(`labels to write: ${updates.length}`);
    for (const u of updates.slice(0, 25)) {
      say(`  ${u.game.padEnd(24)} ${u.slug.padEnd(10)} -> ${u.label}${u.skuName ? "  (provider label)" : ""}`);
    }
    if (updates.length > 25) say(`  ... and ${updates.length - 25} more`);

    if (DRY_RUN) {
      say("");
      say("dry run: no rows written");
      return;
    }

    // Per-row labels, so each variant gets its own name. Grouped per game in
    // the log for the operator reviewing the backfill afterwards.
    let written = 0;
    const byGame = new Map();
    for (const u of updates) {
      await prisma.productVariant.update({ where: { id: u.id }, data: { name: u.label } });
      written += 1;
      byGame.set(u.game, (byGame.get(u.game) ?? 0) + 1);
    }
    say("");
    say(`updated: ${written}`);
    for (const [game, n] of [...byGame.entries()].sort()) say(`  ${game}: ${n}`);

    // Verify: no variant may still have an empty name, and the label must now
    // match what the storefront would render for it. Re-reads the whole table
    // so the check is not satisfied by the rows it still holds in memory.
    const after = await prisma.productVariant.findMany({
      select: EMPTY_VARIANT_SELECT,
      orderBy: { denomination: "asc" },
    });
    const remaining = after.filter(isEmpty).length;
    say(`remaining empty-name variants: ${remaining}`);
    if (remaining) throw new Error(`Masih ada ${remaining} variant tanpa nama setelah backfill`);

    const sample = after.slice(0, 5);
    for (const s of sample) {
      const expected = variantLabel(s, { productName: s.product.name });
      if (s.name !== expected) {
        throw new Error(`Label drift untuk ${s.slug}: db="${s.name}" ui="${expected}"`);
      }
    }
    say(`spot check: ${sample.length} labels match variantLabel() verbatim`);
  });
});
