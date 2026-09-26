#!/usr/bin/env node
// ============================================================================
// Static checker: a grid whose only column definition is a RESPONSIVE variant
// blows the layout out on small screens.
//
// THE BUG THIS CATCHES
//
//   <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
//
// At 375px the `lg:` variant is inactive, so the grid has NO explicit column
// definition. Its single implicit column is sized `auto`, which resolves to
// MAX-CONTENT — the widest the content can be, not the width available. One
// wide child (a 3-step indicator, a long invoice number) then pushes the whole
// document wider than the viewport: horizontal scroll on every phone.
//
// Measured before the fix: /topup/game/mobile-legends had scrollWidth 504 in a
// 375px viewport, and the grid's resolved column was 487.953px. After adding
// `grid-cols-1` the column resolves to `minmax(0, 1fr)` and the layout fits.
//
// THE RULE
//
// A `grid` that declares columns only behind a breakpoint must ALSO declare a
// base column definition (`grid-cols-1` and up), so the implicit auto column can
// never be used.
//
// Deliberately NOT flagged: a `grid` with no column definition at all. That is
// often intentional for a single full-width child, and `grid` alone does not
// create the blowout — an auto-sized column does, which is the case this rule
// targets. The measured evidence is in the header above.
//
// Usage: node scripts/check-responsive.mjs
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(jsx|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** All `className` values in a file, including multi-line and expression forms. */
function classNameValues(text) {
  const values = [];

  // className="..."  and  className={`...`}   (the dotAll flag handles newlines)
  for (const match of text.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/gs)) {
    let value = match[1] ?? match[2] ?? "";
    if (match[2] !== undefined) value = value.replace(/\$\{[\s\S]*?\}/g, " ");
    values.push(value);
  }

  // className={...} — brace-matched, then only the string literals inside.
  const marker = /className\s*=\s*\{/g;
  let found;
  while ((found = marker.exec(text)) !== null) {
    let depth = 1;
    let i = marker.lastIndex;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    const expr = text.slice(marker.lastIndex, i - 1);
    if (expr.startsWith("`")) continue; // already handled above
    for (const literal of expr.matchAll(/"([^"]*)"/g)) values.push(literal[1]);
  }

  return values;
}

/** Split a class attribute into tokens. */
const tokensOf = (value) => value.split(/\s+/).filter(Boolean);

/** A token like `lg:grid-cols-2` or `sm:hover:grid-cols-1` is responsive. */
const isResponsiveCols = (token) => /:grid-cols-/.test(token);

/** A token like `grid-cols-1` or `grid-cols-[minmax(0,1fr)_360px]` is a base. */
const isBaseCols = (token) => token.startsWith("grid-cols-");

const problems = [];

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  for (const value of classNameValues(text)) {
    const tokens = tokensOf(value);
    if (!tokens.includes("grid")) continue;

    const hasBase = tokens.some(isBaseCols);
    if (hasBase) continue;

    const responsive = tokens.filter(isResponsiveCols);
    if (responsive.length === 0) continue; // no columns declared at all — out of scope

    // Locate the line for a useful message.
    const needle = tokens.slice(0, 4).join(" ");
    const lineIndex = lines.findIndex((l) => l.includes(needle.split(" ")[0]) && l.includes("grid"));

    problems.push({
      file: relative(ROOT, file),
      line: lineIndex >= 0 ? lineIndex + 1 : null,
      responsive,
      value: value.replace(/\s+/g, " ").trim().slice(0, 100),
    });
  }
}

if (problems.length === 0) {
  console.log("checked all JSX for grids with only responsive column definitions");
  console.log("\nno implicit-auto-column grids ✓");
  process.exit(0);
}

console.error(`\n${problems.length} grid(s) declare columns ONLY behind a breakpoint:\n`);
for (const problem of problems) {
  console.error(`  ✗ ${problem.file}${problem.line ? `:${problem.line}` : ""}`);
  console.error(`      ${problem.value}`);
  console.error(`      add a base column definition (e.g. "grid-cols-1") so the implicit`);
  console.error(`      auto column cannot size to max-content on small screens.`);
  console.error(`      responsive tokens: ${problem.responsive.join(" ")}\n`);
}
process.exit(1);
