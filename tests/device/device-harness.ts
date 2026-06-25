import { existsSync } from "node:fs";
import { request } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SerialPort } from "serialport";

const execFileAsync = promisify(execFile);

export type GateInfo = {
  port: string;
  deviceId?: string;
  role?: string;
  mac?: string;
  apSsid: string;  // always equals deviceId
  apPassword: string;
  apIp: string;
};

export type HarnessConfig = {
  ports: string[];
  baud: number;
  baseUrl: string;
  connectCommand?: string;
  serialTimeoutMs: number;
  connectTimeoutMs: number;
};

export function getHarnessConfig(): HarnessConfig {
  const ports = (process.env.MTB_GATE_SERIAL_PORTS ?? "/dev/ttyACM0,/dev/ttyACM1")
    .split(",")
    .map((port) => port.trim())
    .filter(Boolean);

  return {
    ports,
    baud: Number(process.env.MTB_GATE_BAUD ?? 115200),
    baseUrl: process.env.MTB_GATE_BASE_URL ?? "http://192.168.4.1",
    connectCommand: process.env.MTB_GATE_CONNECT_CMD,
    serialTimeoutMs: Number(process.env.MTB_GATE_SERIAL_TIMEOUT_MS ?? 15000),
    connectTimeoutMs: Number(process.env.MTB_GATE_CONNECT_TIMEOUT_MS ?? 30000)
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
      reject(new Error(`Timed out waiting for AP details from ${portPath}. Output:\n${output}`));
    }, config.serialTimeoutMs);

    port.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const parsed = parseGateInfo(output, portPath);
      if (parsed) {
        clearTimeout(timeout);
        resolve(parsed);
      }
    });
  });

  port.write("wifi\n");

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
      const line = lines.find((candidate) => candidate.startsWith("API "));
      if (!line) {
        return;
      }

      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line.slice(4)) as T);
      } catch (error) {
        reject(new Error(`Invalid console API JSON from ${portPath}: ${line}\n${String(error)}`));
      }
    });
  });

  port.write(`${command}\n`);

  try {
    const response = await done;
    if (process.env.MTB_GATE_VERBOSE_API === "1") {
      console.log(`[${portPath}] > ${command}`);
      console.log(`[${portPath}] < ${JSON.stringify(response)}`);
    }
    return response;
  } finally {
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }
}

export function parseGateInfo(output: string, port: string): GateInfo | undefined {
  const apSsid = matchLine(output, /AP SSID:\s*(.+)/i) ?? matchLine(output, /AP network\s+(.+?)\s+available at/i);
  const apPassword = matchLine(output, /AP Password:\s*(.+)/i);
  const apIp = matchLine(output, /AP IP:\s*(.+)/i) ?? matchLine(output, /available at http:\/\/([^\s]+)/i);
  const mac = matchLine(output, /MAC:\s*([0-9a-f:]{17})/i);

  if (!apSsid || !apPassword || !apIp) {
    return undefined;
  }

  const deviceMatch = output.match(/Device\s+([^\s]+)\s+\((.*?)\)\s+running as\s+(\w+)/i);
  return {
    port,
    deviceId: deviceMatch?.[1],
    role: deviceMatch?.[3],
    mac,
    apSsid,
    apPassword: apPassword === "<open>" ? "" : apPassword,
    apIp
  };
}

function matchLine(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match?.[1]?.trim();
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
