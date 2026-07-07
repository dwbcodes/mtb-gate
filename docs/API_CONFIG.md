# GET /api/config

Returns the full device configuration. Passwords are redacted as `"***"` for security.

## Request

```
GET /api/config
```

No body required.

## Response

```json
{
  "deviceId": "gate-1234",
  "deviceLabel": "Start Gate",
  "role": "start",
  "apSsid": "MTBGate-gate-1234",
  "apPassword": "***",
  "staSsid": "MyNetwork",
  "staPassword": "***",
  "startThreshold": 0.85,
  "line2Threshold": 0.85,
  "finishThreshold": 0.85,
  "wifiChannel": 6,
  "peerMac": "0c:4e:a0:66:a4:14"
}
```

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | Unique device ID (auto-generated, read-only) |
| `deviceLabel` | string | User-friendly device name |
| `role` | string | Gate role: `start`, `finish`, or `intermediate` |
| `apSsid` | string | Access point SSID (must be 1-32 chars) |
| `apPassword` | string | AP password (always returned as `***` for security) |
| `staSsid` | string | Station network SSID to join (empty = don't connect) |
| `staPassword` | string | Station password (always returned as `***`) |
| `startThreshold` | number | Sensor trip threshold for start gate (0.00–2.00) |
| `line2Threshold` | number | Sensor trip threshold for line 2 (0.00–2.00) |
| `finishThreshold` | number | Sensor trip threshold for finish gate (0.00–2.00) |
| `wifiChannel` | number | Wi-Fi channel (1–13) |
| `peerMac` | string | Peer gate MAC address (AA:BB:CC:DD:EE:FF format, empty = auto-discover) |

## Validation

None — this is a read-only query.

## Security Note

Real passwords are stored in NVS but never exposed via the API; only `***` is returned. To update passwords, use the individual config endpoints (`PUT /api/config/wifi`).

## Serial Equivalent

```
> config
{
  "deviceId":"gate-1234",
  "role":"start",
  "apSsid":"MTBGate-gate-1234",
  "apPassword":"***",
  "staSsid":"MyNetwork",
  "staPassword":"***",
  "startThreshold":0.85,
  "line2Threshold":0.85,
  "finishThreshold":0.85,
  "wifiChannel":6,
  "peerMac":"0c:4e:a0:66:a4:14"
}
```

## Examples

### curl

```sh
curl http://192.168.4.1/api/config | jq .
```

### Response example

```json
{
  "deviceId": "gate-a1b2",
  "deviceLabel": "Start Gate",
  "role": "start",
  "apSsid": "MTBGate-gate-a1b2",
  "apPassword": "***",
  "staSsid": "",
  "staPassword": "***",
  "startThreshold": 0.85,
  "line2Threshold": 0.85,
  "finishThreshold": 0.85,
  "wifiChannel": 1,
  "peerMac": ""
}
```
