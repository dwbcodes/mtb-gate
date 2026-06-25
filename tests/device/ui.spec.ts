import { expect, test } from "@playwright/test";
import {
  assertRequiredPorts,
  connectToGateAp,
  getHarnessConfig,
  readGateInfo,
  waitForGateApi
} from "./device-harness.ts";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertRequiredPorts();
});

for (const port of getHarnessConfig().ports) {
  test(`@ui ${port} renders dashboard and quick API checks`, async ({ page }) => {
    const config = getHarnessConfig();
    const gate = await readGateInfo(port, config);
    await connectToGateAp(gate, config);
    await waitForGateApi(config);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        pageErrors.push(message.text());
      }
    });

    await page.goto("/");
    await expect(page.getByText("MTB Gate Control Panel")).toBeVisible();

    await page.getByRole("button", { name: "Network" }).click();
    await page.evaluate(() => (globalThis as any).loadStatus?.());
    await expect(page.locator("#statusDeviceId")).not.toHaveText("—");
    await expect(page.locator("#statusApSsid")).toHaveText(gate.apSsid);

    await page.getByRole("button", { name: "Documents" }).click();
    await page.getByRole("button", { name: "Test /api/status" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("deviceId");

    await page.getByRole("button", { name: "Test /api/riders" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("[");

    await page.getByRole("button", { name: "Test /api/ping" }).click();
    await expect(page.locator("#apiTestResult")).toContainText("ok");

    expect(pageErrors).toEqual([]);
  });
}
