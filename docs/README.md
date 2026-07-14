# MTB Gate Documentation

All project documentation lives in this directory. Architecture, build commands, and agent instructions live in [AGENTS.md](../AGENTS.md) at the repo root.

## Device REST API

- **[API.md](API.md)** — Full API reference: base URL, conventions, and the complete route table
- **[openapi.yaml](openapi.yaml)** / **[openapi.json](openapi.json)** — OpenAPI 3.0 spec (Swagger UI / Redoc / codegen)
- **[CURL_EXAMPLES.md](CURL_EXAMPLES.md)** — Copy-paste curl recipes

Per-endpoint detail:

- **[API_STATUS.md](API_STATUS.md)** — `GET /api/status`
- **[API_CONFIG.md](API_CONFIG.md)** — `GET /api/config`
- **[API_WIFI.md](API_WIFI.md)** — `PUT /api/config/wifi`
- **[API_MAC.md](API_MAC.md)** — `PUT /api/config/mac` (gate number + peer MAC)
- **[API_TIME.md](API_TIME.md)** — `PUT /api/config/time` (trigger calibration)
- **[API_RIDERS.md](API_RIDERS.md)** — `GET/POST/DELETE /api/riders`

These API docs (plus `openapi.json`) are embedded into the firmware by `npm run embed:device-ui` and served by the gate itself under `/docs/...` — keep them accurate and small.

## Guides & Hardware

- **[USER_GUIDE.md](USER_GUIDE.md)** — End-user guide: setup, riders, sessions, troubleshooting (embedded in firmware, shown on the device UI's Monitor → User Guide page)
- **[RIDER_REGISTRATION.md](RIDER_REGISTRATION.md)** — Registering riders via NFC, API, or serial
- **[NFC_TROUBLESHOOTING.md](NFC_TROUBLESHOOTING.md)** — PN532 wiring and diagnosis
- **[BUZZER.md](BUZZER.md)** — Buzzer wiring and countdown audio pattern
- **[parts/](parts/README.md)** — Component datasheets (MPXV7002 pressure sensor, PN532 NFC)

## Quick Reference

### Connecting to a gate

1. Join the gate's AP: SSID = device ID (`Gate-<#>-<mac>`, e.g. `Gate-Start-a1b2c3d4e5f6`), default password `changeme123`
2. Open `http://192.168.4.<gateNumber>/` (start gate: `http://192.168.4.1/`)

### Serial console (115200 baud)

```
api status | api config | api riders | api runs | api storage | api ping
api config/wifi <json> | api config/time <json> | api config/mac <json>
api riders/add <json>  | api riders/delete <json>
status | wifi | calibrate | adc | reboot | scan=<tagId>
```

## Implementation Notes

- **Authentication**: none (closed network); passwords never leave the device (redacted as `***`)
- **Persistence**: config and riders in NVS; events/runs in LittleFS session directories
- **Limits**: 32 riders, 8 queued runs, 50-entry reads on event/run endpoints
