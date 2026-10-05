import { defineConfig } from "vitest/config";

/**
 * Unit + integration tests. Playwright E2E lives in tests/e2e and is run by
 * its own runner — including it here fails with confusing "browser is
 * undefined" errors.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.js",
      "tests/unit/**/*.test.jsx",
      "tests/integration/**/*.test.js",
      "tests/integration/**/*.test.jsx",
    ],
    /**
     * `*.live.test.js` hits the real Melostore API (network, ~80s, needs live
     * credentials and a provider balance). It must never run in `npm test`:
     * the suite would fail on any machine without partner credentials, and CI
     * would burn the provider's 20-request/minute pricelist quota.
     *
     * Run it deliberately:
     *   npx vitest run tests/integration/melostore-sync.live.test.js
     */
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Hits the live Melostore API: network, ~80s, and needs partner
      // credentials plus a provider balance. Would fail on any machine without
      // them and burn the provider's 20-request/minute pricelist quota in CI.
      "**/*.live.test.js",
      // Ops scripts that write to a real database. They target a specific
      // environment via ITOPUP_TEST_TARGET and are never part of the default
      // suite — running them locally would seed the throwaway test DB for no
      // reason, and a misconfigured target could touch a shared database.
      "**/*.ops.test.js",
    ],
    setupFiles: ["tests/setup.js"],
    // Integration tests share one Postgres database; parallel files would
    // truncate each other's fixtures mid-test.
    fileParallelism: false,
    testTimeout: 20_000,
    /**
     * Coverage is opt-in via `npm run test:coverage`. It is NOT on by default
     * because instrumenting every file slows the suite, and the local Postgres
     * integration tests dominate runtime anyway — nobody would run the slow
     * path when iterating.
     */
    coverage: {
      enabled: !!process.env.ITOPUP_COVERAGE,
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["src/**/*.js", "src/**/*.jsx"],
      // Config and barrel files carry no logic; counting them dilutes the signal.
      exclude: ["**/*.config.js", "**/*.d.ts", "src/**/*.test.*"],
    },
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
