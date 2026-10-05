import { defineConfig, devices } from "@playwright/test";

// The dev server is launched as a LaunchAgent (com.itopup.dev, see
// /Users/irfanzzs/.local/share/itopup/dev-agent.sh) so it outlives this shell —
// a foreground `npm run dev` is reaped by Hermes' terminal backend after ~4
// minutes. It listens on 3002, the port the local crontab already targets.
// `reuseExistingServer` accepts ANY process already listening on the port, which
// would silently run the suite against a foreign app — keep the E2E port
// explicit and overridable.
const PORT = process.env.E2E_PORT || "3200";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 2 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
