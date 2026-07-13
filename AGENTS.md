# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MTB Gate is a monorepo for an MTB standing-start timing system with:
- A minimum of two ESP32 gates (start and finish) that communicate via **ESP-Now** for low-latency direct device-to-device messaging
  - Currently testing with ESP32-C3 DevKit M1; will switch to ESP32 WROOM when available
- NFC rider identification via NFC module
- Local device dashboard on start gate

The project unifies firmware across both gates. Role and peer MAC are configured at runtime via the device web UI and stored in NVS. Each device runs its own Wi-Fi AP for configuration and can connect to a station network; ESP-Now operates independently of router-backed Wi-Fi networking.

### Product Intent

The system exists so a team can practice MTB standing starts cheaply and robustly:
- A rider identifies themselves at the start gate by swiping an NFC tag (or card) to the start gate.
- The start gate counts down from a user defined number (default 10) to GO via a voice prompt and a visual countdown on the start gate's display.
- The rider crosses a pressure-tube sensor at the start and another at the finish gate.
- The finish gate reports the finish event back to the start gate, which displays timing metrics for the run, this needs to be transactional and reliable even if the finish gate is out of range or loses power.
- Multiple riders may have overlapping attempts, and each rider may make multiple attempts.
- Results should remain usable offline and uploaded when network access is available.

Implementation should use professional software design principles. Future cloud/backend work is expected to use AWS APIs, DynamoDB single-table design, and microservice/DDD patterns where appropriate.

### Product Setup / Initialization.

The system is designed to be easy to set up and use by non-technical users. The following steps are expected to be performed by the end user:

1. It is expected that the user will recieve the two gates pre-flashed.
2. The user will power on the gates and add the Mac address of the finish gate to the start gate via the captive portal.
3. The Start gate will be then be used as the controller for the system, and the user will be able to configure the countdown, Wi-Fi settings, and other parameters via the captive portal.  There should be no need for the user to connect to the finish gate directly, as it will be automatically detected by the start gate via ESP-Now.
4. The Finish gate should use the same network configuration as the start gate, if the start gate is not connected to an AP, then the Finish gate should connect to the start gate's AP and configure the Finish gate with the IP + 1 of the start gate's IP.  If the start gate is connected to an AP, then the Finish gate should connect to the same AP and configure itself with a static IP that is one greater than the start gate's IP.  The user should be able to connect to the Start gates AP and connect to either device.


## Change Tracking with Beads

All code or documentation changes in this repository must be tracked with Beads (`bd`).

- Before starting implementation, inspect existing work with `bd ready` and create or select a bead for the task.
- Use `bd create` for new work that is not already represented, and keep the bead ID associated with the change.
- Update the bead as work progresses with concise notes when useful, especially for hardware-test results or firmware behavior changes.
- Close the bead only after the change is implemented and verified.
- Do not leave repo changes untracked by Beads unless the user explicitly says not to use `bd`.

## Workspaces

The monorepo uses npm workspaces in `/packages`, `/services`, and `/apps`:

- **packages/contracts**: TypeScript wire protocol types and domain helpers shared across device and API layers
- **packages/simulator**: CLI practice-session simulator for testing overlapping runs offline
- **services/api**: Node-based dev server for testing cloud sync endpoint; runs on port 8787 in dev
- **apps/device-ui**: Captive portal static UI served by start gate (configuration, live countdown, results display)
- **firmware/**: PlatformIO-managed ESP32-C3 firmware; uses shared embedded code in `firmware/shared/`

## Building and Testing

### TypeScript (Node.js)

```sh
npm test                    # Run all Node tests in tests/**/*.test.ts
npm run simulate            # Run local simulator CLI
npm run api:dev             # Start local API server on :8787
```

TypeScript runs natively via Node.js with `--experimental-strip-types`, no build step.

### Firmware (C++)

```sh
make build                   # Build unified gate firmware
make upload                  # Flash to /dev/ttyACM0 and /dev/ttyACM1 (both devices)
make upload PORT=/dev/ttyACM0  # Flash a single device
make upload-monitor          # Flash, then open serial monitor
make monitor BAUD=115200    # Open serial monitor only
make clean                  # Remove .pio build outputs
make size                   # Print memory usage
make check                  # Run tests + firmware build (quick CI check)
```

After flashing, connect to the device's AP and visit `http://192.168.4.1/` to set the role (start/finish) and peer MAC.

**PlatformIO Core**: Repo maintains its own core in `firmware/.platformio-core/` to avoid global installation.
- **Board**: esp32-c3-devkitm-1 (currently testing with C3; will switch to esp32dev for WROOM)
- **Framework**: Arduino
- **Monitor**: 115200 baud (USB CDC on C3)
- **Build flags**: C++17, USB CDC enabled (C3 native USB)

