// `npm run simulate` — prints a snapshot + first pending upload for a
// fixed two-rider session with overlapping runs (Ben's countdown starts
// before Ada finishes), the core scenario the run queue must support.
import { SessionSimulator } from "./session-simulator.ts";

const simulator = new SessionSimulator({
  startGateId: "start-gate-a",
  finishGateId: "finish-gate-a"
});

const now = new Date("2026-05-19T08:00:00.000Z");
const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();

const riderA = { riderId: "rider-ada", displayName: "Ada", tagId: "tag-100" };
const riderB = { riderId: "rider-ben", displayName: "Ben", tagId: "tag-200" };

const runA = simulator.queueRun(riderA, iso(0));
simulator.beginCountdown(runA.runId, iso(500));
simulator.go(runA.runId, iso(5500));
simulator.triggerStart(runA.runId, iso(6100), 0.92);
simulator.triggerLine2(runA.runId, iso(7200), 0.88);

const runB = simulator.queueRun(riderB, iso(6500));
simulator.beginCountdown(runB.runId, iso(7000));
simulator.go(runB.runId, iso(12000));
simulator.triggerStart(runB.runId, iso(12650), 0.95);
simulator.triggerLine2(runB.runId, iso(13850), 0.91);

simulator.triggerFinish(runA.runId, iso(19750), 1.13);
simulator.triggerFinish(runB.runId, iso(24000), 1.04);

console.log(JSON.stringify({
  snapshot: simulator.snapshot(),
  pendingUpload: simulator.nextPendingUpload()
}, null, 2));

