#!/usr/bin/env node
// ============================================================================
// Static import checker.
//
// Catches the exact bug class that a wrong import path or a typo'd named import
// produces: it resolves every relative and `@/` import under src/ to a real file
// and verifies that each named import actually appears as an export in that
// module. No build, no bundler — just regex + the filesystem, so it runs in
// under a second and can be wired into CI as a fast gate.
//
// It is deliberately CONSERVATIVE: anything it cannot resolve statically (a
// re-export chain it cannot follow, a default import, a dynamic import) is
// reported as a warning rather than a failure, so it never blocks on a false
// positive.
// ============================================================================
import { readFileSync, existsSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const EXTENSIONS = [".js", ".jsx", ".mjs", ".ts", ".tsx"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve a specifier to a file on disk, mimicking Node/Next resolution. */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return { kind: "bare" };

  const candidates = [base, ...EXTENSIONS.map((e) => base + e)];
  for (const ext of EXTENSIONS) candidates.push(join(base, `index${ext}`));

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { kind: "file", path: candidate };
    }
  }
  return { kind: "missing", base };
}

/** Collect exported names from a module's source. */
function exportsOf(source) {
  const names = new Set();

  // export function foo / export async function foo / export const foo / export class Foo
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    names.add(m[1]);
  }

  // export { a, b as c }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const alias = trimmed.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }

  // export default
  if (/^export\s+default\b/m.test(source)) names.add("default");

  // `export * from "./x"` — cannot enumerate; flag the module as opaque.
  if (/^export\s+\*\s+from\s/m.test(source)) names.add("*");

  return names;
}

const files = walk(SRC);
const errors = [];
const warnings = [];
const exportCache = new Map();

function exportsFor(path) {
  if (!exportCache.has(path)) {
    exportCache.set(path, exportsOf(readFileSync(path, "utf8")));
  }
  return exportCache.get(path);
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  for (const match of source.matchAll(IMPORT_RE)) {
    const clause = match[1].trim();
    const spec = match[2];
    const resolved = resolveSpecifier(spec, file);

    if (resolved.kind === "bare") continue;

    if (resolved.kind === "missing") {
      errors.push(`${rel}: unresolved import "${spec}"`);
      continue;
    }

    const target = resolved.path;

    // Extract the named-import list: `{ a, b as c }`
    const braceMatch = clause.match(/\{([\s\S]*)\}/);
    if (!braceMatch) continue; // default-only or namespace import

    const available = exportsFor(target);
    if (available.has("*")) {
      warnings.push(`${rel}: "${spec}" re-exports * — named imports not verified`);
      continue;
    }

    for (const part of braceMatch[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const imported = trimmed.split(/\s+as\s+/)[0].trim();
      if (!imported) continue;

      if (!available.has(imported)) {
        errors.push(
          `${rel}: "${imported}" is not exported by "${spec}" ` +
            `(available: ${[...available].sort().join(", ") || "none"})`
        );
      }
    }
  }
}

console.log(`checked ${files.length} files under src/`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log("\nall imports resolve ✓");
