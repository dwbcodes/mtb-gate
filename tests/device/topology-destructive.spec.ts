import { expect, request, test, type APIRequestContext } from "@playwright/test";
import {
  assertRequiredPorts,
  discoverGates,
  matchExpectedGates,
  parseExpectedTopology,
  parseRestoreSecrets,
  requireDestructiveMode,
  resetDiscoveryCache,
  serialLogWatcherOptions,
  SerialLogWatcher,
  waitForGateBaseUrl,
  type ExpectedGate,
  type GateInfo,
  type RestoreSecrets
} from "./device-harness.ts";
import { envFlag, envNumber, getDeviceTestConfig } from "./test-config.ts";

type MatchedGate = ExpectedGate & { info: GateInfo };

type BackedUpGate = MatchedGate & {
  config: Record<string, any>;
  riders: Array<Record<string, any>>;
  api: APIRequestContext;
};

test.describe.configure({ mode: "serial" });

test.describe("@destructive multi-gate topology", () => {
  test.skip(!envFlag("MTB_GATE_DESTRUCTIVE"), "Set MTB_GATE_DESTRUCTIVE=1 to run destructive hardware topology tests.");

  let matched: MatchedGate[] = [];
  let backups: BackedUpGate[] = [];
  let restoreSecrets: RestoreSecrets;
  let watcher: SerialLogWatcher | undefined;

  test.beforeAll(async () => {
    requireDestructiveMode();
    await assertRequiredPorts();

    const expected = parseExpectedTopology();
    restoreSecrets = parseRestoreSecrets(expected);
    const discovered = await discoverGates();
    matched = matchExpectedGates(discovered, expected);

    backups = await Promise.all(matched.map(async (gate) => {
      const api = await request.newContext({ baseURL: gate.info.baseUrl });
      const status = await api.get("/api/status", { timeout: 5000 });
      expect(status.ok(), `${gate.mac} at ${gate.info.baseUrl} must be reachable before destructive mutation`).toBeTruthy();

      const config = await (await api.get("/api/config")).json();
      const riders = await (await api.get("/api/riders")).json();
      return { ...gate, config, riders, api };
    }));
  });

  test.afterAll(async () => {
    if (watcher) {
      await watcher.stop();
    }

    await Promise.all(backups.map(async (gate) => {
      await restoreGate(gate, restoreSecrets[gate.mac]).catch((error) => {
        console.error(`[${gate.info.port}] restore failed for ${gate.mac}: ${String(error)}`);
      });
      await gate.api.dispose();
    }));
  });

  test("@destructive configures MAC topology and syncs start-gate rider changes", async ({}, testInfo) => {
    const startGate = backups.find((gate) => gate.role === "start");
    const nonStartGates = backups.filter((gate) => gate.role !== "start");
    if (!startGate) throw new Error("Expected one start gate in topology.");
    if (nonStartGates.length === 0) throw new Error("Expected at least one non-start gate in topology.");

    await configureTopology(backups);
    await resetReachability(backups);

    watcher = new SerialLogWatcher(
      backups.map((gate) => gate.info.port),
      serialLogWatcherOptions()
    );
    await watcher.start();

    await expectTopology(backups);
    await expectEspNowLink(startGate, nonStartGates);

    const tagId = `destructive-sync-${Date.now()}`;
    try {
      const create = await startGate.api.post("/api/riders", {
        data: { tagId, displayName: "Destructive Sync Rider" }
      });
      expect(create.ok(), "start gate should accept test rider").toBeTruthy();

      for (const gate of nonStartGates) {
        await expect.poll(async () => hasRider(gate.api, tagId), {
          timeout: getDeviceTestConfig().syncTimeoutMs,
          message: `${gate.mac} should receive rider sync from start gate`
        }).toBe(true);
      }

      const remove = await startGate.api.delete("/api/riders", { data: { tagId } });
      expect(remove.ok(), "start gate should remove test rider").toBeTruthy();

      for (const gate of nonStartGates) {
        await expect.poll(async () => hasRider(gate.api, tagId), {
          timeout: getDeviceTestConfig().syncTimeoutMs,
          message: `${gate.mac} should receive rider removal from start gate`
        }).toBe(false);
      }

      watcher.assertNoErrors();
    } finally {
      await startGate.api.delete("/api/riders", { data: { tagId } }).catch(() => undefined);
      if (watcher) {
        await attachSerialLogs(testInfo, watcher);
        watcher.assertNoErrors();
      }
    }
  });
});

