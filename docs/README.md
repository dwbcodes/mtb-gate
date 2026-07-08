# MTB Gate API Documentation

Complete REST API documentation for MTB Gate timing system.

## Quick Links

### API Overview
- **[API.md](API.md)** — Main API reference, base URL, response format, status codes

### OpenAPI Specification
- **[openapi.yaml](openapi.yaml)** — OpenAPI 3.0 specification (YAML format)
  - Use with Swagger UI, Redoc, or other OpenAPI tools
  - Includes all endpoints, schemas, validation rules
  - Supports code generation (e.g., `openapi-generator`)

### Endpoint Documentation

#### Device Status & Configuration
- **[API_STATUS.md](API_STATUS.md)** — `GET /api/status` — Device status (uptime, MAC, ESP-Now state)
- **[API_CONFIG.md](API_CONFIG.md)** — `GET /api/config` — Full configuration (passwords redacted)
- **[API_WIFI.md](API_WIFI.md)** — `PUT /api/config/wifi` — Update Wi-Fi settings
- **[API_MAC.md](API_MAC.md)** — `PUT /api/config/mac` — Update peer MAC and role
- **[API_TIME.md](API_TIME.md)** — `PUT /api/config/time` — Update sensor trigger calibration

#### Rider Management
- **[API_RIDERS.md](API_RIDERS.md)** — GET/POST/DELETE `/api/riders` — Manage rider roster

#### Diagnostics
- **[API.md](API.md#post-apipping)** — `POST /api/ping` — Send test ping to peer

## Base URL

```
http://192.168.4.1/api
```

Connect to the gate's Wi-Fi access point (default SSID: `MTBGate-<device-id>`, password: `changeme123`).

## Content-Type

All requests and responses use `application/json; charset=utf-8`.

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (validation error) |
| 404 | Not found |
| 405 | Method not allowed |

## Authentication

None required (gates are in a closed Wi-Fi network).

## Examples

### Check device status
```sh
curl http://192.168.4.1/api/status | jq .
```

### Update Wi-Fi settings
```sh
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apSsid":"MyGate","apPassword":"secure123"}'
```

### Register a rider
```sh
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave Wilson"}'
```

### List all riders
```sh
curl http://192.168.4.1/api/riders | jq .
```

### Test ESP-Now link
```sh
curl -X POST http://192.168.4.1/api/ping
```

## Serial Mirror Commands

For offline debugging or serial access, all API operations have serial equivalents:

```
status              # Full device status (JSON)
config              # Full configuration (JSON)
riders              # List all riders (JSON)
riders.add <id> <name>  # Register/update rider
riders.del <id>     # Remove rider
ping                # Send test ping to peer
wifi                # Show Wi-Fi status
help                # Show all commands
```

Example:
```
Type on device serial monitor (115200 baud):
> status
{
  "deviceId":"gate-1234",
  "role":"start",
  ...
}
```

## Implementation Details

- **Authentication**: None (closed network)
- **Response envelope**: Direct JSON (no wrapper)
- **Validation**: All inputs validated on device
- **Persistence**: All changes saved to NVS (survives power cycles)
- **Limits**: 32 riders max per device, all threshold ranges 0.00–2.00 V
- **Passwords**: Never exposed via API (redacted as `***`)

## See Also

- [AGENTS.md](../AGENTS.md) — Project architecture and build commands
- [CLAUDE.md](../CLAUDE.md) — Development instructions
