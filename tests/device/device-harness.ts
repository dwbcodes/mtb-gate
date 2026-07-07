import { existsSync } from "node:fs";
import { request } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SerialPort } from "serialport";
import {
  envFlag,
  envString,
  getDeviceTestConfig,
  requiredEnvString
} from "./test-config.ts";

const execFileAsync = promisify(execFile);

export type GateInfo = {
  port: string;
  deviceId?: string;
  role?: string;
  mac?: string;
  apSsid: string;  // always equals deviceId
  apPassword: string;
  apIp: string;
  staIp?: string;
  baseUrl: string;  // best reachable URL (STA IP if available, else AP IP)
};

export type HarnessConfig = {
  ports: string[];
  baud: number;
  baseUrl: string;
  connectCommand?: string;
  serialTimeoutMs: number;
  connectTimeoutMs: number;
};

export type GateRole = "start" | "finish" | "intermediate";

export type ExpectedGate = {
  mac: string;
  role: GateRole;
  gateNumber: number;
};

export type RestoreSecrets = Record<string, {
  apPassword: string;
  staPassword: string;
}>;

export type SerialLogEvent = {
  port: string;
  line: string;
  kind: "error" | "warning";
};

export type SerialLogWatcherOptions = {
  baud: number;
  errorPattern: RegExp;
  warningPattern: RegExp;
  ignorePattern?: RegExp;
};

export type TestAttachmentSink = {
  attach: (name: string, options: { body: string; contentType: string }) => Promise<void>;
};

export function getHarnessConfig(): HarnessConfig {
  const config = getDeviceTestConfig();
  return {
    ports: config.ports,
    baud: config.baud,
    baseUrl: config.baseUrl,
    connectCommand: config.connectCommand,
    serialTimeoutMs: config.serialTimeoutMs,
    connectTimeoutMs: config.connectTimeoutMs
  };
}

export async function assertRequiredPorts(config = getHarnessConfig()) {
  if (config.ports.length < 2) {
    throw new Error(`Expected at least two serial ports, got: ${config.ports.join(", ")}`);
  }

  const listedPorts = await SerialPort.list();
  const discovered = new Set(listedPorts.map((port) => port.path));
  const missing = config.ports.filter((port) => !existsSync(port) && !discovered.has(port));
  if (missing.length > 0) {
    throw new Error(`Hardware tests require all configured ESP32 ports before starting. Missing: ${missing.join(", ")}`);
  }
}

export async function readGateInfo(portPath: string, config = getHarnessConfig()): Promise<GateInfo> {
  const port = new SerialPort({ path: portPath, baudRate: config.baud, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));

  let output = "";
  const done = new Promise<GateInfo>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const parsed = parseGateInfo(output, portPath);
      if (parsed) { resolve(parsed); return; }
      reject(new Error(`Timed out waiting for AP details from ${portPath}. Output:\n${output}`));
    }, config.serialTimeoutMs);

    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    port.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const parsed = parseGateInfo(output, portPath);
      if (parsed) {
        clearTimeout(timeout);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          resolve(parseGateInfo(output, portPath)!);
        }, 500);
      }
    });
  });

  port.write("status\n");

  try {
    return await done;
  } finally {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

export async function requestConsoleApi<T = unknown>(portPath: string, command: string, config = getHarnessConfig()): Promise<T> {
  const port = new SerialPort({ path: portPath, baudRate: config.baud, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));

  let output = "";
  const done = new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for console API response from ${portPath} for "${command}". Output:\n${output}`));
    }, config.serialTimeoutMs);

    port.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const lines = output.split(/\r?\n/);
      if (!output.endsWith("\n") && !output.endsWith("\r")) {
        lines.pop();
      }
      // Match both old "API {...}" and new "[host] [API] {...}" formats
      const line = lines.find((candidate) => candidate.startsWith("API ") || candidate.includes("] [API] "));
      if (!line) {
        return;
      }

      clearTimeout(timeout);
      try {
        let jsonStr: string;
        const apiTagIdx = line.indexOf("] [API] ");
        if (apiTagIdx >= 0) {
          jsonStr = line.slice(apiTagIdx + 8);
        } else {
          jsonStr = line.slice(4);
        }
        resolve(JSON.parse(jsonStr) as T);
      } catch (error) {
        reject(new Error(`Invalid console API JSON from ${portPath}: ${line}\n${String(error)}`));
      }
    });
  });

  port.write(`${command}\n`);

  try {
    const response = await done;
    if (envFlag("MTB_GATE_VERBOSE_API")) {
      console.log(`[${portPath}] > ${command}`);
      console.log(`[${portPath}] < ${JSON.stringify(response)}`);
    }
    return response;
  } finally {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

export async function sendSerialCommand(portPath: string, command: string, config = getHarnessConfig()): Promise<string> {
  const port = new SerialPort({ path: portPath, baudRate: config.baud, autoOpen: false });
  await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));

  let output = "";
  const done = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(output);
    }, Math.min(config.serialTimeoutMs, 5000));

    port.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
  });

  port.write(`${command}\n`);

  try {
    return await done;
  } finally {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

export function parseGateInfo(output: string, port: string): GateInfo | undefined {
  const apSsid = matchLine(output, /AP SSID:\s*(.+)/i) ?? matchLine(output, /AP network\s+(.+?)\s+available at/i);
  const apPassword = matchLine(output, /AP Password:\s*(.+)/i);
  const apIp = matchLine(output, /AP IP:\s*(.+)/i) ?? matchLine(output, /available at http:\/\/([^\s]+)/i);
  const mac = matchLine(output, /MAC:\s*([0-9a-f:]{17})/i);
  const staIp = matchLine(output, /STA IP:\s*(\d+\.\d+\.\d+\.\d+)/i);

  if (!apSsid || !apPassword || !apIp) {
    return undefined;
  }

  const deviceMatch = output.match(/Device\s+([^\s]+)\s+\((.*?)\)\s+running as\s+(\w+)/i);
  const hasStaIp = staIp && staIp !== "0.0.0.0";
  return {
    port,
    deviceId: deviceMatch?.[1],
    role: deviceMatch?.[3],
    mac,
    apSsid,
    apPassword: apPassword === "<open>" ? "" : apPassword,
    apIp,
    staIp: hasStaIp ? staIp : undefined,
    baseUrl: hasStaIp ? `http://${staIp}` : `http://${apIp}`
  };
}

