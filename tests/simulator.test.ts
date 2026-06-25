import test from "node:test";
import assert from "node:assert/strict";
import { SessionSimulator } from "../packages/simulator/src/session-simulator.ts";

test("simulator supports overlapping queued runs and produces upload envelopes", () => {
  const sim = new SessionSimulator({
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  const runA = sim.queueRun({ riderId: "rider-ada", displayName: "Ada", tagId: "tag-100" }, "2026-05-19T08:00:00.000Z");
  const runB = sim.queueRun({ riderId: "rider-ben", displayName: "Ben", tagId: "tag-200" }, "2026-05-19T08:00:01.000Z");

  sim.beginCountdown(runA.runId, "2026-05-19T08:00:01.500Z");
  sim.go(runA.runId, "2026-05-19T08:00:06.500Z");
  sim.triggerStart(runA.runId, "2026-05-19T08:00:07.100Z");
  sim.triggerLine2(runA.runId, "2026-05-19T08:00:08.200Z");

  sim.beginCountdown(runB.runId, "2026-05-19T08:00:03.000Z");
  sim.go(runB.runId, "2026-05-19T08:00:08.000Z");
  sim.triggerStart(runB.runId, "2026-05-19T08:00:08.600Z");
  sim.triggerLine2(runB.runId, "2026-05-19T08:00:09.700Z");

  sim.triggerFinish(runA.runId, "2026-05-19T08:00:19.500Z");

  assert.equal(sim.snapshot().queueDepth, 1);
  const envelope = sim.nextPendingUpload();
  assert.equal(envelope?.runId, runA.runId);
  assert.ok(envelope?.attempt.metrics.launchMs !== null, "launchMs should be computed on complete run");
});

test("ackUpload marks the attempt as acknowledged and clears the queue item", () => {
  const sim = new SessionSimulator({
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  const run = sim.queueRun({ riderId: "rider-ada", displayName: "Ada", tagId: "tag-100" }, "2026-05-19T08:00:00.000Z");
  sim.beginCountdown(run.runId, "2026-05-19T08:00:01.000Z");
  sim.go(run.runId, "2026-05-19T08:00:06.000Z");
  sim.triggerStart(run.runId, "2026-05-19T08:00:06.500Z");
  sim.triggerLine2(run.runId, "2026-05-19T08:00:07.600Z");
  sim.triggerFinish(run.runId, "2026-05-19T08:00:18.000Z");

  const acked = sim.ackUpload(run.runId, "2026-05-19T08:01:00.000Z");
  assert.equal(acked.uploadState, "acked");
  assert.equal(sim.nextPendingUpload(), null);
});

