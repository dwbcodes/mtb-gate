# GET /api/status

Returns full device status: identity, uptime, network state, ESP-Now link state, and the live run queue.

## Request

```
GET /api/status
```

No body required.

## Response

```json
{
  "deviceId": "Gate-Start-a1b2c3d4e5f6",
  "deviceLabel": "Gate Start",
  "role": "start",
  "mac": "DC:B4:D9:9C:48:EC",
  "uptimeMs": 234567,
  "apSsid": "Gate-Start-a1b2c3d4e5f6",
  "apIp": "192.168.4.1",
  "staSsid": "",
  "staIp": "0.0.0.0",
  "startThreshold": 2.0,
  "finishThreshold": 2.0,
  "line2Threshold": 2.0,
  "triggerDelta": 0.30,
  "espNow": {
    "configured": true,
    "peerMac": "0C:4E:A0:66:A4:14",
    "lastRttMs": 14,
    "lastSyncAgoMs": 2345,
    "reachable": true,
    "wifiChannel": 1
  },
  "queue": [
    {
      "runId": "Gate-Start-a1b2c3d4e5f6-rider-04AB12CD-123456",
      "riderId": "rider-04AB12CD",
      "riderName": "Dave Wilson",
      "status": "OnCourse",
      "metrics": {
        "reactionMs": 640,
        "launchMs": null,
        "courseMs": null
      }
    }
  ]
}
```

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `deviceId` | string | `Gate-<#>-<mac>`; gate 1 renders as `Gate-Start-<mac>` and gate 12 as `Gate-Finish-<mac>`. Derived from gate number + eFuse MAC; also used as the AP SSID |
| `deviceLabel` | string | Derived label (`Gate Start`, `Gate Finish`, or `Gate <n>`) |
| `role` | string | `start`, `finish`, or `intermediate` (derived from gate number) |
| `mac` | string | Device's own Wi-Fi MAC address |
| `uptimeMs` | number | Milliseconds since boot |
| `apSsid` | string | Access point SSID (always equals `deviceId`) |
| `apIp` | string | AP IP: `192.168.4.<gateNumber>` |
| `staSsid` | string | Configured station network (empty if not configured) |
| `staIp` | string | Station IP (`0.0.0.0` if not connected) |
| `startThreshold` / `finishThreshold` / `line2Threshold` | number | Legacy absolute thresholds; not the active trigger path |
| `triggerDelta` | number | Active trigger delta (volts from rolling baseline) |
| `espNow.configured` | boolean | `true` once a peer MAC is set (manually or by auto-discovery) |
| `espNow.peerMac` | string | Peer gate MAC |
| `espNow.lastRttMs` | number | Last measured clock-sync round-trip (start gate only) |
| `espNow.lastSyncAgoMs` | number | Milliseconds since the last completed sync (`-1` = never) |
| `espNow.reachable` | boolean | `true` if a sync completed within the last 60 seconds |
| `espNow.wifiChannel` | number | Channel used for ESP-Now (shared with Wi-Fi AP) |
| `queue[]` | array | Live runs; `status` is one of `Queued`, `Countdown`, `AwaitingStart`, `OnCourse`, `Finished`, `TimedOut`, `Cancelled`. Metrics are `null` until both of their timestamps exist |

## Serial Equivalent

```
> api status
```

Prints the same JSON on the serial console (115200 baud).

## Example

```sh
curl http://192.168.4.1/api/status | jq .

# Peer reachability check
curl -s http://192.168.4.1/api/status | jq '.espNow.reachable'
```
