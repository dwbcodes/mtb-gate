import { expect, request, test } from "@playwright/test";
import {
  attachSerialLogs,
  assertRequiredPorts,
  discoverGates,
  getHarnessConfig,
  serialLogWatcherOptions,
  SerialLogWatcher,
  type GateInfo
} from "./device-harness.ts";

test.describe.configure({ mode: "serial" });

let serialWatcher: SerialLogWatcher | undefined;

test.beforeAll(async () => {
  await assertRequiredPorts();
  await discoverGates();
  serialWatcher = new SerialLogWatcher(getHarnessConfig().ports, serialLogWatcherOptions());
  await serialWatcher.start();
});

test.afterAll(async ({}, testInfo) => {
  if (!serialWatcher) return;
  await serialWatcher.stop();
  await attachSerialLogs(testInfo, serialWatcher);
  serialWatcher.assertNoErrors();
});

for (const port of getHarnessConfig().ports) {
  test.describe(`@api-endpoints ${port}`, () => {
    let api: Awaited<ReturnType<typeof request.newContext>>;
    let gate: GateInfo;

    test.beforeAll(async () => {
      const gates = await discoverGates();
      gate = gates.find((g) => g.port === port)!;
      api = await request.newContext({ baseURL: gate.baseUrl });
    });

    test.afterAll(async () => {
      await api?.dispose();
    });

    // --- Static assets ---

    test("@api-endpoints GET / returns HTML", async () => {
      const res = await api.get("/");
      expect(res.ok()).toBeTruthy();
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("MTB Gate");
    });

    test("@api-endpoints GET /styles.css returns CSS", async () => {
      const res = await api.get("/styles.css");
      expect(res.ok()).toBeTruthy();
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("text/css");
    });

    test("@api-endpoints GET /main.js returns JavaScript", async () => {
      const res = await api.get("/main.js");
      expect(res.ok()).toBeTruthy();
      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType.includes("javascript") || contentType.includes("text/javascript") || contentType.includes("application/javascript")).toBeTruthy();
    });

    // --- Calibrate ---

    test("@api-endpoints POST /api/calibrate returns ok", async () => {
      const res = await api.post("/api/calibrate");
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({ ok: true, message: expect.any(String) }));
    });

    // --- NFC endpoints ---

    test("@api-endpoints GET /api/nfc/diagnostics returns shape", async () => {
      const res = await api.get("/api/nfc/diagnostics");
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toEqual(expect.objectContaining({
        initialized: expect.any(Boolean),
        message: expect.any(String)
      }));
    });

    test("@api-endpoints GET /api/nfc/tag returns shape", async () => {
      const res = await api.get("/api/nfc/tag", { timeout: 15000 });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toHaveProperty("ok");
      expect(body).toHaveProperty("tagId");
    });

    test("@api-endpoints POST /api/nfc/listen returns 200 or 503", async () => {
      const res = await api.post("/api/nfc/listen");
      // 200 if NFC hardware present, 503 if not
      expect([200, 503]).toContain(res.status());
      const body = await res.json();
      if (res.status() === 200) {
        expect(body).toEqual(expect.objectContaining({ ok: true, message: expect.any(String) }));
      } else {
        expect(body).toHaveProperty("error");
      }
    });

    // --- I2C scan ---

    test("@api-endpoints GET /api/i2c/scan returns shape", async () => {
      const res = await api.get("/api/i2c/scan");
      expect(res.ok()).toBeTruthy();
      // Firmware outputs hex literals (0x24) which are invalid JSON,
      // so parse as text and check structure
      const text = await res.text();
      expect(text).toContain('"devices"');
      expect(text).toContain('"message"');
    });

    // --- Reboot (skipped -- causes device restart) ---

    test.skip("@api-endpoints POST /api/reboot", async () => {
      const res = await api.post("/api/reboot");
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });
}
