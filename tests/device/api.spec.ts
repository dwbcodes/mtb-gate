import { expect, request, test } from "@playwright/test";
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
  test(`@api ${port} exposes AP-hosted status/config/riders APIs`, async () => {
    const config = getHarnessConfig();
    const gate = await readGateInfo(port, config);
    await connectToGateAp(gate, config);
    await waitForGateApi(config);

    const api = await request.newContext({ baseURL: config.baseUrl });
    const statusResponse = await api.get("/api/status");
    expect(statusResponse.ok()).toBeTruthy();
    const status = await statusResponse.json();

    expect(status.deviceId).toBeTruthy();
    expect(status.apSsid).toBe(status.deviceId);
    expect(status.apIp).toBe(gate.apIp);
    expect(status.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    expect(status.uptimeMs).toEqual(expect.any(Number));
    expect(status.espNow).toEqual(expect.objectContaining({
      connected: expect.any(Boolean),
      peerMac: expect.any(String)
    }));
    expect(status.staSsid ?? "").toBe("");
    expect(status.staIp).toBe("0.0.0.0");

    const configResponse = await api.get("/api/config");
    expect(configResponse.ok()).toBeTruthy();
    const deviceConfig = await configResponse.json();
    expect(deviceConfig.apPassword).toBe("***");
    expect(deviceConfig.staPassword).toBe("***");

    const originalThresholds = {
      startThreshold: deviceConfig.startThreshold,
      line2Threshold: deviceConfig.line2Threshold,
      finishThreshold: deviceConfig.finishThreshold
    };
    let tagId: string | undefined;

    try {
      const validThresholdResponse = await api.put("/api/config/time", {
        data: { startThreshold: 0.82, line2Threshold: 0.83, finishThreshold: 0.84 }
      });
      expect(validThresholdResponse.ok()).toBeTruthy();

      const invalidThresholdResponse = await api.put("/api/config/time", {
        data: { startThreshold: 2.5 }
      });
      expect(invalidThresholdResponse.status()).toBe(400);

      tagId = `test-${Date.now()}-${port.replace(/\W/g, "")}`;
      const riderResponse = await api.post("/api/riders", {
        data: { tagId, displayName: "Hardware Test Rider" }
      });
      expect(riderResponse.ok()).toBeTruthy();

      const ridersAfterCreate = await (await api.get("/api/riders")).json();
      expect(ridersAfterCreate).toEqual(expect.arrayContaining([
        expect.objectContaining({ tagId, displayName: "Hardware Test Rider" })
      ]));

      const deleteResponse = await api.delete("/api/riders", { data: { tagId } });
      expect(deleteResponse.ok()).toBeTruthy();
      const deletedTagId = tagId;
      tagId = undefined;

      const ridersAfterDelete = await (await api.get("/api/riders")).json();
      expect(ridersAfterDelete.some((rider: { tagId: string }) => rider.tagId === deletedTagId)).toBe(false);
    } finally {
      if (tagId) {
        await api.delete("/api/riders", { data: { tagId } }).catch(() => undefined);
      }
      await api.put("/api/config/time", { data: originalThresholds }).catch(() => undefined);
      await api.dispose();
    }
  });
}
