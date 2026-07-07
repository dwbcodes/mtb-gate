# GET /api/status

Returns full device status including uptime, network configuration, and ESP-Now link state.

## Request

```
GET /api/status
```

No body required.

## Response

```json
{
  "deviceId": "gate-1234",
  "deviceLabel": "Start Gate",
  "role": "start",
  "mac": "dc:b4:d9:9c:48:ec",
  "uptimeMs": 123456789,
  "apSsid": "MTBGate-gate-1234",
  "apIp": "192.168.4.1",
  "staSsid": "MyNetwork",
  "staIp": "192.168.1.100",
  "espNow": {
    "connected": true,
    "peerMac": "0c:4e:a0:66:a4:14",
    "timeSinceSyncMs": 5000,
    "rttMs": 14,
    "clockOffsetMs": 8,
    "retries": 0
  }
}
```

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | Unique device ID (auto-generated from MAC) |
| `deviceLabel` | string | User-friendly device name |
| `role` | string | Gate role: `start`, `finish`, or `intermediate` |
| `mac` | string | Device's own MAC address |
| `uptimeMs` | number | Milliseconds since boot |
| `apSsid` | string | Access point SSID |
| `apIp` | string | Access point IP address |
| `staSsid` | string | Connected station network name (empty if not configured) |
| `staIp` | string | Station network IP (0.0.0.0 if not connected) |
| `espNow.connected` | boolean | `true` if peer heard from in last 60 seconds |
| `espNow.peerMac` | string | Configured peer MAC address |
| `espNow.timeSinceSyncMs` | number | Milliseconds since last Ping/Pong exchange |
| `espNow.rttMs` | number | Round-trip latency to peer (start gate only) |
| `espNow.clockOffsetMs` | number | Time correction vs. start gate (non-start gates only) |
| `espNow.retries` | number | Current retry count (0 if not retrying) |

## Validation

None — this is a read-only query.

## Serial Equivalent

```
> status
{
  "deviceId":"gate-1234",
  "role":"start",
  "apSsid":"MTBGate-gate-1234",
  "apIp":"192.168.4.1",
  "staSsid":"MyNetwork",
  "staIp":"192.168.1.100",
  "uptimeMs":123456789
}
```

## Examples

### curl

```sh
curl http://192.168.4.1/api/status | jq .
```

### Response example (start gate, connected)

```json
{
  "deviceId": "gate-3c0a",
  "deviceLabel": "Start Gate",
  "role": "start",
  "mac": "dc:b4:d9:9c:48:ec",
  "uptimeMs": 234567,
  "apSsid": "MTBGate-gate-3c0a",
  "apIp": "192.168.4.1",
  "staSsid": "",
  "staIp": "0.0.0.0",
  "espNow": {
    "connected": true,
    "peerMac": "0c:4e:a0:66:a4:14",
    "timeSinceSyncMs": 2345,
    "rttMs": 14,
    "clockOffsetMs": 0,
    "retries": 0
  }
}
```

### Response example (finish gate, connected)

```json
{
  "deviceId": "gate-7d2b",
  "deviceLabel": "Finish Gate",
  "role": "finish",
  "mac": "0c:4e:a0:66:a4:14",
  "uptimeMs": 567890,
  "apSsid": "MTBGate-gate-7d2b",
  "apIp": "192.168.4.1",
  "staSsid": "",
  "staIp": "0.0.0.0",
  "espNow": {
    "connected": true,
    "peerMac": "dc:b4:d9:9c:48:ec",
    "timeSinceSyncMs": 1234,
    "rttMs": 0,
    "clockOffsetMs": 8,
    "retries": 0
  }
}
```
