# MTB Gate

MTB Gate is a monorepo for an MTB standing-start timing system: two or more ESP32 gates (start and finish) communicating over ESP-Now, NFC rider identification, offline-first attempt capture, and AWS-backed results.

A rider taps an NFC tag at the start gate, gets a voice/buzzer countdown, and crosses pressure-tube sensors at the start and finish lines. The start gate owns all timestamps and displays three metrics per run: reaction (GO → line 1), launch (line 1 → line 2), and course (line 1 → finish).

**Full architecture, build commands, and agent instructions live in [AGENTS.md](AGENTS.md). All other documentation lives in [docs/](docs/README.md).**

## Workspaces

- `firmware/` — PlatformIO ESP32-C3 firmware; a single unified `gate` binary for every device
- `packages/contracts` — shared wire contracts and domain helpers
- `packages/simulator` — local practice-session simulator for overlapping runs
- `services/api` — local dev server + Lambda-oriented handlers for cloud sync
- `services/infra` — AWS CDK entrypoint scaffold (design placeholder, no CDK deps yet)
- `apps/device-ui` — captive-portal SPA embedded into and served by the firmware
- `apps/cloud-results` — static cloud day-results UI

## Quick Start

```sh
npm install
npm test                 # Node tests (TypeScript via --experimental-strip-types)
npm run simulate         # deterministic overlapping-run simulation
npm run api:dev          # local sync API on :8787

make build               # build unified gate firmware (runs embed:device-ui first)
make upload              # flash both devices (/dev/ttyACM0 and /dev/ttyACM1)
make upload-monitor      # flash one device, then open serial monitor
make check               # tests + firmware build
```

Hardware-in-the-loop tests (see `.env.example` for configuration):

```sh
make test-device               # serial console API tests on both devices
make test-device-destructive   # opt-in multi-gate topology tests (MTB_GATE_DESTRUCTIVE=1)
```

## Device Setup

Both gates run **identical firmware**. Role, gate number, and peer MAC are runtime configuration (web UI or API), persisted to NVS — there is no per-role build.

1. Flash both devices: `make upload`
2. Join a gate's Wi-Fi AP — SSID is the device ID (`Gate-<#>-<mac>`, e.g. `Gate-Start-a1b2c3d4e5f6`), default password `changeme123`
3. Open `http://192.168.4.<gateNumber>/` (a fresh device is gate 1 → `http://192.168.4.1/`)
4. On the **Gate Config** page set the gate number (1 = start, 2–11 = intermediate, 12 = finish); the device derives its role/ID/label and reboots
5. Peer MAC can be left empty — the start gate broadcasts a discovery ping every 10 s and gates pair (and adopt the Wi-Fi channel) automatically

Timing runs over ESP-Now, independent of any router; Wi-Fi is only for configuration and cloud sync. Runs are captured offline to the device filesystem and uploadable later with idempotent `runId`s.

## API-first development

All product behavior is designed API-first: anything a web page shows or changes must go through an explicit API endpoint.

- Device UI features call the firmware's `/api/...` routes; cloud UI features call the service API
- Request/response shapes that cross package, firmware, simulator, or service boundaries belong in `packages/contracts`
- A UI control is not complete until its API route, validation, response shape, and tests are in place
- Full REST API reference: [docs/API.md](docs/API.md) (also served by the gate itself under `/docs/`)
