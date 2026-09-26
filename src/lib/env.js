// ============================================================================
// Loads the right .env file for the current process, once.
//
// - test  → .env.test   (tests must never point at the real database)
// - other → .env
//
// Imported at the top of src/lib/db.js so that any entry point (Next server,
// seed script, cron job, vitest) gets a configured process.env before Prisma
// reads DATABASE_URL.
// ============================================================================
import { config } from "dotenv";
import path from "node:path";

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const file = isTest ? ".env.test" : ".env";

  // `override: false` — a real environment variable (CI, Vercel, docker) always
  // beats a local file.
  config({ path: path.resolve(process.cwd(), file), override: false, quiet: true });
  // Fall back to .env for anything the test file does not define.
  if (isTest) {
    config({ path: path.resolve(process.cwd(), ".env"), override: false, quiet: true });
  }
}
