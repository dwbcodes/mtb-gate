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
  test.describe(`@api-integration ${port}`, () => {
    let api: Awaited<ReturnType<typeof request.newContext>>;
    let gate: GateInfo;

    test.beforeAll(async () => {
      const gates = await discoverGates();
      gate = gates.find((g) => g.port === port)!;
      api = await request.newContext({ baseURL: gate.baseUrl });
      await waitForApiStatus(api, 30000);
    });

    test.afterAll(async () => {
      await api?.dispose();
    });

    test("@api-integration rider upsert updates displayName", async () => {
      const tagId = `upsert-${Date.now()}-${port.replace(/\W/g, "")}`;

      try {
        const create = await api.post("/api/riders", {
          data: { tagId, displayName: "Original Name" }
        });
        expect(create.ok()).toBeTruthy();

        const upsert = await api.post("/api/riders", {
          data: { tagId, displayName: "Updated Name" }
        });
        expect(upsert.ok()).toBeTruthy();

        const riders = await (await api.get("/api/riders")).json();
        const matches = riders.filter((r: any) => r.tagId === tagId);
        expect(matches).toHaveLength(1);
        expect(matches[0].displayName).toBe("Updated Name");
      } finally {
        await api.delete("/api/riders", { data: { tagId } }).catch(() => {});
      }
    });

    test("@api-integration multi-rider lifecycle", async () => {
      const prefix = `multi-${Date.now()}-${port.replace(/\W/g, "")}`;
      const tags = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`];

      try {
        for (const [i, tagId] of tags.entries()) {
          const res = await api.post("/api/riders", {
            data: { tagId, displayName: `Rider ${i + 1}` }
          });
          expect(res.ok(), `rider ${tagId} should register`).toBeTruthy();
        }

        const riders = await (await api.get("/api/riders")).json();
        const ours = riders.filter((r: any) => r.tagId.startsWith(prefix));
        expect(ours).toHaveLength(3);

        const del = await api.delete("/api/riders", { data: { tagId: tags[1] } });
        expect(del.ok()).toBeTruthy();

        const after = await (await api.get("/api/riders")).json();
        const remaining = after.filter((r: any) => r.tagId.startsWith(prefix));
        expect(remaining).toHaveLength(2);
        expect(remaining.some((r: any) => r.tagId === tags[1])).toBe(false);
      } finally {
        for (const tagId of tags) {
          await api.delete("/api/riders", { data: { tagId } }).catch(() => {});
        }
      }
    });

    test("@api-integration threshold reflects in config after PUT", async () => {
      const configRes = await api.get("/api/config");
      const original = await configRes.json();

      try {
        const newThresholds = { startThreshold: 1.23, line2Threshold: 0.45, finishThreshold: 0.67 };
        const put = await api.put("/api/config/time", { data: newThresholds });
        expect(put.ok()).toBeTruthy();

        const updated = await (await api.get("/api/config")).json();
        expect(updated.startThreshold).toBeCloseTo(1.23, 2);
        expect(updated.line2Threshold).toBeCloseTo(0.45, 2);
        expect(updated.finishThreshold).toBeCloseTo(0.67, 2);
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

    test("@api-integration riderId format is rider-<tagId>", async () => {
      const tagId = `ridfmt-${Date.now()}-${port.replace(/\W/g, "")}`;

      try {
        await api.post("/api/riders", { data: { tagId, displayName: "Format Test" } });

        const riders = await (await api.get("/api/riders")).json();
        const match = riders.find((r: any) => r.tagId === tagId);
        expect(match).toBeDefined();
        expect(match.riderId).toBe(`rider-${tagId}`);
      } finally {
        await api.delete("/api/riders", { data: { tagId } }).catch(() => {});
      }
    });

    test("@api-integration status response shape contract", async () => {
      const res = await api.get("/api/status");
      expect(res.ok()).toBeTruthy();
      const status = await res.json();

      expect(status).toEqual(expect.objectContaining({
        deviceId: expect.any(String),
        role: expect.stringMatching(/^(start|finish|intermediate)$/),
        mac: expect.stringMatching(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i),
        uptimeMs: expect.any(Number),
        apSsid: expect.any(String),
        apIp: expect.any(String),
        espNow: expect.objectContaining({
          connected: expect.any(Boolean),
          peerMac: expect.any(String)
        })
      }));

      expect(Array.isArray(status.queue)).toBe(true);
      expect(status.apSsid).toBe(status.deviceId);

      // Role-specific: verify role matches gate number convention
      if (gate.role === "start") {
        expect(status.role).toBe("start");
      } else if (gate.role === "finish") {
        expect(status.role).toBe("finish");
      }
    });

    test("@api-integration config response shape contract", async () => {
      const res = await api.get("/api/config");
      expect(res.ok()).toBeTruthy();
      const config = await res.json();

      expect(config).toEqual(expect.objectContaining({
        deviceId: expect.any(String),
        gateNumber: expect.any(Number),
        role: expect.stringMatching(/^(start|finish|intermediate)$/),
        apPassword: "***",
        staPassword: "***",
        wifiChannel: expect.any(Number),
        peerMac: expect.any(String),
        startThreshold: expect.any(Number),
        line2Threshold: expect.any(Number),
        finishThreshold: expect.any(Number)
      }));

      // Role-specific: start gate = gateNumber 1, finish gate = gateNumber 12
      if (gate.role === "start") {
        expect(config.gateNumber).toBe(1);
      } else if (gate.role === "finish") {
        expect(config.gateNumber).toBe(12);
      }
    });

    test("@api-integration ping response shape", async () => {
      const res = await api.post("/api/ping");
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body).toEqual({ ok: true, sent: false });
    });
  });
}
