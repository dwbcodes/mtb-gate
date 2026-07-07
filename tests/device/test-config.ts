import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULTS = {
  MTB_GATE_SERIAL_PORTS: "/dev/ttyACM0,/dev/ttyACM1",
  MTB_GATE_BAUD: "115200",
  MTB_GATE_BASE_URL: "http://192.168.4.1",
  MTB_GATE_SERIAL_TIMEOUT_MS: "15000",
  MTB_GATE_CONNECT_TIMEOUT_MS: "60000",
  MTB_GATE_TEST_TIMEOUT_MS: "120000",
  MTB_GATE_EXPECT_TIMEOUT_MS: "10000",
  MTB_GATE_SYNC_TIMEOUT_MS: "70000",
  MTB_GATE_ESPNOW_TIMEOUT_MS: "70000"
} as const;

let envLoaded = false;

export function loadDeviceTestEnv(envPath = resolve(process.cwd(), ".env")) {
  if (envLoaded) return;
  envLoaded = true;
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

export function envString(name: string, fallback?: string): string | undefined {
  loadDeviceTestEnv();
  return process.env[name] ?? fallback;
}

export function requiredEnvString(name: string): string {
  const value = envString(name);
  if (!value) {
    throw new Error(`Missing required test configuration: ${name}`);
  }
  return value;
}

export function envNumber(name: string, fallback: number): number {
  const value = envString(name);
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric test configuration ${name}: ${value}`);
  }
  return parsed;
}

export function envFlag(name: string): boolean {
  return envString(name) === "1";
}

export function envCsv(name: string, fallback: string): string[] {
  return (envString(name, fallback) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getDeviceTestConfig() {
  return {
    ports: envCsv("MTB_GATE_SERIAL_PORTS", DEFAULTS.MTB_GATE_SERIAL_PORTS),
    baud: envNumber("MTB_GATE_BAUD", Number(DEFAULTS.MTB_GATE_BAUD)),
    baseUrl: envString("MTB_GATE_BASE_URL", DEFAULTS.MTB_GATE_BASE_URL)!,
    connectCommand: envString("MTB_GATE_CONNECT_CMD"),
    serialTimeoutMs: envNumber("MTB_GATE_SERIAL_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_SERIAL_TIMEOUT_MS)),
    connectTimeoutMs: envNumber("MTB_GATE_CONNECT_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_CONNECT_TIMEOUT_MS)),
    testTimeoutMs: envNumber("MTB_GATE_TEST_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_TEST_TIMEOUT_MS)),
    expectTimeoutMs: envNumber("MTB_GATE_EXPECT_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_EXPECT_TIMEOUT_MS)),
    syncTimeoutMs: envNumber("MTB_GATE_SYNC_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_SYNC_TIMEOUT_MS)),
    espNowTimeoutMs: envNumber("MTB_GATE_ESPNOW_TIMEOUT_MS", Number(DEFAULTS.MTB_GATE_ESPNOW_TIMEOUT_MS))
  };
}

function parseEnvValue(rawValue: string) {
  let value = rawValue.trim();
  const commentIndex = findUnquotedHash(value);
  if (commentIndex >= 0) {
    value = value.slice(0, commentIndex).trim();
  }

  if ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    const quote = value[0];
    value = value.slice(1, -1);
    if (quote === "\"") {
      value = value
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\r")
        .replaceAll("\\t", "\t")
        .replaceAll("\\\"", "\"")
        .replaceAll("\\\\", "\\");
    }
  }

  return value;
}

function findUnquotedHash(value: string) {
  let quote: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if ((char === "\"" || char === "'") && value[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
      continue;
    }
    if (char === "#" && !quote) return i;
  }
  return -1;
}

loadDeviceTestEnv();
