import test from "node:test";
import assert from "node:assert/strict";
import { postAttempts, getResults } from "../services/api/src/handlers.ts";
import { InMemoryAttemptStore } from "../services/api/src/store.ts";
import { SessionSimulator } from "../packages/simulator/src/session-simulator.ts";

test("attempt ingest is idempotent by runId", async () => {
  const store = new InMemoryAttemptStore();
  const sim = new SessionSimulator({
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  const run = sim.queueRun({ riderId: "rider-ada", displayName: "Ada", tagId: "tag-100" }, "2026-05-19T08:00:00.000Z");
  sim.beginCountdown(run.runId, "2026-05-19T08:00:01.000Z");
  sim.go(run.runId, "2026-05-19T08:00:06.000Z");
  sim.triggerStart(run.runId, "2026-05-19T08:00:06.700Z");
  sim.triggerLine2(run.runId, "2026-05-19T08:00:07.800Z");
  sim.triggerFinish(run.runId, "2026-05-19T08:00:18.100Z");

  const first = await postAttempts(JSON.stringify(sim.nextPendingUpload()), store);
  const second = await postAttempts(JSON.stringify(sim.nextPendingUpload()), store);

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
});

test("results endpoint filters by date", async () => {
  const store = new InMemoryAttemptStore();
  const sim = new SessionSimulator({
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  const run = sim.queueRun({ riderId: "rider-ben", displayName: "Ben", tagId: "tag-200" }, "2026-05-19T08:00:00.000Z");
  sim.beginCountdown(run.runId, "2026-05-19T08:00:01.000Z");
  sim.go(run.runId, "2026-05-19T08:00:06.000Z");
  sim.triggerStart(run.runId, "2026-05-19T08:00:06.500Z");
  sim.triggerLine2(run.runId, "2026-05-19T08:00:07.600Z");
  sim.triggerFinish(run.runId, "2026-05-19T08:00:18.500Z");

  store.ingest(sim.nextPendingUpload()!);
  const response = await getResults(new URL("http://localhost:8787/results?date=2026-05-19"), store);
  const payload = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(payload.attempts.length, 1);
  assert.equal(payload.attempts[0].riderId, "rider-ben");
});

test("roster is auto-populated from ingested attempts", () => {
  const store = new InMemoryAttemptStore();
  const sim = new SessionSimulator({
    startGateId: "start-a",
    finishGateId: "finish-a"
  });

  const run = sim.queueRun({ riderId: "rider-xyz", displayName: "Xavier", tagId: "tag-999" }, "2026-05-19T08:00:00.000Z");
  sim.beginCountdown(run.runId, "2026-05-19T08:00:01.000Z");
  sim.go(run.runId, "2026-05-19T08:00:06.000Z");
  sim.triggerStart(run.runId, "2026-05-19T08:00:06.500Z");
  sim.triggerLine2(run.runId, "2026-05-19T08:00:07.600Z");
  sim.triggerFinish(run.runId, "2026-05-19T08:00:18.500Z");

  store.ingest(sim.nextPendingUpload()!);
  const roster = store.roster();

  const xavier = roster.riders.find(r => r.riderId === "rider-xyz");
  assert.ok(xavier, "Xavier should be in roster after ingest");
  assert.equal(xavier.displayName, "Xavier");
  assert.equal(xavier.tagId, "tag-999");
});
