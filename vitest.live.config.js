import { defineConfig } from "vitest/config";

/**
 * Live-provider tests ONLY. These hit the real Melostore API and need live
 * credentials, a seeded catalogue, and provider quota — so they are kept out of
 * `npm test` (see the `exclude` in vitest.config.js) and run deliberately:
 *
 *   npx vitest run --config vitest.live.config.js
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.live.test.js"],
    setupFiles: ["tests/setup.js"],
    fileParallelism: false,
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.js", import.meta.url).pathname,
    },
  },
});
