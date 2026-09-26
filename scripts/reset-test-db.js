#!/usr/bin/env node
// ============================================================================
// Reset the TEST database: apply migrations, then empty every table.
//
// WHY THIS EXISTS: `vitest` truncates tables but does not run migrations, so
// after a schema change the suite fails with "column X does not exist" — which
// reads like a code bug and is actually a stale test database. This script is
// the one command that fixes that, and it is the reason the manual
// `DATABASE_URL=... npx prisma migrate deploy` step is no longer needed.
//
// SAFETY: it reads .env.test, never .env, and refuses to touch a database whose
// name does not end in `_test`. `reset` here means "drop rows", never "drop
// schema".
// ============================================================================
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} not found. Copy .env.test.example to .env.test first.`);
  }
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const testEnv = loadEnvFile(resolve(ROOT, ".env.test"));
const url = testEnv.DIRECT_URL || testEnv.DATABASE_URL;

if (!url) throw new Error(".env.test must define DIRECT_URL or DATABASE_URL.");

const dbName = (() => {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to reset "${dbName || "(unparsable)"}" — the database name must contain "test".`
  );
}

const childEnv = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
delete childEnv.NODE_ENV;

console.log(`test database: ${dbName}`);

// ── 1. Migrations ────────────────────────────────────────────────────────────
console.log("applying migrations…");
const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: ROOT,
  env: childEnv,
  stdio: "inherit",
});

if (migrate.status !== 0) {
  console.error("migrate deploy failed.");
  process.exit(migrate.status ?? 1);
}

// ── 2. Truncate ──────────────────────────────────────────────────────────────
console.log("truncating tables…");
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`
  );

  if (rows.length === 0) {
    console.log("no tables to truncate.");
  } else {
    const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    console.log(`truncated ${rows.length} table(s).`);
  }
} finally {
  await client.end();
}

console.log("test database ready.");