async function configureTopology(gates: BackedUpGate[]) {
  const startGate = gates.find((gate) => gate.role === "start");
  if (!startGate) throw new Error("Cannot configure topology without a start gate.");

  const finishGate = gates.find((gate) => gate.role === "finish");
  const testWifiChannel = envNumber("MTB_GATE_TEST_WIFI_CHANNEL", startGate.config.wifiChannel ?? 6);

  for (const gate of gates) {
    const peerMac = gate.role === "start" ? (finishGate?.mac ?? "") : startGate.mac;
    const response = await gate.api.put("/api/config/mac", {
      data: {
        role: gate.role,
        gateNumber: gate.gateNumber,
        peerMac,
        deviceLabel: `HW Test ${gate.role} ${gate.gateNumber}`
      }
    });
    expect(response.ok(), `${gate.mac} should accept topology config`).toBeTruthy();
  }

  for (const gate of gates) {
    await waitForGateBaseUrl(gate.info.baseUrl);
  }

  for (const gate of gates) {
    const response = await gate.api.put("/api/config/wifi", {
      data: {
        apPassword: `testpass${gate.gateNumber}`,
        wifiChannel: testWifiChannel
      }
    });
    expect(response.ok(), `${gate.mac} should accept destructive Wi-Fi test config`).toBeTruthy();
  }

  for (const gate of gates) {
    await waitForGateBaseUrl(gate.info.baseUrl);
  }
}

async function resetReachability(gates: BackedUpGate[]) {
  resetDiscoveryCache();
  for (const gate of gates) {
    await waitForGateBaseUrl(gate.info.baseUrl);
  }
}

async function expectTopology(gates: BackedUpGate[]) {
  for (const gate of gates) {
    const config = await (await gate.api.get("/api/config")).json();
    const status = await (await gate.api.get("/api/status")).json();

    expect(config.role, `${gate.mac} config role`).toBe(gate.role);
    expect(config.gateNumber, `${gate.mac} gate number`).toBe(gate.gateNumber);
    expect(status.role, `${gate.mac} status role`).toBe(gate.role);
    expect(status.mac.toLowerCase(), `${gate.mac} status MAC`).toBe(gate.mac);
  }
}

async function expectEspNowLink(startGate: BackedUpGate, nonStartGates: BackedUpGate[]) {
  const finishGate = nonStartGates.find((gate) => gate.role === "finish");

  await expect.poll(async () => {
    const status = await (await startGate.api.get("/api/status")).json();
    return status.espNow?.peerMac?.toLowerCase();
  }, {
    timeout: getDeviceTestConfig().espNowTimeoutMs,
    message: "start gate should report the configured finish gate peer MAC"
  }).toBe(finishGate?.mac ?? "");

  for (const gate of nonStartGates) {
    await expect.poll(async () => {
      const status = await (await gate.api.get("/api/status")).json();
      return status.espNow?.peerMac?.toLowerCase();
    }, {
      timeout: getDeviceTestConfig().espNowTimeoutMs,
      message: `${gate.mac} should discover start gate peer MAC`
    }).toBe(startGate.mac);
  }
}

async function hasRider(api: APIRequestContext, tagId: string) {
  const riders = await (await api.get("/api/riders")).json();
  return riders.some((rider: { tagId: string }) => rider.tagId === tagId);
}

async function restoreGate(gate: BackedUpGate, secrets: { apPassword: string; staPassword: string }) {
  await waitForGateBaseUrl(gate.info.baseUrl).catch(() => undefined);

  await gate.api.put("/api/config/time", {
    data: {
      triggerDelta: gate.config.triggerDelta,
      startThreshold: gate.config.startThreshold,
      line2Threshold: gate.config.line2Threshold,
      finishThreshold: gate.config.finishThreshold
    }
  }).catch(() => undefined);

  await gate.api.put("/api/config/wifi", {
    data: {
      apPassword: secrets.apPassword,
      staSsid: gate.config.staSsid,
      staPassword: secrets.staPassword,
      wifiChannel: gate.config.wifiChannel
    }
  }).catch(() => undefined);
  await waitForGateBaseUrl(gate.info.baseUrl).catch(() => undefined);

  await gate.api.put("/api/config/mac", {
    data: {
      peerMac: gate.config.peerMac,
      role: gate.config.role,
      gateNumber: gate.config.gateNumber,
      deviceLabel: gate.config.deviceLabel
    }
  }).catch(() => undefined);
  await waitForGateBaseUrl(gate.info.baseUrl).catch(() => undefined);

  const currentRiders = await gate.api.get("/api/riders").then((response) => response.json()).catch(() => []);
  for (const rider of currentRiders) {
    if (!gate.riders.some((saved) => saved.tagId === rider.tagId)) {
      await gate.api.delete("/api/riders", { data: { tagId: rider.tagId } }).catch(() => undefined);
    }
  }

  for (const rider of gate.riders) {
    await gate.api.post("/api/riders", {
      data: { tagId: rider.tagId, displayName: rider.displayName }
    }).catch(() => undefined);
  }
}

async function attachSerialLogs(testInfo: { attach: (name: string, options: { body: string; contentType: string }) => Promise<void> }, watcher: SerialLogWatcher) {
  await testInfo.attach("serial-output", {
    body: watcher.text(),
    contentType: "text/plain"
  });
  const events = watcher.eventText();
  if (events) {
    await testInfo.attach("serial-events", {
      body: events,
      contentType: "text/plain"
    });
  }
}
