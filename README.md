# MTB Gate

MTB Gate is a monorepo for an MTB standing-start timing system built around two ESP32 WROOM dev boards (start and finish gates), NFC rider identification, offline-first attempt capture, and AWS-backed results.

## Workspaces

- `packages/contracts`: shared wire contracts and domain helpers.
- `packages/simulator`: local practice-session simulator for overlapping runs.
- `services/api`: local API/dev server plus Lambda-oriented handlers.
- `services/infra`: AWS CDK entrypoint scaffold for the eventual deployment stack.
- `apps/cloud-results`: static cloud day-results UI.
- `apps/device-ui`: static captive-portal UI for the gate acting as the start gate.
- `firmware/`: PlatformIO-based firmware for a unified gate binary plus shared embedded code.

## Frontend pages

- `apps/cloud-results/index.html`: homepage with top navigation.
- `apps/cloud-results/today.html`: rider stats page for today’s metrics.
- `apps/cloud-results/src/`: small browser modules for API access, metrics aggregation, formatting, and rendering so new pages can reuse the same logic.

## API-first development

All product behavior should be designed API-first. Any data, state transition, configuration change, or device action used by a web interface must be exposed through an explicit API endpoint first, then consumed by the UI.

- Do not make a browser page depend on private in-memory state, hardcoded mock data, direct firmware internals, or form-only behavior that has no API equivalent.
- Keep API request and response shapes in `packages/contracts` when they cross package, firmware, simulator, or service boundaries.
- Device UI features should call firmware-served `/api/...` endpoints; cloud/results UI features should call the service API.
- New web UI controls are not complete until the matching API route, validation behavior, response shape, and tests or verification steps are documented.
- If the firmware web interface can perform an action, there should be an API path for the same action so the static UI, tests, scripts, and future clients all use the same contract.

## Commands

- `npm test`: run Node-based TypeScript tests with built-in type stripping.
- `npm run test:device`: run dual-ESP32 hardware tests through the serial console API.
- `npm run test:device:console`: run only serial console API hardware tests.
- `npm run test:device:api`: run optional HTTP API hardware tests.
- `npm run test:device:ui`: run only hardware Playwright UI tests.
- `npm run test:device:destructive`: run opt-in destructive multi-gate topology tests.
- `npm run simulate`: run the local simulator CLI.
- `npm run api:dev`: start the local API server on port `8787`.
- `make build-start`: build the start-gate firmware using the default finish-gate peer MAC.
- `make build-finish`: build the finish-gate firmware using the default start-gate peer MAC.
- `make attach-usb`: from WSL, call `usbipd.exe` to attach the ESP32 back into WSL after a reboot.
- `make upload-start`: flash start-gate firmware to `/dev/ttyACM0` by default.
- `make upload-finish`: flash finish-gate firmware to `/dev/ttyACM0` by default.
- `make reattach-upload-start`: reattach the ESP32 to WSL, then flash start-gate firmware.
- `make reattach-upload-finish`: reattach the ESP32 to WSL, then flash finish-gate firmware.
- `make monitor`: open the serial monitor at `115200`.
- `make upload-monitor-start`: flash start-gate firmware and immediately monitor the device.
- `make upload-monitor-finish`: flash finish-gate firmware and immediately monitor the device.
- `make test-device`: require `/dev/ttyACM0` and `/dev/ttyACM1`, then run serial console API tests against both devices.
- `make test-device-destructive`: require `/dev/ttyACM0` and `/dev/ttyACM1`, then run opt-in destructive topology tests.

## Current state

This implementation delivers the complete end-to-end rider experience:

- **NFC rider identification**: on-device registration via phone NFC scan, persisted to 32-entry NVS store,
- **Countdown timer**: 5–4–3–2–1 → GO (100ms resolution) with start gate authority,
- **Three timing metrics** per run, all timestamped on start gate `millis()`:
  - Reaction: GO → Line 1 (start sensor)
  - Launch: Line 1 → Line 2 (new dual-sensor support)
  - Course: Line 1 → Finish (via ESP-Now)
