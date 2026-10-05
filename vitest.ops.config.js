// Vitest config for ops scripts (seeding a real environment).
//
// `vitest.config.js` deliberately excludes ops/live files from the default
// suite, and Vitest 5 applies `exclude` BEFORE any CLI filter — so an excluded
// file cannot be run by passing its name. This config is the escape hatch: it
// reuses the same aliases and setup, but narrows `include` to exactly the ops
// file(s) named on the command line.
//
// Run (targets the dev DB via the opt-in; tests/setup.js still refuses prod):
//   ITOPUP_TEST_TARGET=dev npx vitest run --config vitest.ops.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/*.ops.test.js"],
    // Ops files may touch a real database; keep them sequential.
    fileParallelism: false,
    testTimeout: 120_000,
    // Ops writes to a real database, so it uses tests/ops-setup.js (env + the
    // prod guard) and NOT tests/setup.js, whose beforeAll() TRUNCATEs every
    // public table — that would erase what the previous ops script seeded.
    setupFiles: ["tests/ops-setup.js"],
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.js", import.meta.url).pathname,
    },
  },
});
