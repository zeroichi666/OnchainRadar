import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000", env: { DATA_MODE: "demo" }, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
