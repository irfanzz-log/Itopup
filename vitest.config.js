import { defineConfig } from "vitest/config";

/**
 * Unit + integration tests. Playwright E2E lives in tests/e2e and is run by
 * its own runner — including it here fails with confusing "browser is
 * undefined" errors.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js", "tests/integration/**/*.test.js"],
    /**
     * `*.live.test.js` hits the real Melostore API (network, ~80s, needs live
     * credentials and a provider balance). It must never run in `npm test`:
     * the suite would fail on any machine without partner credentials, and CI
     * would burn the provider's 20-request/minute pricelist quota.
     *
     * Run it deliberately:
     *   npx vitest run tests/integration/melostore-sync.live.test.js
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.live.test.js"],
    setupFiles: ["tests/setup.js"],
    // Integration tests share one Postgres database; parallel files would
    // truncate each other's fixtures mid-test.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      // Next aliases `server-only` at build time (that is where the real
      // protection lives); Vitest needs a stub so the import resolves.
      "server-only": new URL("./tests/stubs/server-only.js", import.meta.url).pathname,
    },
  },
});
