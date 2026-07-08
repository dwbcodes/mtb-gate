import { expect, test } from "@playwright/test";
import {
  assertRequiredPorts,
  discoverGates,
  getHarnessConfig,
  requestConsoleApi,
  sendSerialCommand
} from "./device-harness.ts";

// Wait for device to finish booting and any NFC-triggered countdown
async function waitForSerialReady(port: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await requestConsoleApi<any>(port, "api status");
      if (result?.deviceId) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertRequiredPorts();
});

for (const port of getHarnessConfig().ports) {
  test(`@console ${port} exposes all non-destructive APIs through console API`, async () => {
    await waitForSerialReady(port);
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
      triggerDelta: config.triggerDelta,
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
        'api config/time {"triggerDelta":0.24}'
      );
      expect(timeOk.ok).toBe(true);

      const invalidTime = await requestConsoleApi<any>(port, 'api config/time {"triggerDelta":2.5}');
      expect(invalidTime.error).toMatch(/triggerDelta/);

      // MAC config changes trigger device reboot — wait for it to come back
      const macOk = await requestConsoleApi<any>(
        port,
        `api config/mac ${JSON.stringify({
          peerMac: "11:22:33:44:55:66",
          role: status.role,
          deviceLabel: `Console Tested ${status.deviceId}`
        })}`
      );
      expect(macOk.ok).toBe(true);
      await waitForSerialReady(port);

      const invalidMac = await requestConsoleApi<any>(port, 'api config/mac {"peerMac":"bad"}');
      expect(invalidMac.error).toMatch(/peerMac/);

      const configAfterUpdates = await requestConsoleApi<any>(port, "api config");
      expect(configAfterUpdates.wifiChannel).toBe(6);
      expect(configAfterUpdates.triggerDelta).toBeCloseTo(0.24, 2);
      // On finish gates, auto-discovery may overwrite peerMac after reboot
      if (status.role === "start") {
        expect(configAfterUpdates.peerMac).toBe("11:22:33:44:55:66");
      }
      // deviceLabel is now derived from gateNumber, not user-settable
      expect(configAfterUpdates.deviceLabel).toBeTruthy();

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
      // MAC restore triggers another reboot — wait for it
      await requestConsoleApi(
        port,
        `api config/mac ${JSON.stringify(originalMac)}`
      ).catch(() => undefined);
      await waitForSerialReady(port).catch(() => undefined);
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
