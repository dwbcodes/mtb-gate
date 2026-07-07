import { expect, test } from "@playwright/test";
import {
  assertRequiredPorts,
  getHarnessConfig,
  requestConsoleApi,
  sendSerialCommand
} from "./device-harness.ts";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertRequiredPorts();
});

for (const port of getHarnessConfig().ports) {
  test.describe(`@console-extended ${port}`, () => {

    test("@console-extended help command lists available commands", async () => {
      const output = await sendSerialCommand(port, "help");
      expect(output).toContain("Commands:");
    });

    test("@console-extended status command shows device info", async () => {
      const output = await sendSerialCommand(port, "status");
      expect(output).toContain("Device");
      expect(output).toMatch(/AP SSID:/i);
      expect(output).toMatch(/MAC:/i);
    });

    test("@console-extended wifi command shows AP info", async () => {
      const output = await sendSerialCommand(port, "wifi");
      expect(output).toMatch(/AP/i);
      expect(output).toContain("http://");
    });

    test("@console-extended scan with unknown tag shows error", async () => {
      const output = await sendSerialCommand(port, "scan=unknown-tag-xyz");
      expect(output).toMatch(/[Uu]nknown|[Rr]egister/);
    });

    test("@console-extended scan with registered rider starts run", async () => {
      const tagId = `scantest-${Date.now()}-${port.replace(/\W/g, "")}`;

      try {
        const res = await requestConsoleApi<any>(
          port,
          `api riders/add {"tagId":"${tagId}","displayName":"Scan Test Rider"}`
        );
        expect(res.ok).toBe(true);

        // Small delay to let registration persist
        await new Promise((r) => setTimeout(r, 500));

        const output = await sendSerialCommand(port, `scan=${tagId}`);
        // Should see the simulated scan message or countdown start
        expect(output).toMatch(/[Ss]imulated|[Cc]ountdown|[Ss]can|[Rr]un/);
      } finally {
        await requestConsoleApi(port, `api riders/delete {"tagId":"${tagId}"}`).catch(() => {});
      }
    });
  });
}
