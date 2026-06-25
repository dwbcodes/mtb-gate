import {
  appendEvent,
  buildAttemptRecord,
  type AttemptRecord,
  type DeviceStatusSnapshot,
  type DeviceUploadEnvelope,
  type GateEvent,
  type Rider,
  toSessionDate,
  withUpdatedAttempt
} from "../../contracts/src/index.ts";

interface RunState {
  attempt: AttemptRecord;
  events: GateEvent[];
}

interface SimulatorOptions {
  startGateId: string;
  finishGateId: string;
  firmwareVersion?: string;
}

export class SessionSimulator {
  private readonly startGateId: string;
  private readonly finishGateId: string;
  private readonly firmwareVersion: string;
  private readonly runs = new Map<string, RunState>();
  private readonly uploadQueue: DeviceUploadEnvelope[] = [];
  private lastSyncAt: string | null = null;

  constructor(options: SimulatorOptions) {
    this.startGateId = options.startGateId;
    this.finishGateId = options.finishGateId;
    this.firmwareVersion = options.firmwareVersion ?? "sim-0.1.0";
  }

  queueRun(rider: Rider, queuedAt: string): AttemptRecord {
    const attempt = buildAttemptRecord({
      rider,
      queuedAt,
      sessionDate: toSessionDate(queuedAt),
      startGateId: this.startGateId,
      finishGateId: this.finishGateId
    });

    this.runs.set(attempt.runId, { attempt, events: [] });
    this.recordEvent(attempt.runId, {
      eventType: "nfc-scan",
      gateRole: "start",
      occurredAt: queuedAt,
      deviceId: this.startGateId,
      firmwareVersion: this.firmwareVersion
    });
    return attempt;
  }

  beginCountdown(runId: string, occurredAt: string): AttemptRecord {
    return this.updateAttempt(runId, {
      countdownStartedAt: occurredAt,
      status: "countdown"
    }, {
      eventType: "countdown-start",
      gateRole: "start",
      occurredAt,
      deviceId: this.startGateId,
      firmwareVersion: this.firmwareVersion
    });
  }

  go(runId: string, occurredAt: string): AttemptRecord {
    return this.updateAttempt(runId, {
      goAt: occurredAt,
      status: "awaiting-start"
    }, {
      eventType: "countdown-go",
      gateRole: "start",
      occurredAt,
      deviceId: this.startGateId,
      firmwareVersion: this.firmwareVersion
    });
  }

  triggerStart(runId: string, occurredAt: string, sensorValue = 1): AttemptRecord {
    return this.updateAttempt(runId, {
      startTriggeredAt: occurredAt,
      status: "on-course"
    }, {
      eventType: "start-trigger",
      gateRole: "start",
      occurredAt,
      sensorValue,
      deviceId: this.startGateId,
      firmwareVersion: this.firmwareVersion
    });
  }

  triggerLine2(runId: string, occurredAt: string, sensorValue = 1): AttemptRecord {
    return this.updateAttempt(runId, {
      line2TriggeredAt: occurredAt
    }, {
      eventType: "line2-trigger",
      gateRole: "start",
      occurredAt,
      sensorValue,
      deviceId: this.startGateId,
      firmwareVersion: this.firmwareVersion
    });
  }

  triggerFinish(runId: string, occurredAt: string, sensorValue = 1): AttemptRecord {
    const attempt = this.updateAttempt(runId, {
      finishTriggeredAt: occurredAt,
      status: "finished"
    }, {
      eventType: "finish-trigger",
      gateRole: "finish",
      occurredAt,
      sensorValue,
      deviceId: this.finishGateId,
      firmwareVersion: this.firmwareVersion
    });

    this.uploadQueue.push(this.createEnvelope(runId));
    return attempt;
  }

  timeoutRun(runId: string, occurredAt: string): AttemptRecord {
    return this.updateAttempt(runId, {
      status: "timed-out"
    }, {
      eventType: "timeout",
      gateRole: "finish",
      occurredAt,
      deviceId: this.finishGateId,
      firmwareVersion: this.firmwareVersion
    });
  }

  listAttempts(): AttemptRecord[] {
    return [...this.runs.values()].map((entry) => entry.attempt).sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
  }

  nextPendingUpload(): DeviceUploadEnvelope | null {
    return this.uploadQueue[0] ?? null;
  }

  ackUpload(runId: string, ackedAt: string): AttemptRecord {
    const state = this.mustGet(runId);
    state.attempt = withUpdatedAttempt(state.attempt, {
      uploadState: "acked",
      retrySequence: state.attempt.retrySequence + 1
    });
    this.runs.set(runId, state);
    const index = this.uploadQueue.findIndex((entry) => entry.runId === runId);
    if (index >= 0) {
      this.uploadQueue.splice(index, 1);
    }
    this.lastSyncAt = ackedAt;
    return state.attempt;
  }

  snapshot(): DeviceStatusSnapshot {
    const recentAttempts = this.listAttempts().slice(-5).reverse();
    return {
      startGateId: this.startGateId,
      finishGateId: this.finishGateId,
      queueDepth: this.listAttempts().filter((attempt) => attempt.status !== "finished" && attempt.status !== "timed-out").length,
      pendingUploads: this.uploadQueue.length,
      recentAttempts,
      lastSyncAt: this.lastSyncAt
    };
  }

  private updateAttempt(runId: string, patch: Partial<AttemptRecord>, event: Omit<GateEvent, "runId">): AttemptRecord {
    const state = this.mustGet(runId);
    state.attempt = withUpdatedAttempt(state.attempt, patch);
    state.events = appendEvent(state.events, { runId, ...event });
    this.runs.set(runId, state);
    return state.attempt;
  }

  private recordEvent(runId: string, event: Omit<GateEvent, "runId">): void {
    const state = this.mustGet(runId);
    state.events = appendEvent(state.events, { runId, ...event });
    this.runs.set(runId, state);
  }

  private createEnvelope(runId: string): DeviceUploadEnvelope {
    const state = this.mustGet(runId);
    return {
      runId,
      checksumVersion: "v1",
      retrySequence: state.attempt.retrySequence,
      attempt: state.attempt,
      events: state.events
    };
  }

  private mustGet(runId: string): RunState {
    const state = this.runs.get(runId);
    if (!state) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return state;
  }
}