function matchLine(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1]?.trim();
}

let _discoveredGates: GateInfo[] | undefined;

export async function discoverGates(config = getHarnessConfig()): Promise<GateInfo[]> {
  if (_discoveredGates) {
    // Verify cached gates are still reachable; re-discover if not
    const allReachable = await Promise.all(
      _discoveredGates.map(async (g) => {
        try {
          const api = await request.newContext({ baseURL: g.baseUrl });
          const res = await api.get("/api/status", { timeout: 3000 });
          await api.dispose();
          return res.ok();
        } catch { return false; }
      })
    );
    if (allReachable.every(Boolean)) return _discoveredGates;
    _discoveredGates = undefined;
  }

  // Discover with retry — wait for STA IP to become available after reboots.
  // Devices may be mid-reboot; STA reconnection can take 5-15s after boot.
  const deadline = Date.now() + config.connectTimeoutMs;
  while (Date.now() < deadline) {
    const gates = await Promise.all(
      config.ports.map((p) => readGateInfo(p, config).catch(() => null))
    );
    if (gates.some((g) => g === null)) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const validGates = gates as GateInfo[];

    // If all gates have STA IPs, verify HTTP reachability
    const allHaveSta = validGates.every((g) => g.staIp);
    if (allHaveSta) {
      const reachable = await Promise.all(
        validGates.map(async (g) => {
          try {
            const api = await request.newContext({ baseURL: g.baseUrl });
            const res = await api.get("/api/status", { timeout: 5000 });
            await api.dispose();
            return res.ok();
          } catch { return false; }
        })
      );
      if (reachable.every(Boolean)) {
        _discoveredGates = validGates;
        return validGates;
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Fall back: return whatever we have but don't cache if unreachable
  // (so next call will re-discover instead of reusing stale AP IPs)
  const fallback = await Promise.all(config.ports.map((p) => readGateInfo(p, config)));
  const fallbackReachable = await Promise.all(
    fallback.map(async (g) => {
      try {
        const api = await request.newContext({ baseURL: g.baseUrl });
        const res = await api.get("/api/status", { timeout: 3000 });
        await api.dispose();
        return res.ok();
      } catch { return false; }
    })
  );
  if (fallbackReachable.every(Boolean)) {
    _discoveredGates = fallback;
  }
  return fallback;
}

export async function getGatesByRole(role: string, config = getHarnessConfig()): Promise<GateInfo[]> {
  const gates = await discoverGates(config);
  return gates.filter((g) => g.role === role);
}

export function resetDiscoveryCache() {
  _discoveredGates = undefined;
}

export async function connectToGateAp(gate: GateInfo, config = getHarnessConfig()) {
  if (!config.connectCommand) {
    return;
  }

  const rendered = config.connectCommand
    .replaceAll("{ssid}", gate.apSsid)
    .replaceAll("{password}", gate.apPassword)
    .replaceAll("{ip}", gate.apIp)
    .replaceAll("{port}", gate.port);

  await execFileAsync("/bin/sh", ["-lc", rendered], { timeout: config.connectTimeoutMs });
}

export async function waitForGateApi(config = getHarnessConfig()) {
  const api = await request.newContext({ baseURL: config.baseUrl });
  const deadline = Date.now() + config.connectTimeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await api.get("/api/status", { timeout: 3000 });
      if (response.ok()) {
        await api.dispose();
        return;
      }
      lastError = new Error(`HTTP ${response.status()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await api.dispose();
  throw new Error(`Gate API did not become reachable at ${config.baseUrl}: ${String(lastError)}`);
}

export async function waitForGateBaseUrl(baseUrl: string, timeoutMs = getHarnessConfig().connectTimeoutMs) {
  const api = await request.newContext({ baseURL: baseUrl });
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  while (Date.now() < deadline) {
    try {
      const response = await api.get("/api/status", { timeout: 3000 });
      if (response.ok()) {
        await api.dispose();
        return;
      }
      lastError = new Error(`HTTP ${response.status()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await api.dispose();
  throw new Error(`Gate API did not become reachable at ${baseUrl}: ${String(lastError)}`);
}

export function requireDestructiveMode() {
  if (!envFlag("MTB_GATE_DESTRUCTIVE")) {
    throw new Error("Destructive hardware tests require MTB_GATE_DESTRUCTIVE=1.");
  }
}

export function normalizeMac(mac: string): string {
  const compact = mac.trim().replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (compact.length !== 12) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  return compact.match(/.{1,2}/g)!.join(":");
}

export function parseExpectedTopology(): ExpectedGate[] {
  const startMac = requiredEnvString("MTB_GATE_START_MAC");
  const finishMac = requiredEnvString("MTB_GATE_FINISH_MAC");

  const expected: ExpectedGate[] = [
    { mac: normalizeMac(startMac), role: "start", gateNumber: 1 },
    { mac: normalizeMac(finishMac), role: "finish", gateNumber: 12 }
  ];

  const intermediateSpec = envString("MTB_GATE_INTERMEDIATE_MACS")?.trim();
  if (intermediateSpec) {
    for (const entry of intermediateSpec.split(",")) {
      const [gateNumberRaw, macRaw] = entry.split("=").map((part) => part.trim());
      const gateNumber = Number(gateNumberRaw);
      if (!Number.isInteger(gateNumber) || gateNumber < 2 || gateNumber > 11 || !macRaw) {
        throw new Error(`Invalid MTB_GATE_INTERMEDIATE_MACS entry "${entry}". Use 2=AA:BB:CC:DD:EE:FF.`);
      }
      expected.push({ mac: normalizeMac(macRaw), role: "intermediate", gateNumber });
    }
  }

  const duplicates = expected
    .map((gate) => gate.mac)
    .filter((mac, index, macs) => macs.indexOf(mac) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate MACs in expected topology: ${[...new Set(duplicates)].join(", ")}`);
  }

  return expected;
}

export function parseRestoreSecrets(expected: ExpectedGate[]): RestoreSecrets {
  const raw = requiredEnvString("MTB_GATE_RESTORE_SECRETS_JSON");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MTB_GATE_RESTORE_SECRETS_JSON is invalid JSON: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MTB_GATE_RESTORE_SECRETS_JSON must be an object keyed by MAC address.");
  }

  const normalized: RestoreSecrets = {};
  for (const [mac, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Restore secrets for ${mac} must be an object.`);
    }
    const secrets = value as Record<string, unknown>;
    if (typeof secrets.apPassword !== "string" || typeof secrets.staPassword !== "string") {
      throw new Error(`Restore secrets for ${mac} must include string apPassword and staPassword.`);
    }
    normalized[normalizeMac(mac)] = {
      apPassword: secrets.apPassword,
      staPassword: secrets.staPassword
    };
  }

  const missing = expected.filter((gate) => !normalized[gate.mac]).map((gate) => gate.mac);
  if (missing.length > 0) {
    throw new Error(`Missing restore secrets for MAC(s): ${missing.join(", ")}`);
  }

  return normalized;
}

export function matchExpectedGates(discovered: GateInfo[], expected: ExpectedGate[]) {
  const byMac = new Map(discovered.map((gate) => gate.mac ? [normalizeMac(gate.mac), gate] : undefined).filter(Boolean) as Array<[string, GateInfo]>);
  const missing = expected.filter((gate) => !byMac.has(gate.mac)).map((gate) => gate.mac);
  if (missing.length > 0) {
    const found = discovered.map((gate) => `${gate.port}:${gate.mac ?? "<unknown>"}`).join(", ");
    throw new Error(`Expected MAC(s) not found on configured serial ports: ${missing.join(", ")}. Found: ${found}`);
  }

  return expected.map((gate) => ({
    ...gate,
    info: byMac.get(gate.mac)!
  }));
}

export function serialLogWatcherOptions(config = getHarnessConfig()): SerialLogWatcherOptions {
  const errorPattern = envString("MTB_GATE_SERIAL_ERROR_PATTERN") || String.raw`(?:\bERROR\b|\bFAIL(?:ED|URE)?\b|panic|abort|assert|Guru Meditation|Backtrace|Brownout)`;
  const warningPattern = envString("MTB_GATE_SERIAL_WARNING_PATTERN") || String.raw`\bWARN(?:ING)?\b`;
  const ignorePattern = envString("MTB_GATE_SERIAL_IGNORE_PATTERN");
  return {
    baud: config.baud,
    errorPattern: new RegExp(errorPattern, "i"),
    warningPattern: new RegExp(warningPattern, "i"),
    ignorePattern: ignorePattern ? new RegExp(ignorePattern, "i") : undefined
  };
}

export async function waitForApiStatus(api: APIRequestContext, timeoutMs = getHarnessConfig().connectTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  while (Date.now() < deadline) {
    try {
      const res = await api.get("/api/status", { timeout: 3000 });
      if (res.ok()) return;
      lastError = new Error(`HTTP ${res.status()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Gate API did not become reachable through existing request context: ${String(lastError)}`);
}

export class SerialLogWatcher {
  private ports = new Map<string, SerialPort>();
  private buffers = new Map<string, string>();
  private stopped = false;
  private events: SerialLogEvent[] = [];

  constructor(
    private readonly portPaths: string[],
    private readonly options: SerialLogWatcherOptions
  ) {}

  async start() {
    await Promise.all(this.portPaths.map((portPath) => this.openPort(portPath)));
  }

  async stop() {
    this.stopped = true;
    await Promise.all([...this.ports.values()].map((port) => new Promise<void>((resolve) => {
      if (!port.isOpen) {
        resolve();
        return;
      }
      port.close(() => resolve());
    })));
    this.ports.clear();
  }

  assertNoErrors() {
    const errors = this.events.filter((event) => event.kind === "error");
    if (errors.length > 0) {
      throw new Error(`Serial error output detected:\n${errors.map((event) => `[${event.port}] ${event.line}`).join("\n")}`);
    }
    if (envFlag("MTB_GATE_FAIL_ON_SERIAL_WARNINGS")) {
      const warnings = this.events.filter((event) => event.kind === "warning");
      if (warnings.length > 0) {
        throw new Error(`Serial warning output detected:\n${warnings.map((event) => `[${event.port}] ${event.line}`).join("\n")}`);
      }
    }
  }

  text() {
    return this.portPaths.map((port) => {
      const content = this.buffers.get(port) ?? "";
      return `--- ${port} ---\n${content.trimEnd()}`;
    }).join("\n");
  }

  eventText() {
    return this.events.map((event) => `[${event.kind.toUpperCase()}] [${event.port}] ${event.line}`).join("\n");
  }

  private async openPort(portPath: string) {
    if (this.stopped) return;
    const port = new SerialPort({ path: portPath, baudRate: this.options.baud, autoOpen: false });
    this.ports.set(portPath, port);

    port.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.buffers.set(portPath, (this.buffers.get(portPath) ?? "") + text);
      this.recordEvents(portPath, text);
    });

    port.on("close", () => {
      this.ports.delete(portPath);
      if (!this.stopped) {
        setTimeout(() => void this.openPort(portPath), 1000);
      }
    });

    port.on("error", (error) => {
      this.events.push({ port: portPath, kind: "error", line: `Serial port error: ${String(error)}` });
    });

    await new Promise<void>((resolve, reject) => {
      port.open((error) => error ? reject(error) : resolve());
    });
  }

  private recordEvents(portPath: string, text: string) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (this.options.ignorePattern?.test(line)) continue;
      if (this.options.errorPattern.test(line)) {
        this.events.push({ port: portPath, kind: "error", line });
      } else if (this.options.warningPattern.test(line)) {
        this.events.push({ port: portPath, kind: "warning", line });
      }
    }
  }
}

export async function attachSerialLogs(testInfo: TestAttachmentSink, watcher: SerialLogWatcher) {
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
