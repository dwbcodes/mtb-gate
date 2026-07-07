import { expect, type APIRequestContext, request, test } from "@playwright/test";
import {
  attachSerialLogs,
  assertRequiredPorts,
  discoverGates,
  getHarnessConfig,
  serialLogWatcherOptions,
  SerialLogWatcher,
  waitForApiStatus,
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

test.describe("@api-roles start gate behavior", () => {
  let api: APIRequestContext;
  let gate: GateInfo;

  test.beforeAll(async () => {
    const gates = await discoverGates();
    gate = gates.find((g) => g.role === "start")!;
    if (!gate) throw new Error("No start gate found — need a device configured as role=start");
    api = await request.newContext({ baseURL: gate.baseUrl });
    await waitForApiStatus(api, 30000);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test("@api-roles start gate reports role=start", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(status.role).toBe("start");
  });

  test("@api-roles start gate has gateNumber=1", async () => {
    const config = await (await api.get("/api/config")).json();
    expect(config.gateNumber).toBe(1);
    expect(config.role).toBe("start");
  });

  test("@api-roles start gate NFC diagnostics shows initialized", async () => {
    const res = await api.get("/api/nfc/diagnostics");
    const body = await res.json();
    // Start gate initializes NFC (may or may not detect hardware)
    expect(body).toHaveProperty("initialized");
    expect(body).toHaveProperty("message");
  });

  test("@api-roles start gate NFC listen is available", async () => {
    const res = await api.post("/api/nfc/listen");
    // 200 = NFC hardware found, 503 = not found — both valid for start gate
    expect([200, 503]).toContain(res.status());
  });

  test("@api-roles start gate broadcasts pings (espNow status available)", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(status.espNow).toBeDefined();
    expect(status.espNow).toHaveProperty("connected");
    expect(status.espNow).toHaveProperty("peerMac");
  });

  test("@api-roles start gate queue tracks runs", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(Array.isArray(status.queue)).toBe(true);
  });

  test("@api-roles start gate AP IP matches gateNumber", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(status.apIp).toBe("192.168.4.1");
  });
});

test.describe("@api-roles finish gate behavior", () => {
  let api: APIRequestContext;
  let gate: GateInfo;

  test.beforeAll(async () => {
    const gates = await discoverGates();
    gate = gates.find((g) => g.role === "finish")!;
    if (!gate) throw new Error("No finish gate found — need a device configured as role=finish");
    api = await request.newContext({ baseURL: gate.baseUrl });
    await waitForApiStatus(api, 30000);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test("@api-roles finish gate reports role=finish", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(status.role).toBe("finish");
  });

  test("@api-roles finish gate has gateNumber=12", async () => {
    const config = await (await api.get("/api/config")).json();
    expect(config.gateNumber).toBe(12);
    expect(config.role).toBe("finish");
  });

  test("@api-roles finish gate AP IP matches gateNumber", async () => {
    const status = await (await api.get("/api/status")).json();
    expect(status.apIp).toBe("192.168.4.12");
  });

  test("@api-roles finish gate auto-discovers start gate peer MAC", async () => {
    const gates = await discoverGates();
    const startGate = gates.find((g) => g.role === "start");
    const status = await (await api.get("/api/status")).json();

    if (startGate?.mac) {
      // If start gate is broadcasting pings, finish gate should auto-discover it
      expect(status.espNow.peerMac).toBe(startGate.mac);
      expect(status.espNow.connected).toBe(true);
    } else {
      // Just verify espNow structure exists
      expect(status.espNow).toHaveProperty("peerMac");
    }
  });

  test("@api-roles finish gate NFC is NOT initialized", async () => {
    const res = await api.get("/api/nfc/diagnostics");
    const body = await res.json();
    // Finish gate should NOT initialize NFC (firmware skips NFC on non-start gates)
    expect(body.initialized).toBe(false);
  });

  test("@api-roles finish gate NFC listen returns 503", async () => {
    const res = await api.post("/api/nfc/listen");
    // Finish gate: NFC reader not initialized → 503
    expect(res.status()).toBe(503);
  });

  test("@api-roles finish gate still serves UI", async () => {
    const res = await api.get("/");
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain("MTB Gate");
  });

  test("@api-roles finish gate still exposes all config APIs", async () => {
    // Config read endpoints work on any gate
    const configRes = await api.get("/api/config");
    expect(configRes.ok()).toBeTruthy();

    const ridersRes = await api.get("/api/riders");
    expect(ridersRes.ok()).toBeTruthy();

    const pingRes = await api.post("/api/ping");
    expect(pingRes.ok()).toBeTruthy();
  });

  test("@api-roles finish gate calibrate works", async () => {
    const res = await api.post("/api/calibrate");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