**Firmware structure**:
- `firmware/gate/src/main.cpp`: Entry point
- `firmware/shared/include/`: Headers for shared logic (gate types, config, run queue, sensors, riders, NFC)
- `firmware/shared/src/`: Implementation (gate config, run queue, rider store, NFC reader)

### USB on WSL

```sh
make attach-usb             # Auto-find and attach ESP32 to WSL
make attach-usb BUSID=1-3   # Attach specific device
make reattach-upload        # Attach USB, then flash
```

Default USB_MATCH regex: `Espressif|USB JTAG|CDC ACM`; override with `make attach-usb USB_MATCH="..."`

## Architecture

### Data Flow

1. **Device Role Assignment**: Both gates run identical firmware. Role (start/finish/intermediate) and peer MAC are set at runtime via the web UI and persisted to NVS. No per-gate build step is required.
2. **Run Management**: Start gate queues overlapping runs via `run_queue.h` abstraction; each run has deterministic `runId`
3. **NFC Rider Identification**: Riders registered on-device via NFC tap, stored in `rider_store.h` (32-entry NVS-backed)
4. **Countdown & Timing**: Start gate owns all timestamps via `millis()`, coordinates countdown (100ms resolution), and stamps three timing metrics:
   - Reaction: GO → Line 1 sensor
   - Launch: Line 1 → Line 2 sensor (new dual-sensor support)
   - Course: Line 1 → Finish gate signal (via ESP-Now)
5. **ESP-Now Inter-Gate Communication**: Finish gate sends finish events to start gate via low-latency messages (independent of Wi-Fi; supports distances up to ~250m)
6. **Sensor Abstraction**: Pressure sensors (MPXV7002DP) abstracted in `sensor_gate.h` for mocking during dev; sensor on start gate GPIO0, bidirectional trigger detection (handles both positive and negative pressure signals)
7. **Offline Ingest**: Runs captured locally; payloads idempotent and uploadable to AWS when network available
8. **Wi-Fi** (Configuration & Cloud Sync): Each device:
   - AP SSID always equals the deviceId (`Gate-<#>-<mac>`); not user-configurable
   - AP IP is `192.168.4.<gateNumber>` (e.g. gate 1 → 192.168.4.1, gate 12 → 192.168.4.12)
   - DHCP client hostname set to deviceId so the device is identifiable on router DHCP tables
   - Optionally joins a station network (both configured via device UI)
   - Uses Wi-Fi only for admin/configuration and cloud uploads; timing operates independently via ESP-Now

### Firmware Abstractions

- **gate_config.h/cpp**: Persistent NVS storage for AP/station password, thresholds (line1, line2, finish), Wi-Fi channel, gate number, and peer MAC. DeviceId = `Gate-<#>-<mac>` computed from gate number + eFuse MAC; AP SSID always equals deviceId
- **run_queue.h**: Queue for overlapping runs with deterministic ID generation; supports stampLine2() for dual-sensor timing
- **rider_store.h/cpp**: Persistent NVS rider registration (32-entry max), keyed by tagId
- **nfc_reader.h/cpp**: NFC tag reader abstraction (mock in dev, real PN532 I2C in production)
- **sensor_gate.h**: Sensor read abstraction; mock vs. real sensors can be swapped

### Hardware Parts

See `docs/parts/` for datasheets.

| Part | Role | Notes |
|---|---|---|
| ESP32-C3 DevKit M1 | MCU (testing) | Will switch to ESP32 WROOM when available |
| MPXV7002DP | Pressure sensor | Piezoresistive differential transducer, ±2 kPa range. Datasheet: `docs/parts/MPXV7002.pdf`. Output: Vout = Vs × (0.2P + 0.5). At 0 kPa with 5V supply: 2.5V. Top port (P1) connected to pressure tube. **Known issue**: I2C (NFC reader) corrupts ESP32-C3 ADC reads on the sensor pin — NFC I2C is disabled during active runs and calibration. |
| PN532 | NFC reader | I2C on SDA=GPIO8, SCL=GPIO10. IRQ=GPIO6, RESET=GPIO7. Deferred init (2s after boot). Wire.end() called if not detected to prevent ADC interference. |
| Buzzer | Audio feedback | GPIO5 via LEDC PWM. Countdown beeps, start tune, finish tone. |

### Cloud Sync Pattern

**Device → Cloud**: One-time HTTP POST of offline-captured runs to AWS Lambda endpoint when network available.
- Payload includes idempotent `runId` for deduplication
- No retry/broker infrastructure needed; simple REST with automatic retry on failure
- Device does not track or process data after upload

**Scope boundary**: All processing (storage, analytics, aggregation, results UI generation) happens in AWS after upload and is **out of scope for this device-side plan**.

