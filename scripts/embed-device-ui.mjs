import { gzipSync } from "node:zlib";
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

function minifyText(file, content) {
  if (file.endsWith(".json")) {
    return `${JSON.stringify(JSON.parse(content))}\n`;
  }

  if (file.endsWith(".css")) {
    return content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([{}:;,>~+])\s*/g, "$1")
      .replace(/;}/g, "}")
      .trim();
  }

  if (file.endsWith(".html")) {
    return content
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/>\s+</g, "><");
  }

  if (file.endsWith(".js")) {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  return content.trimEnd() + "\n";
}

function bytesFor(dir, file) {
  const content = readFileSync(join(dir, file), "utf8");
  const minified = minifyText(file, content);
  return {
    rawBytes: Buffer.byteLength(content),
    minifiedBytes: Buffer.byteLength(minified),
    bytes: [...gzipSync(minified, { level: 9 })]
  };
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
  const { rawBytes, minifiedBytes, bytes } = bytesFor(dir, file);
  return `// ${basename(file)} (${rawBytes} raw bytes, ${minifiedBytes} minified bytes, ${bytes.length} gzip bytes)
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

// Device UI files embedded as gzip-compressed PROGMEM byte arrays.

${sections.join("\n")}
#endif
`
);
