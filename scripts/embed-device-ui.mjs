import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const uiDir = join(root, "apps/device-ui");
const output = join(root, "firmware/shared/include/device_ui.h");

const assets = [
  ["index_html", "index.html"],
  ["styles_css", "styles.css"],
  ["main_js", "main.js"]
];

function bytesFor(file) {
  return [...readFileSync(join(uiDir, file))];
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

const sections = assets.map(([symbol, file]) => {
  const bytes = bytesFor(file);
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
