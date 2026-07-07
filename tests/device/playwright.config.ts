import { defineConfig, devices } from "@playwright/test";
import { getDeviceTestConfig } from "./test-config.ts";

const testConfig = getDeviceTestConfig();

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: testConfig.testTimeoutMs,
  expect: {
    timeout: testConfig.expectTimeoutMs
  },
  use: {
    baseURL: testConfig.baseUrl,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
