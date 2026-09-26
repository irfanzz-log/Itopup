#!/usr/bin/env node
// ============================================================================
// Static checker: CSS component classes used in JSX must exist in globals.css.
//
// WHY THIS EXISTS
//
// Tailwind v4 does not error on an unknown class in `className` — it simply
// renders unstyled. So `className="field-label"` when the stylesheet defines
// `.label` produces a form that LOOKS broken (unstyled input) but builds and
// tests clean. Two such bugs shipped in this project already.
//
// This checker closes that class of bug the same way check-imports.mjs closes
// broken imports: statically, before a browser is involved.
//
// WHAT IT CHECKS: only the app's OWN component classes (the ones defined in
// `@layer components` inside src/app/globals.css). Tailwind utilities
// (`flex`, `mt-4`, `text-foreground`) are Tailwind's business, not ours.
//
// Usage: node scripts/check-classes.mjs
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_FILE = resolve(ROOT, "src/app/globals.css");
const SRC = resolve(ROOT, "src");

// ── 1. Collect the component classes the stylesheet actually defines ─────────
const css = readFileSync(CSS_FILE, "utf8");

const defined = new Set();

// Restrict to the @layer components block: a class defined inside @layer base or
// utilities is not what components are expected to use.
const layerMatch = css.match(/@layer\s+components\s*\{([\s\S]*)\n\}/);
const componentCss = layerMatch ? layerMatch[1] : css;

for (const match of componentCss.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
  defined.add(match[1]);
}

// ── 2. Collect class names used in JSX/JS ───────────────────────────────────
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

const files = walk(SRC);
const used = new Map(); // class -> Set(files)

for (const file of files) {
  const text = readFileSync(file, "utf8");

  const addClasses = (value) => {
    for (const cls of value.split(/\s+/)) {
      // Strip Tailwind modifiers (hover:, dark:, sm:) — we compare the base.
      const base = cls.includes(":") ? cls.split(":").pop() : cls;
      if (!base) continue;
      if (!used.has(base)) used.set(base, new Set());
      used.get(base).add(relative(ROOT, file));
    }
  };

  // className="..."  and  className={`...`}
  for (const match of text.matchAll(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    let value = match[1] ?? match[2] ?? "";
    // A template literal may interpolate an expression: `mt-1 ${cond ? "a" : "b"}`.
    // Drop the `${...}` parts before splitting on whitespace, or their tokens
    // (`hint.tone`, `===`, `"danger"`) are read as class names.
    if (match[2] !== undefined) {
      value = value.replace(/\$\{[\s\S]*?\}/g, " ");
    }
    addClasses(value);
  }

  // className={...} with a JS expression inside. Extract only the string
  // literals WITHIN the braces, by scanning to the matching brace — a regex
  // spanning the expression happily picks up unrelated strings (e.g. an
  // aria-describedby a few lines later), which produced a false positive here.
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
    // Skip a template literal already handled above.
    if (expr.startsWith("`")) continue;
    for (const literal of expr.matchAll(/"([^"]*)"/g)) addClasses(literal[1]);
  }
}

// ── 3. Report classes that LOOK like ours but are not defined ───────────────
// A class is "ours" when it is a bare word with no Tailwind-ish shape. We only
// flag names that are a near-miss for a defined class or carry our own naming
// prefix, so the checker does not drown the user in false positives from
// Tailwind utilities it cannot know about.
const OUR_PREFIXES = ["field", "btn", "card", "chip", "container", "section", "skip", "skeleton", "label", "hint", "text-balance"];
const TAILWIND_HINT = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|items-|justify-|gap-|space-|p[xytblr]?-|m[xytblr]?-|w-|h-|min-|max-|text-|font-|bg-|border|rounded|shadow|opacity-|overflow-|transition|duration-|ease-|hover:|focus:|active:|disabled:|dark:|sm:|md:|lg:|xl:|2xl:|group|peer|sr-only|not-sr-only|truncate|whitespace-|break-|leading-|tracking-|uppercase|lowercase|capitalize|normal-case|italic|underline|line-through|no-underline|antialiased|tabular-nums|prose|divide-|ring|outline|fill-|stroke-|from-|via-|to-|animate-|cursor-|select-|pointer-events-|resize|appearance-|placeholder:|first:|last:|odd:|even:|before:|after:|placeholder|tabular|z-|order-|col-|row-|basis-|grow|shrink|self-|place-|content-|object-|aspect-|columns-|float-|clear-|isolate|mix-blend-|blur|brightness-|contrast-|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia|backdrop-|will-change-|touch-|scroll-|snap-|list-|indent-|align-|vertical-align|decoration-|underline-offset|caret-|accent-|field-sizing|scheme-|forced-color|print:|motion-|contrast-more:|portrait:|landscape:|rtl:|ltr:|open:|checked:|indeterminate:|default:|required:|valid:|invalid:|in-range:|out-of-range:|read-only:|empty:|focus-within:|focus-visible:|target:|aria-|data-|supports-|has-|not-|max-|\[|--)/;

const problems = [];

for (const [cls, filesUsing] of used) {
  if (defined.has(cls)) continue;
  if (TAILWIND_HINT.test(cls)) continue;

  const looksOurs = OUR_PREFIXES.some((prefix) => cls.startsWith(prefix));
  if (!looksOurs) continue;

  // Near-miss detection: a defined class that differs only by a separator or a
  // suffix, e.g. `field-label` vs `label`, `field-input` vs `field`.
  const nearMiss = [...defined].find(
    (candidate) => cls === candidate || cls.replace(/-/g, "") === candidate.replace(/-/g, "")
  );

  problems.push({
    cls,
    files: [...filesUsing],
    hint: nearMiss ? `did you mean "${nearMiss}"?` : null,
  });
}

// ── 4. Report ───────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`checked ${files.length} files; ${defined.size} component classes defined`);
  console.log("\nall component classes resolve ✓");
  process.exit(0);
}

console.error(`\n${problems.length} undefined component class(es):\n`);
for (const problem of problems) {
  console.error(`  ✗ .${problem.cls}${problem.hint ? `  (${problem.hint})` : ""}`);
  for (const file of problem.files) console.error(`      ${file}`);
}
console.error("\nDefined component classes:");
console.error(`  ${[...defined].sort().join(", ")}`);
process.exit(1);
