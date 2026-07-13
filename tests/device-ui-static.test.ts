import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function readUiFile(file: string) {
  return readFileSync(join(root, "apps/device-ui", file), "utf8");
}

describe("device UI static contract", () => {
  it("embeds compressed UI assets for firmware serving", () => {
    const header = readFileSync(join(root, "firmware/shared/include/device_ui.h"), "utf8");
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(header, /gzip-compressed PROGMEM byte arrays/);
    assert.match(header, /index\.html \(\d+ raw bytes, \d+ minified bytes, \d+ gzip bytes\)/);
    assert.match(header, /const uint8_t index_html_data\[\] PROGMEM = \{\n  0x1f, 0x8b/);
    assert.match(firmware, /server\.sendHeader\("Content-Encoding", "gzip"\)/);

    const sourceBytes = readUiFile("index.html").length + readUiFile("styles.css").length + readUiFile("main.js").length;
    const gzipBytes = [...header.matchAll(/, (\d+) gzip bytes\)/g)]
      .slice(0, 3)
      .reduce((total, match) => total + Number(match[1]), 0);
    assert.ok(gzipBytes < sourceBytes * 0.7, `expected gzip UI bytes ${gzipBytes} to be at least 30% smaller than ${sourceBytes}`);
  });

  it("keeps start-only rider surfaces marked for role-specific hiding", () => {
    const html = readUiFile("index.html");

    assert.match(html, /data-page="riders" data-start-only/);
    assert.match(html, /id="page-riders" class="page" data-start-only/);
    assert.match(html, /data-page="peer-tools" data-start-only/);
    assert.match(html, /id="page-peer-tools" class="page" data-start-only/);
    assert.match(html, /<div class="danger-actions" data-start-only>/);
  });

  it("supports start gate identity and mobile navigation layout", () => {
    const html = readUiFile("index.html");
    const css = readUiFile("styles.css");

    assert.match(html, /<option value="1">Gate Start<\/option>/);
    assert.match(html, /class="topbar"/);
    assert.match(html, /class="app-nav"/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /@media \(min-width: 760px\)/);
  });

  it("applies role UI from status before rendering gate state", () => {
    const js = readUiFile("main.js");

    assert.match(js, /function applyRoleUi\(role\)/);
    assert.match(js, /pageRequiresStart/);
    assert.match(js, /applyRoleUi\(status\.role\)/);
  });

  it("shows network status at the top of the Network page", () => {
    const html = readUiFile("index.html");
    const networkPage = html.slice(html.indexOf('<div id="page-config-network"'));
    const networkStatusIndex = networkPage.indexOf("<h2>Network Status</h2>");
    const wifiConfigIndex = networkPage.indexOf("<h2>Wi-Fi Configuration</h2>");

    assert.ok(networkStatusIndex >= 0);
    assert.ok(wifiConfigIndex > networkStatusIndex);
    assert.equal(html.match(/<h2>Network Status<\/h2>/g)?.length, 1);
  });

  it("exposes a read-only LittleFS file browser under Monitor", () => {
    const html = readUiFile("index.html");
    const js = readUiFile("main.js");
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(html, /data-page="files">Files<\/a>/);
    assert.match(html, /id="page-files" class="page"/);
    assert.match(html, /id="fileList"/);
    assert.match(html, /id="fileViewer"/);
    assert.match(js, /'files'/);
    assert.match(js, /function loadFiles\(path = currentFilePath\)/);
    assert.match(js, /\/api\/files\?path=/);
    assert.match(js, /\/api\/files\/view\?path=/);
    assert.match(firmware, /#include <LittleFS\.h>/);
    assert.match(firmware, /void handleGetFiles\(\)/);
    assert.match(firmware, /void handleGetFileView\(\)/);
    assert.match(firmware, /server\.on\("\/api\/files", HTTP_GET, handleGetFiles\)/);
    assert.match(firmware, /server\.on\("\/api\/files\/view", HTTP_GET, handleGetFileView\)/);
    assert.doesNotMatch(firmware, /server\.on\("\/api\/files", HTTP_POST/);
  });

  it("keeps browser calibration retired while preserving trigger delta config", () => {
    const html = readUiFile("index.html");
    const js = readUiFile("main.js");

    assert.doesNotMatch(html, /Auto Calibration/);
    assert.doesNotMatch(html, /id="currentDelta"/);
    assert.doesNotMatch(html, /calibrate-btn/);
    assert.doesNotMatch(html, /Calibrate Peer/);
    assert.doesNotMatch(html, /Trigger Delta Above Baseline/);
    assert.doesNotMatch(html, /id="triggerDelta"/);
    assert.doesNotMatch(html, /id="saveSensorConfig"/);
    assert.doesNotMatch(html, /id="startThreshold"/);
    assert.doesNotMatch(html, /id="line2Threshold"/);
    assert.doesNotMatch(html, /id="finishThreshold"/);
    assert.doesNotMatch(js, /function saveSensorConfig/);
    assert.doesNotMatch(js, /document\.getElementById\('triggerDelta'\)/);
    assert.doesNotMatch(js, /document\.getElementById\('startThreshold'\)/);
    assert.doesNotMatch(js, /document\.getElementById\('line2Threshold'\)/);
    assert.doesNotMatch(js, /document\.getElementById\('finishThreshold'\)/);
    assert.doesNotMatch(js, /startSensorCalibration/);
    assert.doesNotMatch(js, /\/api\/calibrate/);
  });

  it("routes peer commands through local ESP-NOW APIs instead of browser peer fetches", () => {
    const html = readUiFile("index.html");
    const js = readUiFile("main.js");
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(html, /data-peer-command="\/api\/peer\/ping"/);
    assert.match(html, /data-peer-command="\/api\/peer\/sync"/);
    assert.match(html, /data-peer-command="\/api\/peer\/riders\/sync"/);
    assert.doesNotMatch(html, /data-peer-command="\/api\/peer\/calibrate"/);
    assert.doesNotMatch(html, /Check Clock/);
    assert.doesNotMatch(html, /id="checkClockBtn"/);
    assert.doesNotMatch(html, /id="peerUrl"/);
    assert.doesNotMatch(js, /fetch\(url,/);
    assert.doesNotMatch(js, /function checkPeerClock/);
    assert.doesNotMatch(js, /checkClockBtn/);
    assert.match(js, /fetch\(endpoint, \{ method: 'POST' \}\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/ping", HTTP_POST, handlePostPeerPing\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/sync", HTTP_POST, handlePostPeerSync\)/);
    assert.doesNotMatch(firmware, /server\.on\("\/api\/peer\/calibrate"/);
    assert.match(firmware, /server\.on\("\/api\/peer\/riders\/sync", HTTP_POST, handlePostPeerRidersSync\)/);
  });

  it("makes peer rider sync wait for peer roster validation", () => {
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(firmware, /RiderSyncAck = 8/);
    assert.match(firmware, /sendRiderSyncAck\(mac\)/);
    assert.match(firmware, /pendingRiderSyncChecksum = riderRosterChecksum\(\)/);
    assert.match(firmware, /while \(!pendingRiderSyncValidated/);
    assert.match(firmware, /doc\["validated"\] = pendingRiderSyncValidated/);
    assert.match(firmware, /sendJson\(pendingRiderSyncValidated \? 200 : 504, payload\)/);
  });

  it("makes peer clock sync check, update, and confirm tolerance", () => {
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(firmware, /ClockSyncAck = 9/);
    assert.match(firmware, /CLOCK_SYNC_ACCEPTABLE_DIFF_MS = 25/);
    assert.match(firmware, /sendClockSyncAck\(mac, rttMs\)/);
    assert.match(firmware, /while \(!pendingClockSyncConfirmed/);
    assert.match(firmware, /doc\["initial"\]\.to<JsonObject>\(\)/);
    assert.match(firmware, /doc\["update"\]\.to<JsonObject>\(\)/);
    assert.match(firmware, /doc\["confirmation"\]\.to<JsonObject>\(\)/);
    assert.match(firmware, /sendJson\(acceptable \? 200 : 504, payload\)/);
  });

  it("links only to API documentation routes served by firmware", () => {
    const html = readUiFile("index.html");
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    const docLinks = [
      ...new Set([...html.matchAll(/(?:href|data-doc-url)="(\/docs\/[^"]+)"/g)].map((match) => match[1]))
    ];
    assert.deepEqual(docLinks.sort(), [
      "/docs/API.md",
      "/docs/API_CONFIG.md",
      "/docs/API_MAC.md",
      "/docs/API_RIDERS.md",
      "/docs/API_STATUS.md",
      "/docs/API_TIME.md",
      "/docs/API_WIFI.md",
      "/docs/CURL_EXAMPLES.md",
      "/docs/openapi.json"
    ].sort());
    assert.doesNotMatch(html, /openapi\.yaml/);

    for (const link of docLinks) {
      assert.match(firmware, new RegExp(`server\\.on\\("${link.replaceAll("/", "\\/")}", HTTP_GET, handleDocs`));
    }
  });
});
