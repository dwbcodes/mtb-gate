import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: Number(process.env.MTB_GATE_TEST_TIMEOUT_MS ?? 120_000),
  expect: {
    timeout: Number(process.env.MTB_GATE_EXPECT_TIMEOUT_MS ?? 10_000)
  },
  use: {
    baseURL: process.env.MTB_GATE_BASE_URL ?? "http://192.168.4.1",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
