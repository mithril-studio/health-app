import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3031",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    channel: "chrome",
  },
  webServer: {
    command: "npx next start --hostname 127.0.0.1 --port 3031",
    url: "http://127.0.0.1:3031",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
