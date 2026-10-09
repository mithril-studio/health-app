import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: [
    "login-recovery.spec.ts",
    "workouts.spec.ts",
    "workout-recovery.spec.ts",
  ],
  projects: [
    { name: "WebKit" },
    {
      name: "iPhone WebKit",
      testMatch: "workout-recovery.spec.ts",
      use: { ...devices["iPhone 13"], channel: undefined },
    },
  ],
  use: {
    ...base.use,
    ...devices["Desktop Safari"],
    channel: undefined,
  },
});