- **ESP-Now inter-gate communication**: finish gate detects sensor and sends finish event to start gate, start gate stamps time on receipt,
- **Live device dashboard**: replaces static mock, polls `/api/status` every 2 seconds, shows queue depth and recent attempts with all three metrics,
- **Rider registration UI panel**: "Tap NFC" button triggers 15-second listen window, on tag detect prompts for display name, persists to device,
- **Configuration UI enhancements**: line2 threshold and Wi-Fi channel inputs,
- **Cloud results metrics**: average launch time, per-rider launch statistics,
- **Unified firmware** with idempotent cloud sync and offline ingest.

## Unified firmware

The firmware builds as a single PlatformIO app, but each image is compiled as a specific gate role. Role and ESP-Now peer MAC are build-time settings, not web/API configuration. Default device MACs:

- Start gate: `dc:b4:d9:9c:48:ec`
- Finish gate: `0c:4e:a0:66:a4:14`

Build commands:

- `make build-start`: start gate image; rider scan, countdown, run authority, and local dashboard. Uses the default finish-gate MAC as its peer.
- `make build-finish`: finish gate image; finish trigger detection and finish-event reporting. Uses the default start-gate MAC as its peer.
- Add `PEER_MAC=AA:BB:CC:DD:EE:FF` only when overriding the default peer MAC.

Each device also persists its own:

- access-point SSID and password,
- optional station Wi‑Fi SSID and password,
- three sensor thresholds (line1, line2, finish),
- Wi-Fi channel for ESP-Now inter-gate communication,
- device label.

When the device boots it starts its own AP and serves a configuration page on that network. If station Wi‑Fi is configured successfully, the same configuration page is also reachable from the joined network so you can change network settings and thresholds without reconnecting over USB.

During bench testing, the build role and runtime configuration can be inspected over serial with:

- `status`: print device info and current config
- `wifi`: show network connectivity status

By default a freshly flashed device should also create a Wi‑Fi access point named `MTBGate-<device-id>` with password `changeme123`. After joining that network, open `http://192.168.4.1/` to change AP settings, station Wi‑Fi settings, thresholds, and Wi-Fi channel.

## Hardware device tests

The device test harness loads configuration from repo-root `.env` before reading environment variables. Copy `.env.example` to `.env` for local hardware settings; shell-provided variables still override `.env` values. The default hardware suite refuses to start unless all configured serial devices exist, then tests the device API through serial console commands. Defaults are `/dev/ttyACM0,/dev/ttyACM1`, but the ports and timing are configurable:

```sh
make test-device
```

The console API tests cover status, configuration redaction, sensor threshold validation, rider add/list/delete, and ping without requiring Wi-Fi. Optional HTTP/Playwright tests are still available through `npm run test:device:api` and `npm run test:device:ui` when the test machine can reach the gate network.

### Destructive multi-gate tests

Destructive hardware tests configure the discovered devices into the supplied topology, mutate configuration, verify start-gate rider changes sync to the other gates, watch serial output for firmware errors, then restore the backed-up configuration and riders.

They are skipped by default and refuse to run without `MTB_GATE_DESTRUCTIVE=1` in `.env` or the shell:

```sh
make test-device-destructive
```

Required `.env` entries for destructive tests are `MTB_GATE_DESTRUCTIVE=1`, `MTB_GATE_START_MAC`, `MTB_GATE_FINISH_MAC`, and `MTB_GATE_RESTORE_SECRETS_JSON`. Optional intermediates can be supplied as `MTB_GATE_INTERMEDIATE_MACS='2=22:22:22:22:22:22,3=33:33:33:33:33:33'`. The suite matches MACs to serial ports automatically, requires restore secrets because `/api/config` redacts passwords, and monitors each device serial stream during the sync test. Serial errors fail the test; serial warnings are attached to the Playwright report and can be made fatal with `MTB_GATE_FAIL_ON_SERIAL_WARNINGS=1`.

The AWS CDK package is intentionally scaffolded but not executable until dependencies are installed.
