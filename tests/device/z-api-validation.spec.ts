import { expect, request, test } from "@playwright/test";
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

for (const port of getHarnessConfig().ports) {
  test.describe(`@api-validation ${port}`, () => {
    let api: Awaited<ReturnType<typeof request.newContext>>;
    let gate: GateInfo;

    test.beforeAll(async () => {
      const gates = await discoverGates();
      gate = gates.find((g) => g.port === port)!;
      api = await request.newContext({ baseURL: gate.baseUrl });
      // Verify reachable
      const res = await api.get("/api/status", { timeout: 5000 });
      expect(res.ok(), `Gate at ${gate.baseUrl} not reachable`).toBeTruthy();
    });

    test.afterAll(async () => {
      await api?.dispose();
    });

    // --- Method enforcement ---
    // ESP32 WebServer returns 404 when a route is registered for a different method,
    // or 405 if the handler explicitly checks. Both indicate correct rejection.

    test("@api-validation GET on PUT-only endpoints is rejected", async () => {
      const endpoints = ["/api/config/wifi", "/api/config/time", "/api/config/mac"];
      for (const endpoint of endpoints) {
        const res = await api.get(endpoint);
        expect([404, 405], `${endpoint} should reject GET with 404 or 405`).toContain(res.status());
      }
    });

    test("@api-validation GET on POST-only endpoints is rejected", async () => {
      const endpoints = ["/api/ping", "/api/calibrate", "/api/reboot", "/api/nfc/listen"];
      for (const endpoint of endpoints) {
        const res = await api.get(endpoint);
        expect([404, 405], `${endpoint} should reject GET with 404 or 405`).toContain(res.status());
      }
    });

    test("@api-validation POST on GET-only endpoints is rejected", async () => {
      // Exclude /api/riders — it has both GET and POST registered
      const endpoints = ["/api/status", "/api/config", "/api/nfc/diagnostics", "/api/nfc/tag", "/api/i2c/scan"];
      for (const endpoint of endpoints) {
        const res = await api.post(endpoint, { data: {} });
        expect([404, 405], `${endpoint} should reject POST with 404 or 405`).toContain(res.status());
      }
    });

    // --- Malformed JSON ---

    test("@api-validation malformed JSON on PUT config/wifi returns 400", async () => {
      const res = await api.fetch("/api/config/wifi", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        data: Buffer.from("{bad")
      });
      expect(res.status()).toBe(400);
    });

    // --- WiFi channel boundaries ---

    test("@api-validation WiFi channel boundaries", async () => {
      const configRes = await api.get("/api/config");
      const original = await configRes.json();

      try {
        // Invalid channels don't trigger restart
        const ch0 = await api.put("/api/config/wifi", { data: { wifiChannel: 0 } });
        expect(ch0.status(), "channel 0 should be rejected").toBe(400);

        const ch14 = await api.put("/api/config/wifi", { data: { wifiChannel: 14 } });
        expect(ch14.status(), "channel 14 should be rejected").toBe(400);

        // Valid channel changes trigger WiFi restart — wait for reconnection
        const ch1 = await api.put("/api/config/wifi", { data: { wifiChannel: 1 } });
        expect(ch1.ok(), "channel 1 should be accepted").toBeTruthy();
        await waitForApiStatus(api);

        const ch13 = await api.put("/api/config/wifi", { data: { wifiChannel: 13 } });
        expect(ch13.ok(), "channel 13 should be accepted").toBeTruthy();
        await waitForApiStatus(api);
      } finally {
        await api.put("/api/config/wifi", { data: { wifiChannel: original.wifiChannel } }).catch(() => {});
        await waitForApiStatus(api).catch(() => {});
      }
    });

    // --- WiFi password length ---

    test("@api-validation WiFi password too short returns 400", async () => {
      const res = await api.put("/api/config/wifi", { data: { apPassword: "short" } });
      expect(res.status()).toBe(400);
    });

    test("@api-validation WiFi password empty is accepted", async () => {
      try {
        const res = await api.put("/api/config/wifi", { data: { apPassword: "" } });
        expect(res.ok(), "empty password should be accepted").toBeTruthy();
        await waitForApiStatus(api);
      } finally {
        await api.put("/api/config/wifi", { data: { apPassword: "changeme123" } }).catch(() => {});
        await waitForApiStatus(api).catch(() => {});
      }
    });

    // --- Threshold boundaries ---

    test("@api-validation threshold boundaries", async () => {
      const configRes = await api.get("/api/config");
      const original = await configRes.json();

      try {
        const neg = await api.put("/api/config/time", { data: { startThreshold: -0.1 } });
        expect(neg.status(), "negative threshold should be rejected").toBe(400);

        const zero = await api.put("/api/config/time", {
          data: { startThreshold: 0.0, line2Threshold: 0.0, finishThreshold: 0.0 }
        });
        expect(zero.ok(), "0.0 threshold should be accepted").toBeTruthy();

        const two = await api.put("/api/config/time", {
          data: { startThreshold: 2.0, line2Threshold: 2.0, finishThreshold: 2.0 }
        });
        expect(two.ok(), "2.0 threshold should be accepted").toBeTruthy();

        const over = await api.put("/api/config/time", { data: { startThreshold: 2.01 } });
        expect(over.status(), "2.01 threshold should be rejected").toBe(400);
      } finally {
        await api.put("/api/config/time", {
          data: {
            startThreshold: original.startThreshold,
            line2Threshold: original.line2Threshold,
            finishThreshold: original.finishThreshold
          }
        }).catch(() => {});
      }
    });

    // --- MAC format validation ---
    // Note: successful PUT /api/config/mac triggers a device reboot

    test("@api-validation MAC format validation", async () => {
      const configRes = await api.get("/api/config");
      const original = await configRes.json();

      try {
        // Invalid MAC doesn't trigger reboot
        const bad = await api.put("/api/config/mac", { data: { peerMac: "bad" } });
        expect(bad.status(), "bad MAC should be rejected").toBe(400);

        // Valid empty MAC triggers reboot
        const empty = await api.put("/api/config/mac", { data: { peerMac: "" } });
        expect(empty.ok(), "empty MAC should be accepted").toBeTruthy();
        await waitForApiStatus(api);
      } finally {
        await waitForApiStatus(api).catch(() => {});
        await api.put("/api/config/mac", {
          data: { peerMac: original.peerMac, role: original.role, gateNumber: original.gateNumber }
        }).catch(() => {});
        await waitForApiStatus(api).catch(() => {});
      }
    });

    // --- Gate number boundaries ---

    test("@api-validation gate number boundaries", async () => {
      const configRes = await api.get("/api/config");
      const original = await configRes.json();

      try {
        // Invalid values don't trigger reboot
        const g0 = await api.put("/api/config/mac", { data: { gateNumber: 0 } });
        expect(g0.status(), "gateNumber 0 should be rejected").toBe(400);

        const g255 = await api.put("/api/config/mac", { data: { gateNumber: 255 } });
        expect(g255.status(), "gateNumber 255 should be rejected").toBe(400);

        // Valid values trigger reboot — test one valid value then restore
        const g254 = await api.put("/api/config/mac", { data: { gateNumber: 254 } });
        expect(g254.ok(), "gateNumber 254 should be accepted").toBeTruthy();
        await waitForApiStatus(api);
      } finally {
        await waitForApiStatus(api).catch(() => {});
        await api.put("/api/config/mac", {
          data: { gateNumber: original.gateNumber, peerMac: original.peerMac, role: original.role }
        }).catch(() => {});
        await waitForApiStatus(api).catch(() => {});
      }
    });

    // --- Rider validation ---

    test("@api-validation rider POST missing displayName returns 400", async () => {
      const res = await api.post("/api/riders", { data: { tagId: "test-missing-name" } });
      expect(res.status()).toBe(400);
    });

    test("@api-validation rider POST missing tagId returns 400", async () => {
      const res = await api.post("/api/riders", { data: { displayName: "No Tag" } });
      expect(res.status()).toBe(400);
    });

    test("@api-validation rider DELETE missing tagId returns 400", async () => {
      const res = await api.delete("/api/riders", { data: {} });
      expect(res.status()).toBe(400);
    });
  });
}
