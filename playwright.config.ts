import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/fr",
    reuseExistingServer: true,
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 14"] } },
    { name: "laptop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tv-1080p", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
