import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function readFirmware() {
  return readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");
}

describe("firmware static contract", () => {
  it("allows NFC re-scan handling while a run is active", () => {
    const firmware = readFirmware();

    assert.match(firmware, /bool nfcTagPresent = false;/);
    assert.match(firmware, /const bool newPresentation = !nfcTagPresent \|\| observedNfcTag != tagId;/);
    assert.doesNotMatch(
      firmware,
      /nfcReader\.isInitialized\(\)\s*&&\s*activeRunId\.length\(\)\s*==\s*0/
    );
    assert.match(firmware, /startRunForRider\(tagId\);/);
  });

  it("deletes active run immediately when the same rider re-scans", () => {
    const firmware = readFirmware();

    assert.match(firmware, /const String cancelledRunId = activeRunId;/);
    assert.match(firmware, /eventStore\.logEvent\("run_cancelled", cancelledRunId, rider->riderId, millis\(\)\);/);
    assert.match(firmware, /queue\.remove\(cancelledRunId\);/);
    assert.doesNotMatch(firmware, /activeRun->status = RunStatus::Cancelled;/);
  });
});
