# MTB Gate REST API

## Overview

Every gate serves this REST API for configuration, status monitoring, rider management, run results, calibration, and peer diagnostics. All endpoints return JSON. Core operations are mirrored as serial console commands for offline/debug use.

## Base URL

```
http://192.168.4.<gateNumber>/api
```

Each gate hosts its own Wi-Fi access point. The SSID always equals the device ID (`Gate-<#>-<mac>`, e.g. `Gate-Start-a1b2c3d4e5f6`); the default password is `changeme123`. The AP IP is `192.168.4.<gateNumber>` — the start gate (gate 1) is `http://192.168.4.1/`. If a station network is configured, the same API is reachable at the gate's station IP.

## Authentication

None (gates run on a closed network). CORS is enabled.

## Content-Type

All requests and responses use `application/json; charset=utf-8`.

## Response Envelope

Responses are direct JSON (no wrapper). Errors include an `error` field:

```json
{ "error": "wifiChannel must be 1-13" }
```

## Status Codes

- **200**: Success
- **400**: Bad request (validation error)
- **404**: Not found
- **405**: Method not allowed
- **409**: Conflict (e.g. calibration already running, start-gate-only command, no active run)
- **503**: Hardware unavailable (e.g. NFC reader not detected)

## Endpoints

### Status & Configuration

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/status` | Device status, network + ESP-Now state, live run queue ([details](API_STATUS.md)) |
| `GET` | `/api/config` | Full configuration, passwords redacted ([details](API_CONFIG.md)) |
| `PUT` | `/api/config/wifi` | AP password, station credentials, Wi-Fi channel ([details](API_WIFI.md)) |
| `PUT` | `/api/config/mac` | Gate number and peer MAC; reboots the device ([details](API_MAC.md)) |
| `PUT` | `/api/config/time` | Sensor trigger calibration (`triggerDelta`) ([details](API_TIME.md)) |
| `POST` | `/api/reboot` | Reboot the device |

### Riders

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/riders` | List registered riders ([details](API_RIDERS.md)) |
| `POST` | `/api/riders` | Register/update a rider (upsert by `tagId`) |
| `DELETE` | `/api/riders` | Remove a rider (`?tagId=` or JSON body) |

### Runs & Results

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/results?limit=N` | Merged live-queue + persisted runs, newest first (`live` flag per entry) |
| `POST` | `/api/results` | Start a run for a rider (`{"tagId":"..."}`); start gate only |
| `POST` | `/api/results/stop` | Cancel the active run |
| `DELETE` | `/api/results` | Delete a run by `{"runId":"..."}` (live or persisted) |
| `GET` | `/api/runs?limit=N` | Persisted run summaries (newest first, max 50) |
| `GET` | `/api/events?limit=N` | Current-session event log (max 50) |

### Calibration

Sensor calibration has no HTTP endpoints. The device auto-calibrates its idle noise floor on boot; a guided calibration (idle sample, then tube press) runs via the serial `calibrate` command, and `PUT /api/config/time` sets `triggerDelta` directly.

### Peer (ESP-Now) Tools

Most of these are start-gate only (409 otherwise).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/ping` | No-op connectivity check (returns `{"ok":true,"sent":false}`) |
| `POST` | `/api/peer/ping` | Broadcast an ESP-Now discovery ping |
| `POST` | `/api/peer/test` | Sync request + full link report (RTT, reachability, clock state) |
| `POST` | `/api/peer/sync` | Request clock sync with the peer |
| `POST` | `/api/peer/clock` | Request clock sync, return last known sync data |
| `GET` | `/api/peer/clock` | Read clock-sync state without triggering a sync |
| `POST` | `/api/peer/riders/sync` | Re-broadcast the rider roster to peers |

### Storage & Files

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/storage` | LittleFS usage and current session number |
| `POST` | `/api/storage/prune` | Prune old sessions (keeps latest 5) |
| `GET` | `/api/sessions` | List recorded sessions with manifests and sync status |
| `GET` | `/api/sessions/file?num=N&file=<name>` | Fetch a session file (`events.jsonl`, `runs.jsonl`, `manifest.json`, `sync.json`) |
| `GET` | `/api/files?path=/` | Browse the device filesystem |
| `GET` | `/api/files/view?path=<p>` | View a file (truncated at 24 KB) |

### NFC & I2C Diagnostics

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/nfc/listen` | Open a 15 s NFC listen window (rider registration flow) |
| `GET` | `/api/nfc/tag` | Poll for the tag scanned during the listen window |
| `GET` | `/api/nfc/diagnostics` | NFC reader init state and wiring hints |
| `GET` | `/api/i2c/scan` | Scan the I2C bus for devices |

## Serial Mirror Commands

Type these on the serial monitor (115200 baud):

```
api status | api config | api riders | api runs | api storage | api ping
api config/wifi <json> | api config/time <json> | api config/mac <json>
api riders/add <json>  | api riders/delete <json>
status | wifi | calibrate | adc | reboot | scan=<tagId> | role=start | role=finish
```

`scan=<tagId>` simulates an NFC scan (starts a run for a registered rider).

## Examples

```sh
# Device status
curl http://192.168.4.1/api/status | jq .

# Register a rider
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"04AB12CD","displayName":"Dave Wilson"}'

# Start a run for that rider
curl -X POST http://192.168.4.1/api/results \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"04AB12CD"}'

# Recent results
curl 'http://192.168.4.1/api/results?limit=10' | jq .

# Check the ESP-Now link
curl -X POST http://192.168.4.1/api/peer/test | jq .
```

---

Detailed per-endpoint docs: [API_STATUS.md](API_STATUS.md) · [API_CONFIG.md](API_CONFIG.md) · [API_WIFI.md](API_WIFI.md) · [API_MAC.md](API_MAC.md) · [API_TIME.md](API_TIME.md) · [API_RIDERS.md](API_RIDERS.md) · [CURL_EXAMPLES.md](CURL_EXAMPLES.md)
