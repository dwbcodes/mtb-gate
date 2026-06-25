import { expect, test } from "@playwright/test";
import {
  assertRequiredPorts,
  getHarnessConfig,
  requestConsoleApi
} from "./device-harness.ts";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertRequiredPorts();
});

for (const port of getHarnessConfig().ports) {
  test(`@console ${port} exposes all non-destructive APIs through console API`, async () => {
    await deleteConsoleTestRiders(port);

    const status = await requestConsoleApi<any>(port, "api status");
    expect(status.deviceId).toBeTruthy();
    expect(status.role).toMatch(/^(start|finish|intermediate)$/);
    expect(status.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    expect(status.uptimeMs).toEqual(expect.any(Number));
    expect(status.espNow).toEqual(expect.objectContaining({
      connected: expect.any(Boolean),
      peerMac: expect.any(String)
    }));

    const config = await requestConsoleApi<any>(port, "api config");
    expect(config.deviceId).toBe(status.deviceId);
    expect(config.apPassword).toBe("***");
    expect(config.staPassword).toBe("***");

    const originalThresholds = {
      startThreshold: config.startThreshold,
      line2Threshold: config.line2Threshold,
      finishThreshold: config.finishThreshold
    };
    const originalWifi = {
      staSsid: config.staSsid,
      wifiChannel: config.wifiChannel
    };
    const originalMac = {
      peerMac: config.peerMac,
      role: config.role,
      deviceLabel: config.deviceLabel
    };
    let tagId: string | undefined;

    try {
      const wifiOk = await requestConsoleApi<any>(
        port,
        `api config/wifi ${JSON.stringify({ wifiChannel: 6 })}`
      );
      expect(wifiOk.ok).toBe(true);

      const invalidWifi = await requestConsoleApi<any>(port, 'api config/wifi {"wifiChannel":99}');
      expect(invalidWifi.error).toMatch(/wifiChannel/);

      const timeOk = await requestConsoleApi<any>(
        port,
        'api config/time {"startThreshold":0.81,"line2Threshold":0.82,"finishThreshold":0.83}'
      );
      expect(timeOk.ok).toBe(true);

      const invalidTime = await requestConsoleApi<any>(port, 'api config/time {"startThreshold":2.5}');
      expect(invalidTime.error).toMatch(/Thresholds/);

      const macOk = await requestConsoleApi<any>(
        port,
        `api config/mac ${JSON.stringify({
          peerMac: "11:22:33:44:55:66",
          role: status.role,
          deviceLabel: `Console Tested ${status.deviceId}`
        })}`
      );
      expect(macOk.ok).toBe(true);

      const invalidMac = await requestConsoleApi<any>(port, 'api config/mac {"peerMac":"bad"}');
      expect(invalidMac.error).toMatch(/peerMac/);

      const configAfterUpdates = await requestConsoleApi<any>(port, "api config");
      expect(configAfterUpdates.wifiChannel).toBe(6);
      expect(configAfterUpdates.startThreshold).toBeCloseTo(0.81, 2);
      expect(configAfterUpdates.line2Threshold).toBeCloseTo(0.82, 2);
      expect(configAfterUpdates.finishThreshold).toBeCloseTo(0.83, 2);
      expect(configAfterUpdates.peerMac).toBe("11:22:33:44:55:66");
      expect(configAfterUpdates.deviceLabel).toBe(`Console Tested ${status.deviceId}`);

      tagId = `console-test-${Date.now()}-${port.replace(/\W/g, "")}`;
      const riderOk = await requestConsoleApi<any>(
        port,
        `api riders/add {"tagId":"${tagId}","displayName":"Console Test Rider"}`
      );
      expect(riderOk.ok).toBe(true);

      const riders = await requestConsoleApi<any[]>(port, "api riders");
      expect(riders).toEqual(expect.arrayContaining([
        expect.objectContaining({ tagId, displayName: "Console Test Rider" })
      ]));

      const deleteOk = await requestConsoleApi<any>(port, `api riders/delete {"tagId":"${tagId}"}`);
      expect(deleteOk.ok).toBe(true);
      const deletedTagId = tagId;
      tagId = undefined;

      const ridersAfterDelete = await requestConsoleApi<any[]>(port, "api riders");
      expect(ridersAfterDelete.some((rider) => rider.tagId === deletedTagId)).toBe(false);

      const ping = await requestConsoleApi<any>(port, "api ping");
      expect(ping).toEqual(expect.objectContaining({ ok: true, sent: false }));
    } finally {
      if (tagId) {
        await requestConsoleApi(port, `api riders/delete {"tagId":"${tagId}"}`).catch(() => undefined);
      }
      await deleteConsoleTestRiders(port).catch(() => undefined);
      await requestConsoleApi(
        port,
        `api config/time ${JSON.stringify(originalThresholds)}`
      ).catch(() => undefined);
      await requestConsoleApi(
        port,
        `api config/wifi ${JSON.stringify(originalWifi)}`
      ).catch(() => undefined);
      await requestConsoleApi(
        port,
        `api config/mac ${JSON.stringify(originalMac)}`
      ).catch(() => undefined);
    }
  });
}

async function deleteConsoleTestRiders(port: string) {
  const riders = await requestConsoleApi<Array<{ tagId: string }>>(port, "api riders");
  for (const rider of riders) {
    if (rider.tagId.startsWith("console-test-")) {
      await requestConsoleApi(port, `api riders/delete ${JSON.stringify({ tagId: rider.tagId })}`);
    }
  }
}
