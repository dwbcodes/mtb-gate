# MTB Gate REST API

## Overview

MTB Gate provides a fully-featured REST API for device configuration, status monitoring, and rider management. All endpoints return JSON, and all state-changing operations are mirrored via serial commands for offline/debug use.

## Base URL

```
http://192.168.4.1/api
```

The gate device hosts its own Wi-Fi access point (default SSID: `MTBGate-<device-id>`, password: `changeme123`). Connect to this network to access the API.

## Authentication

No authentication is required (gates are in a closed network).

## Content-Type

All requests and responses use `application/json; charset=utf-8`.

## Response Envelope

All API responses are direct JSON (no wrapper envelope). Errors include an `error` field:

```json
{
  "error": "Device label is required"
}
```

## Status Codes

- **200**: Success
- **400**: Bad request (validation error)
- **404**: Not found (e.g., rider does not exist)
- **405**: Method not allowed

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/status` | Full device status (uptime, MAC, ESP-Now state) |
| `GET` | `/api/config` | Full configuration (passwords redacted) |
| `PUT` | `/api/config/wifi` | Update Wi-Fi SSID/password and channel |
| `PUT` | `/api/config/mac` | Update peer MAC and gate role |
| `PUT` | `/api/config/time` | Update sensor thresholds |
| `GET` | `/api/riders` | List all registered riders |
| `POST` | `/api/riders` | Register or update a rider |
| `DELETE` | `/api/riders` | Remove a rider |
| `POST` | `/api/ping` | Send test ping to peer (verify ESP-Now link) |

## Serial Mirror Commands

Every API endpoint has a serial equivalent for debugging and offline use. See individual endpoint docs.

## Examples

### Get device status
```sh
curl http://192.168.4.1/api/status
```

### Update Wi-Fi settings
```sh
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apSsid":"MyGate","apPassword":"secure123","wifiChannel":6}'
```

### Register a rider
```sh
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave Wilson"}'
```

### Get all riders
```sh
curl http://192.168.4.1/api/riders
```

### Remove a rider
```sh
curl -X DELETE http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001"}'
```

---

See individual endpoint documentation for full details:
- [API_STATUS.md](API_STATUS.md) - Status endpoint
- [API_CONFIG.md](API_CONFIG.md) - Config endpoint
- [API_WIFI.md](API_WIFI.md) - Wi-Fi configuration
- [API_MAC.md](API_MAC.md) - MAC and role configuration
- [API_TIME.md](API_TIME.md) - Sensor thresholds
- [API_RIDERS.md](API_RIDERS.md) - Rider management
