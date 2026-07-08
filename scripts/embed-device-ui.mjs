import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const uiDir = join(root, "apps/device-ui");
const docsDir = join(root, "docs");
const output = join(root, "firmware/shared/include/device_ui.h");

const assets = [
  ["index_html", uiDir, "index.html"],
  ["styles_css", uiDir, "styles.css"],
  ["main_js", uiDir, "main.js"],
  ["docs_api_md", docsDir, "API.md"],
  ["docs_openapi_json", docsDir, "openapi.json"],
  ["docs_curl_examples_md", docsDir, "CURL_EXAMPLES.md"],
  ["docs_api_status_md", docsDir, "API_STATUS.md"],
  ["docs_api_riders_md", docsDir, "API_RIDERS.md"],
  ["docs_api_config_md", docsDir, "API_CONFIG.md"],
  ["docs_api_wifi_md", docsDir, "API_WIFI.md"],
  ["docs_api_time_md", docsDir, "API_TIME.md"],
  ["docs_api_mac_md", docsDir, "API_MAC.md"]
];

function bytesFor(dir, file) {
  return [...readFileSync(join(dir, file))];
}

function formatBytes(bytes) {
  const lines = [];
  for (let index = 0; index < bytes.length; index += 16) {
    const chunk = bytes
      .slice(index, index + 16)
      .map((byte) => `0x${byte.toString(16).padStart(2, "0")}`);
    lines.push(`  ${chunk.join(", ")}`);
  }
  return lines.join(",\n");
}

const sections = assets.map(([symbol, dir, file]) => {
  const bytes = bytesFor(dir, file);
  return `// ${basename(file)} (${bytes.length} bytes)
const uint8_t ${symbol}_data[] PROGMEM = {
${formatBytes(bytes)}
};
const uint16_t ${symbol}_len = ${bytes.length};
`;
});

writeFileSync(
  output,
  `#ifndef DEVICE_UI_H
#define DEVICE_UI_H

#include <Arduino.h>

// Device UI files embedded as PROGMEM byte arrays.

${sections.join("\n")}
#endif
`
);
