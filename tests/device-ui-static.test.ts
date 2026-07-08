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

  it("exposes baseline-relative sensor calibration instead of absolute threshold sliders", () => {
    const html = readUiFile("index.html");
    const js = readUiFile("main.js");

    assert.match(html, /Trigger Delta Above Baseline/);
    assert.match(html, /id="triggerDelta"/);
    assert.doesNotMatch(html, /id="startThreshold"/);
    assert.doesNotMatch(html, /id="line2Threshold"/);
    assert.doesNotMatch(html, /id="finishThreshold"/);
    assert.match(js, /triggerDelta: parseFloat\(document\.getElementById\('triggerDelta'\)\.value\)/);
    assert.doesNotMatch(js, /document\.getElementById\('startThreshold'\)/);
    assert.doesNotMatch(js, /document\.getElementById\('line2Threshold'\)/);
    assert.doesNotMatch(js, /document\.getElementById\('finishThreshold'\)/);
  });

  it("routes peer commands through local ESP-NOW APIs instead of browser peer fetches", () => {
    const html = readUiFile("index.html");
    const js = readUiFile("main.js");
    const firmware = readFileSync(join(root, "firmware/gate/src/main.cpp"), "utf8");

    assert.match(html, /data-peer-command="\/api\/peer\/ping"/);
    assert.match(html, /data-peer-command="\/api\/peer\/sync"/);
    assert.match(html, /data-peer-command="\/api\/peer\/calibrate"/);
    assert.match(html, /data-peer-command="\/api\/peer\/riders\/sync"/);
    assert.doesNotMatch(html, /id="peerUrl"/);
    assert.doesNotMatch(js, /fetch\(url,/);
    assert.match(js, /fetch\(endpoint, \{ method: 'POST' \}\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/ping", HTTP_POST, handlePostPeerPing\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/sync", HTTP_POST, handlePostPeerSync\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/calibrate", HTTP_POST, handlePostPeerCalibrate\)/);
    assert.match(firmware, /server\.on\("\/api\/peer\/riders\/sync", HTTP_POST, handlePostPeerRidersSync\)/);
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
