// ============================================================================
// Loads the right .env file for the current process, once.
//
// SELECTION — the project keeps one file per target, never a live .env:
//   test       → .env.test   (tests must never point at the real database)
//   production → .env.prod   (the deployed Supabase project)
//   anything   → .env.dev    (local development)
//
// On Vercel there is no .env.* file at all: the platform injects real
// environment variables at runtime, and `override: false` below means those
// always win. The file is only a fallback for local/`next` workflows.
//
// Imported at the top of src/lib/db.js so that any entry point (Next server,
// seed script, cron job, vitest) gets a configured process.env before Prisma
// reads DATABASE_URL.
//
// NOT SERVER-ONLY, ON PURPOSE. This module must also load in a bare `node`
// process (prisma seed, operator scripts). The real boundary is env.server.js,
// which reads secrets and carries the guard.
// ============================================================================
import { config } from "dotenv";
import path from "node:path";

let loaded = false;

const ENV_FILE = (() => {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "test" || process.env.VITEST === "true") return ".env.test";
  if (nodeEnv === "production") return ".env.prod";
  return ".env.dev";
})();

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  // `override: false` — a real environment variable (CI, Vercel, docker) always
  // beats a local file.
  //
  // `/*turbopackIgnore: true*/` — the resolved path is only ever known at
  // runtime, so static analysis cannot see that it is bounded to three fixed
  // filenames (.env.dev/.env.prod/.env.test). Without it Turbopack traces the
  // entire project as server code. This is server-only code; the annotation
  // tells the bundler to stop following it, not to ship it to a browser.
  config({
    path: path.resolve(/*turbopackIgnore: true*/ process.cwd(), ENV_FILE),
    override: false,
    quiet: true,
  });
  // Fall back to .env.dev for anything the test file does not define.
  if (ENV_FILE === ".env.test") {
    config({
      path: path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".env.dev"),
      override: false,
      quiet: true,
    });
  }
}

/** Test hook: expose which file this process selected, without exposing values. */
export const resolvedEnvFile = () => ENV_FILE;
