# GET /api/config

Returns the full device configuration. Passwords are redacted as `"***"`.

## Request

```
GET /api/config
```

No body required.

## Response

```json
{
  "deviceId": "Gate-Start-a1b2c3d4e5f6",
  "deviceLabel": "Gate Start",
  "gateNumber": 1,
  "role": "start",
  "apPassword": "***",
  "staSsid": "MyNetwork",
  "staPassword": "***",
  "startThreshold": 2.0,
  "finishThreshold": 2.0,
  "line2Threshold": 2.0,
  "triggerDelta": 0.30,
  "wifiChannel": 6,
  "peerMac": "0C:4E:A0:66:A4:14"
}
```

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | `Gate-<#>-<mac>` — derived from `gateNumber` + eFuse MAC, read-only. Also the AP SSID |
| `deviceLabel` | string | Derived from `gateNumber` (`Gate Start` / `Gate Finish` / `Gate <n>`) |
| `gateNumber` | number | 1–254. **Source of truth**: role, deviceId, and label are all derived from it (1 = start, 12 = finish, else intermediate) |
| `role` | string | `start`, `finish`, or `intermediate` (derived, read-only) |
| `apPassword` | string | Always returned as `***` |
| `staSsid` | string | Station network SSID to join (empty = don't connect) |
| `staPassword` | string | Always returned as `***` |
| `startThreshold` / `line2Threshold` / `finishThreshold` | number | Legacy absolute thresholds kept for old backups/test clients; not used by the current trigger logic |
| `triggerDelta` | number | Active sensor trigger delta in volts from the rolling baseline |
| `wifiChannel` | number | Wi-Fi/ESP-Now channel (1–13) |
| `peerMac` | string | Peer gate MAC (`AA:BB:CC:DD:EE:FF`, empty = auto-discover) |

Note: the AP SSID is not in this payload because it is not independently configurable — it always equals `deviceId` (see `GET /api/status`).

## Security Note

Real passwords are stored in NVS but never exposed via the API. To update them use `PUT /api/config/wifi`. This also means a config backup downloaded from the API cannot restore passwords — see the restore flow in the device UI Reset page.

## Serial Equivalent

```
> api config
```

## Example

```sh
curl http://192.168.4.1/api/config | jq .
```
