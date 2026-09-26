import { defineConfig, devices } from "@playwright/test";

// Port 3000 on this machine is occupied by an unrelated daemon (the Hermes
// WhatsApp bridge). `reuseExistingServer` accepts ANY process already listening
// on the port, which would silently run the suite against a foreign app — keep
// the E2E port explicit and overridable.
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
