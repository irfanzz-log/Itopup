// Config for one-off operator scripts in scripts/ (e.g. a real catalog sync
// against the database in .env).
//
// Critically it does NOT load tests/setup.js — that setup TRUNCATEs every
// table, which would wipe the live catalog this script is meant to populate.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.ops.test.js'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Same stub the test suite uses: these operator scripts run server-side,
      // but `server-only` would otherwise refuse to load outside a Next build.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.js', import.meta.url)),
    },
  },
});
