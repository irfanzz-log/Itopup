// Environment bootstrap for ops scripts, WITHOUT the test suite's destructive
// reset.
//
// tests/setup.js is the wrong setup file for ops: it TRUNCATEs every public
// table in beforeAll() so integration tests start clean. Pointing an ops script
// at it silently wipes the catalogue the previous ops script just seeded
// (observed: seed-dev-catalog wrote 206 variants, make-dev-session then erased
// them because it shared that beforeAll). Ops writes to a real database, so it
// must never reset one.
//
// This file keeps the parts that matter:
//   * the ITOPUP_TEST_TARGET=dev opt-in, so ops can reach the dev project,
//   * the prod-URL refusal, so a misconfigured target cannot touch prod,
//   * NODE_ENV=test so src/lib/env.js and Prisma pick the right client.
//
// Anything that legitimately needs a clean slate (the integration suite) keeps
// using tests/setup.js; ops scripts use this.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  try {
    const parsed = config({ path });
    return parsed.error ? {} : parsed.parsed ?? {};
  } catch {
    return {};
  }
}

// Same opt-in as tests/setup.js. Default (no env var) loads .env.dev only via
// src/lib/env.js at request time, which is what a plain `next dev` does.
const TEST_TARGET = process.env.ITOPUP_TEST_TARGET;
if (TEST_TARGET === "dev") {
  const devEnv = loadEnvFile(resolve(ROOT, ".env.dev"));
  if (Object.keys(devEnv).length === 0) {
    throw new Error("ops: ITOPUP_TEST_TARGET=dev but .env.dev is missing or empty.");
  }
  for (const [key, value] of Object.entries(devEnv)) {
    process.env[key] = value;
  }
}

// The suite's prod guard, duplicated here so ops inherits it even though this
// file does not import tests/setup.js.
const dbUrl = process.env.DATABASE_URL ?? "";
const looksLikeProd = (() => {
  try {
    return /prod\b|production/i.test(new URL(dbUrl).host) || /\.prod\b/i.test(dbUrl);
  } catch {
    return false;
  }
})();
if (looksLikeProd) {
  throw new Error(
    "ops: refusing to run against a production-looking DATABASE_URL. Ops scripts write to a real database."
  );
}

process.env.NODE_ENV ??= "test";
