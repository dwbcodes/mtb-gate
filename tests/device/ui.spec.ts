import { expect, request, test } from "@playwright/test";
import {
  assertRequiredPorts,
  discoverGates,
  getHarnessConfig,
  type GateInfo
} from "./device-harness.ts";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertRequiredPorts();
});

for (const port of getHarnessConfig().ports) {
  test(`@ui ${port} renders dashboard and quick API checks`, async ({ page }) => {
    const gates = await discoverGates();
    const gate = gates.find((g) => g.port === port)!;

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        pageErrors.push(message.text());
      }
    });

    await page.goto(gate.baseUrl + "/");
    await expect(page.getByText("MTB Gate Control Panel")).toBeVisible();

    // Navigate to Network page via side-nav link
    await page.getByRole("link", { name: "Network" }).click();
    await expect(page.locator("#statusDeviceId")).not.toHaveText("—", { timeout: 10000 });
    await expect(page.locator("#statusApSsid")).toHaveText(gate.apSsid);

    // Navigate to API Docs page
    await page.getByRole("link", { name: "API Docs" }).click();
    await page.getByRole("button", { name: "GET /api/status" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("deviceId");

    await page.getByRole("button", { name: "GET /api/riders" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("[");

    await page.getByRole("button", { name: "POST /api/ping" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("ok");

    expect(pageErrors).toEqual([]);
  });
}
