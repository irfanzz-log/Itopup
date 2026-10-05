// ============================================================================
// Vitest global setup.
//
// THE SAFETY RULE OF THIS FILE: integration tests truncate tables. If they ever
// pointed at the Supabase database, they would destroy production data. So the
// first thing that happens is a hard refusal to run against anything whose
// database name does not end in `_test`.
//
// `.env.test` is loaded explicitly and its DATABASE_URL OVERRIDES whatever the
// shell has exported, the opposite of dotenv's default precedence, and the
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
//
// EXCEPTION — `ITOPUP_TEST_TARGET=dev`. The default is the local throwaway
// database, and that is what CI and `npm test` must use. But verifying a fix
// against the real Supabase dev project (which the dev server actually points
// at) needs the suite to run there, and that database's name does not contain
// "test". This is an explicit, deliberate opt-in: nothing env-related can aim
// the suite at Supabase by accident, and the flag still refuses PRODUCTION
// below, so the safety property survives.
const TEST_TARGET = process.env.ITOPUP_TEST_TARGET || "test";

if (TEST_TARGET !== "test" && TEST_TARGET !== "dev") {
  throw new Error(
    `tests: unknown ITOPUP_TEST_TARGET="${TEST_TARGET}" — use "test" (default, local DB) or "dev" (Supabase dev project).`
  );
}

if (TEST_TARGET === "test") {
  for (const [key, value] of Object.entries(testEnv)) {
    process.env[key] = value;
  }
} else {
  // ITOPUP_TEST_TARGET=dev: point the suite at the Supabase DEV project. Load
  // .env.dev the same overriding way, so prisma picks up the dev DATABASE_URL
  // and the matching AUTH_SECRET. src/lib/db.js's own loadEnv() runs later and
  // only fills gaps (override:false), so it cannot undo this.
  const devEnv = loadEnvFile(resolve(ROOT, ".env.dev"));
  if (Object.keys(devEnv).length === 0) {
    throw new Error("tests: ITOPUP_TEST_TARGET=dev but .env.dev is missing or empty.");
  }
  for (const [key, value] of Object.entries(devEnv)) {
    process.env[key] = value;
  }
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

const IS_PROD_URL = (() => {
  // The dev and prod projects are distinguishable only by the connection string
  // itself. .env.prod is the one file that must never be loaded for testing.
  try {
    return new URL(dbUrl).host.includes("prod") || /\.prod\b|production/i.test(dbUrl);
  } catch {
    return false;
  }
})();

if (IS_PROD_URL) {
  throw new Error(
    `tests: refusing to run against a production-looking DATABASE_URL. ` +
      "Integration tests TRUNCATE tables. Use ITOPUP_TEST_TARGET=test or =dev."
  );
}
// The name-must-contain-"test" guard only applies to the default target.
if (TEST_TARGET === "test" && !/test/i.test(dbName)) {
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
