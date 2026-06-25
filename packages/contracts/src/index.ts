export type RiderId = string;
export type TagId = string;
export type RunId = string;
export type DeviceId = string;
export type GateRole = "start" | "finish";
export type RunStatus = "queued" | "countdown" | "awaiting-start" | "on-course" | "finished" | "timed-out";
export type GateEventType = "nfc-scan" | "countdown-start" | "countdown-go" | "start-trigger" | "line2-trigger" | "finish-trigger" | "timeout";

export interface Rider {
  riderId: RiderId;
  displayName: string;
  tagId: TagId;
}

export interface GateEvent {
  runId: RunId;
  gateRole: GateRole;
  eventType: GateEventType;
  occurredAt: string;
  sensorValue?: number;
  firmwareVersion: string;
  deviceId: DeviceId;
}

export interface AttemptMetrics {
  reactionMs: number | null;
  launchMs: number | null;
  courseMs: number | null;
  totalMs: number | null;
}

export interface AttemptRecord {
  runId: RunId;
  riderId: RiderId;
  riderName: string;
  tagId: TagId;
  sessionDate: string;
  status: RunStatus;
  queuedAt: string;
  countdownStartedAt: string | null;
  goAt: string | null;
  startTriggeredAt: string | null;
  line2TriggeredAt: string | null;
  finishTriggeredAt: string | null;
  metrics: AttemptMetrics;
  startGateId: DeviceId;
  finishGateId: DeviceId;
  uploadState: "pending" | "acked";
  retrySequence: number;
}

export interface DeviceUploadEnvelope {
  runId: RunId;
  checksumVersion: "v1";
  retrySequence: number;
  attempt: AttemptRecord;
  events: GateEvent[];
}

export interface DeviceStatusSnapshot {
  startGateId: DeviceId;
  finishGateId: DeviceId;
  queueDepth: number;
  pendingUploads: number;
  recentAttempts: AttemptRecord[];
  lastSyncAt: string | null;
}

export interface ResultsQuery {
  date: string;
  riderId?: RiderId;
}

export interface DailyResultsResponse {
  date: string;
  attempts: AttemptRecord[];
}

export interface RosterResponse {
  riders: Rider[];
  calibration: {
    startThreshold: number;
    finishThreshold: number;
  };
}

export interface StartRunInput {
  rider: Rider;
  sessionDate: string;
  startGateId: DeviceId;
  finishGateId: DeviceId;
  queuedAt: string;
}

export function createRunId(input: StartRunInput): RunId {
  const riderPart = input.rider.riderId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "rider";
  const ts = compactTimestamp(input.queuedAt);
  return `${input.startGateId}-${riderPart}-${ts}`;
}

export function compactTimestamp(value: string): string {
  return value.replace(/[-:TZ.]/g, "").slice(0, 14);
}

export function toSessionDate(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export function computeMetrics(attempt: Pick<AttemptRecord, "goAt" | "startTriggeredAt" | "line2TriggeredAt" | "finishTriggeredAt">): AttemptMetrics {
  const reactionMs = diffMs(attempt.goAt, attempt.startTriggeredAt);
  const launchMs = diffMs(attempt.startTriggeredAt, attempt.line2TriggeredAt);
  const courseMs = diffMs(attempt.startTriggeredAt, attempt.finishTriggeredAt);
  const totalMs = diffMs(attempt.goAt, attempt.finishTriggeredAt);
  return {
    reactionMs,
    launchMs,
    courseMs,
    totalMs
  };
}

export function buildAttemptRecord(input: StartRunInput): AttemptRecord {
  return {
    runId: createRunId(input),
    riderId: input.rider.riderId,
    riderName: input.rider.displayName,
    tagId: input.rider.tagId,
    sessionDate: input.sessionDate,
    status: "queued",
    queuedAt: input.queuedAt,
    countdownStartedAt: null,
    goAt: null,
    startTriggeredAt: null,
    line2TriggeredAt: null,
    finishTriggeredAt: null,
    metrics: {
      reactionMs: null,
      launchMs: null,
      courseMs: null,
      totalMs: null
    },
    startGateId: input.startGateId,
    finishGateId: input.finishGateId,
    uploadState: "pending",
    retrySequence: 0
  };
}

export function appendEvent(events: GateEvent[], event: GateEvent): GateEvent[] {
  return [...events, event].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

export function withUpdatedAttempt(attempt: AttemptRecord, patch: Partial<AttemptRecord>): AttemptRecord {
  const next = {
    ...attempt,
    ...patch
  };
  next.metrics = computeMetrics(next);
  return next;
}

function diffMs(startAt: string | null, endAt: string | null): number | null {
  if (!startAt || !endAt) {
    return null;
  }

  return Date.parse(endAt) - Date.parse(startAt);
}

