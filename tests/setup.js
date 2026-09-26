// ============================================================================
// Vitest global setup.
//
// THE SAFETY RULE OF THIS FILE: integration tests truncate tables. If they ever
// pointed at the Supabase database, they would destroy production data. So the
// first thing that happens is a hard refusal to run against anything whose
// database name does not end in `_test`.
//
// `.env.test` is loaded explicitly and its DATABASE_URL OVERRIDES whatever the
// shell has exported — the opposite of dotenv's default precedence, and the
// right way round here: a stray `export DATABASE_URL=...production` in a shell
// must not be able to aim the test suite at production.
// ============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env parser: KEY=value, `#` comments, optional surrounding quotes. */
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
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

if (Object.keys(testEnv).length === 0) {
  throw new Error(
    "tests: .env.test is missing. Copy .env.test.example and point it at a throwaway database."
  );
}

// Override, not fill-in: see the header comment.
for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}
process.env.NODE_ENV = "test";

const dbUrl = process.env.DATABASE_URL || "";
const dbName = (() => {
  try {
    return new URL(dbUrl).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!/test/i.test(dbName)) {
  throw new Error(
    `tests: refusing to run against database "${dbName || "(unparsable URL)"}" — ` +
      "the name must contain 'test'. Integration tests TRUNCATE tables."
  );
}

// Imported only after the guard, so a misconfigured run fails before a single
// connection is opened.
const { prisma } = await import("../src/lib/db.js");

/** Truncate every table the suite touches, in one statement. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

export { prisma };
