import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "login-recovery.spec.ts",
  use: {
    ...base.use,
    ...devices["Desktop Safari"],
    channel: undefined,
  },
});
