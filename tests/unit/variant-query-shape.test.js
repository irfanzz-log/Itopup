// ============================================================================
// A schema column must never be able to break a query that does not ask for it.
//
// THE PRODUCTION INCIDENT THIS PINS
//
// A migration added `ProductVariant.pricingRule`. Vercel auto-deploys `main`, so
// the CODE went live before the migration was applied to the production
// database. Pages still rendered, but /api/topup/price answered 500 — checkout's
// price preview was dead — because `getSellableVariant` uses Prisma `include:`,
// and Prisma compiles that into an EXPLICIT list of every column on the model.
// Selecting a column that does not exist yet is a hard error.
//
// Two separate failures had to line up: a deploy that outran its migration, and
// a query that depends on the full column list. The first is fixed in
// package.json (`vercel-build` runs `prisma migrate deploy` before `next build`).
// This file guards the second, because it is the one a future column can break
// again in a different route.
//
// WHAT IS CHECKED: every Prisma query against productVariant must either name
// its columns (`select`) or be one of the audited exceptions below. `include`
// alone is the dangerous shape: it implies "all scalar columns".
// ============================================================================
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

/**
 * Queries that legitimately read the whole row.
 *
 * Each one is listed with the reason it needs every column, so adding an
 * exception is a decision someone has to justify rather than a silent default.
 * They are still exposed to the incident above — which is why the deploy fix
 * matters more than the shape of any single query — but they are not silent.
 */
const ALLOWED_FULL_ROW = [
  // The catalogue sync compares stored cost/selling/rule and rewrites them; it
  // reads the row to decide, and every field it touches is part of that.
  "services/sync.service.js",
  // Admin catalogue editing: the form round-trips the whole row.
  "services/admin-catalog.service.js",
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files that query productVariant at all. */
function filesQueryingVariants() {
  return walk(SRC).filter((file) => {
    const text = readFileSync(file, "utf8");
    return /prisma\.productVariant\.(find|update|create|upsert|delete)/.test(text);
  });
}

describe("productVariant queries name their columns", () => {
  it("found the files that query variants (so the guard is not vacuous)", () => {
    expect(filesQueryingVariants().length).toBeGreaterThan(3);
  });

  it("no query uses `include` without an explicit select", () => {
    const offenders = [];

    for (const file of filesQueryingVariants()) {
      const rel = path.relative(SRC, file);
      const text = readFileSync(file, "utf8");

      // Find each productVariant query and look at the few lines that follow.
      const pattern = /prisma\.productVariant\.(find\w*|update\w*|create\w*|upsert|delete\w*)\s*\(\s*\{/g;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const window = text.slice(match.index, match.index + 700);
        const hasSelect = /\bselect\s*:/.test(window);
        const hasInclude = /\binclude\s*:/.test(window);
        const isWrite = /^(update|create|upsert|delete)/.test(match[1]);

        // Writes without select only return columns; they do not READ a
        // column list, so they cannot fail on a missing one.
        if (isWrite && !hasSelect) continue;

        if (hasInclude && !hasSelect && !ALLOWED_FULL_ROW.includes(rel)) {
          offenders.push(`${rel}: ${match[1]} uses include without select`);
        }
      }
    }

    expect(
      offenders,
      "a query that reads every column breaks the moment a migration has not run yet " +
        "(this took production checkout down). Name the columns with `select`."
    ).toEqual([]);
  });

  it("getSellableVariant — the query that broke checkout — names its columns", () => {
    const text = readFileSync(path.join(SRC, "services/catalog.service.js"), "utf8");
    const start = text.indexOf("export async function getSellableVariant");
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, start + 1200);

    // It may use `include` for the relations, but the SCALARS must be listed.
    expect(body).toMatch(/\bselect\s*:/);
    expect(body).toMatch(/sellingPrice:\s*true/);
    expect(body).toMatch(/costPrice:\s*true/);
  });
});