### Device UI

- **Device UI** (`apps/device-ui/`): Captive portal static SPA served by the gate at its AP IP
  - Side navigation layout with two sections: Monitor (Results, Riders) and Configuration (Network, Gate Config, Reset) and Developer (API Docs, Peer Tools)
  - Hash-based client-side routing (`#results`, `#riders`, `#config-network`, `#config-gate`, `#config-reset`, `#docs`, `#peer-tools`)
  - **Results** (home): Recent attempts with 3 timing metrics, network status grid, connected-gates info for non-start gates
  - **Riders**: NFC registration panel (15s listen window, prompt for display name), registered riders list
  - **Network**: AP SSID (read-only, always = deviceId), AP password, station SSID/password, Wi-Fi channel
  - **Gate Config**: Gate number dropdown (1=Start, 2–11=Intermediate, 12=Finish), peer MAC, sensor thresholds
  - **Reset**: Reboot, factory reset, clear riders, download config JSON
  - **API Docs**: Documentation links, quick API test buttons
  - **Peer Tools**: Send GET/POST/PUT/DELETE to peer gate URLs (requires both devices reachable from browser); quick-action buttons pre-populate the form
  - Built via `npm run embed:device-ui` → `firmware/shared/include/device_ui.h`; `make build` and `make upload` run this automatically

### Testing

- Node tests use Node's `--test` runner with TypeScript strip-types
- Simulator (`packages/simulator/cli.ts`) generates deterministic overlapping runs for vertical-slice testing
- Firmware compiles as a single environment (`gate`); role and peer MAC are configured at runtime via the web UI

## Development Workflows

### Running a Local Vertical Slice

```sh
npm run simulate                # Generate practice runs with line2 triggers
npm run api:dev                 # Start API in another terminal
# Manual testing via curl or browser
```

### Firmware + Serial Debugging

```sh
make upload-monitor         # Flash and watch serial output
# In another terminal:
make devices                    # List serial ports
```

Serial commands (type in monitor):
- `status`: Print build role and current config
- `wifi`: Show Wi-Fi status
- `scan=<tagId>`: Inject a tag (for testing listen mode or starting a run)

### Device Configuration

After flashing:
1. Connect phone/laptop to the gate's AP (SSID = `Gate-<#>-<mac>`, default password `changeme123`)
2. Open `http://192.168.4.<gateNumber>/` (default: `http://192.168.4.1/`)
3. Use **Gate Config** to set gate number and peer MAC; **Network** to set AP password and station credentials
4. Changes persist to NVS

## Key Technical Details

- **Unified Firmware**: Single PlatformIO app flashed identically to both devices; role and peer MAC configured at runtime via web UI and persisted to NVS
- **Three Timing Metrics**: All timestamps use start gate's `millis()`. Finish gate is a pure detector; it sends finish event, start gate stamps the time on ESP-Now receipt
- **ESP-Now Messaging**: Gates communicate finish events peer-to-peer; operates independently from router-backed Wi-Fi networking; peer MAC set via web UI
- **Dual Sensors on Start Gate**: Line 1 (pin 2) and Line 2 (pin 3); each with 500ms debounce; stampLine2() updates run record without changing status
- **NFC Registration**: Riders stored on-device with deterministic riderId generation (`rider-<tagId>`); 32-entry max capacity
- **Idempotent Cloud Sync**: Offline runs captured with `runId`; HTTP POST to Lambda uses `runId` for deduplication on device side; cloud handles final idempotency
- **REST over MQTT**: Simple HTTP POST chosen over MQTT because: (1) one-shot, unidirectional data flow (device → cloud only), (2) no multi-subscriber pattern, (3) avoids broker infrastructure
- **TypeScript Configuration**: ES2022 target, NodeNext modules, strict mode; no emit (type-checking only)
- **Node Execution**: Uses `--experimental-strip-types` to run `.ts` files directly; no tsc build step needed
- **Launch Metric**: Calculated as `diffMs(startTriggeredAt, line2TriggeredAt)`; can be null if line2 trigger hasn't occurred yet

## Debugging Tips

- **Firmware build failures**: Check `make clean` first; verify PlatformIO core with `make pio-info`
- **USB device not found on WSL**: Run `make attach-usb` to auto-detect and attach via usbipd
- **Serial monitor showing garbage**: Verify baud rate is 115200 and device is in CDC mode
- **Tests failing**: Ensure all workspaces are installed (`npm install` at root) and TypeScript strict mode is satisfied
- **Line2 not triggering in simulator**: Verify triggerLine2() calls are present in cli.ts between triggerStart() and triggerFinish()
- **Launch metric is null in results**: Check that line2TriggeredAt was set; if not, run did not reach line 2

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.
<!-- END BEADS CODEX SETUP -->
