import type { AttemptRecord, DeviceUploadEnvelope, ResultsQuery, Rider, RosterResponse } from "@mtb-gate/contracts";

// Storage port for the sync API. ingest() must be idempotent on runId —
// devices retry uploads, so a duplicate envelope returns the stored
// attempt with created=false. The in-memory implementation below is the
// dev stand-in for the planned DynamoDB single-table store.
export interface AttemptStore {
  ingest(envelope: DeviceUploadEnvelope): { created: boolean; attempt: AttemptRecord };
  queryResults(input: ResultsQuery): AttemptRecord[];
  roster(): RosterResponse;
}

export class InMemoryAttemptStore implements AttemptStore {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly riders = new Map<string, Rider>([
    ["rider-ada", { riderId: "rider-ada", displayName: "Ada", tagId: "tag-100" }],
    ["rider-ben", { riderId: "rider-ben", displayName: "Ben", tagId: "tag-200" }],
    ["rider-chloe", { riderId: "rider-chloe", displayName: "Chloe", tagId: "tag-300" }]
  ]);

  ingest(envelope: DeviceUploadEnvelope): { created: boolean; attempt: AttemptRecord } {
    const existing = this.attempts.get(envelope.runId);
    if (existing) {
      return {
        created: false,
        attempt: existing
      };
    }

    this.attempts.set(envelope.runId, envelope.attempt);
    this.riders.set(envelope.attempt.riderId, {
      riderId: envelope.attempt.riderId,
      displayName: envelope.attempt.riderName,
      tagId: envelope.attempt.tagId
    });
    return {
      created: true,
      attempt: envelope.attempt
    };
  }

  queryResults(input: ResultsQuery): AttemptRecord[] {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.sessionDate === input.date)
      .filter((attempt) => !input.riderId || attempt.riderId === input.riderId)
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
  }

  roster(): RosterResponse {
    return {
      riders: [...this.riders.values()],
      calibration: {
        startThreshold: 0.85,
        finishThreshold: 0.85
      }
    };
  }
}

