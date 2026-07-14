import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttemptRecord,
  computeMetrics,
  createRunId
} from "@mtb-gate/contracts";

test("createRunId is deterministic for rider and timestamp", () => {
  const runId = createRunId({
    rider: {
      riderId: "rider-ada",
      displayName: "Ada",
      tagId: "tag-100"
    },
    queuedAt: "2026-05-19T08:00:00.000Z",
    sessionDate: "2026-05-19",
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  assert.equal(runId, "start-a-riderada-20260519080000");
});

test("computeMetrics returns reaction, launch, course, and total times", () => {
  const metrics = computeMetrics({
    goAt: "2026-05-19T08:00:05.000Z",
    startTriggeredAt: "2026-05-19T08:00:05.620Z",
    line2TriggeredAt: "2026-05-19T08:00:06.720Z",
    finishTriggeredAt: "2026-05-19T08:00:17.000Z"
  });

  assert.deepEqual(metrics, {
    reactionMs: 620,
    launchMs: 1100,
    courseMs: 11380,
    totalMs: 12000
  });
});

test("computeMetrics returns null launchMs when line2TriggeredAt is null", () => {
  const metrics = computeMetrics({
    goAt: "2026-05-19T08:00:05.000Z",
    startTriggeredAt: "2026-05-19T08:00:05.620Z",
    line2TriggeredAt: null,
    finishTriggeredAt: "2026-05-19T08:00:17.000Z"
  });

  assert.equal(metrics.launchMs, null);
  assert.equal(metrics.reactionMs, 620);
  assert.equal(metrics.courseMs, 11380);
});

test("buildAttemptRecord starts pending and empty", () => {
  const attempt = buildAttemptRecord({
    rider: {
      riderId: "rider-ben",
      displayName: "Ben",
      tagId: "tag-200"
    },
    queuedAt: "2026-05-19T08:00:00.000Z",
    sessionDate: "2026-05-19",
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  assert.equal(attempt.status, "queued");
  assert.equal(attempt.uploadState, "pending");
  assert.equal(attempt.metrics.totalMs, null);
});

