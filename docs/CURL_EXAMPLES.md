# MTB Gate API — curl Examples

Quick reference for testing the API with curl.

## Setup

Connect to the gate's Wi-Fi AP first (SSID = device ID, e.g. `Gate-Start-a1b2c3d4e5f6`). The start gate is at `192.168.4.1`; other gates at `192.168.4.<gateNumber>`.

```sh
GATE="http://192.168.4.1/api"
```

## Status & Configuration

### Get device status
```sh
curl $GATE/status | jq .
```

Output (abridged):
```json
{
  "deviceId": "Gate-Start-a1b2c3d4e5f6",
  "role": "start",
  "mac": "DC:B4:D9:9C:48:EC",
  "apSsid": "Gate-Start-a1b2c3d4e5f6",
  "apIp": "192.168.4.1",
  "triggerDelta": 0.30,
  "espNow": {
    "configured": true,
    "peerMac": "0C:4E:A0:66:A4:14",
    "lastRttMs": 14,
    "lastSyncAgoMs": 2345,
    "reachable": true,
    "wifiChannel": 1
  },
  "queue": []
}
```

### Get full configuration
```sh
curl $GATE/config | jq .
```

### Extract just the device ID
```sh
curl -s $GATE/status | jq -r '.deviceId'
```

### Check if the peer is reachable
```sh
curl -s $GATE/status | jq '.espNow.reachable'
```

## Wi-Fi Configuration

The AP SSID is not configurable (it always equals the device ID).

### Update AP password
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apPassword":"newpass123"}'
```

### Join a station network
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"staSsid":"CampNetwork","staPassword":"camppass1"}'
```

### Change Wi-Fi channel (set on the start gate; peers auto-adopt)
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"wifiChannel": 6}'
```

### Leave the station network
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"staSsid": ""}'
```

## Gate Number & Peer MAC

### Make a device the finish gate (reboots)
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"gateNumber":12}'
```

### Set peer MAC explicitly
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":"DC:B4:D9:9C:48:EC"}'
```

### Clear peer MAC (enable auto-discovery)
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":""}'
```

## Sensor Calibration

Guided calibration runs via the serial `calibrate` command (no HTTP endpoint); the boot sequence also auto-seeds `triggerDelta` from idle noise.

### Set trigger delta manually
```sh
curl -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta": 0.25}'
```

## Rider Management

### List all riders
```sh
curl $GATE/riders | jq .
```

### Register or update a rider
```sh
curl -X POST $GATE/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"04AB12CD","displayName":"Dave Wilson"}'
```

### Delete a rider
```sh
curl -X DELETE "$GATE/riders?tagId=04AB12CD"
```

### Delete all riders
```sh
curl -s $GATE/riders | jq -r '.[].tagId' | while read tagId; do
  curl -X DELETE "$GATE/riders?tagId=$tagId"
done
```

## Runs & Results

### Start a run for a registered rider (start gate)
```sh
curl -X POST $GATE/results \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"04AB12CD"}'
```

### Cancel the active run
```sh
curl -X POST $GATE/results/stop
```

### Recent results (live + persisted)
```sh
curl "$GATE/results?limit=10" | jq .
```

### Delete a run
```sh
curl -X DELETE $GATE/results \
  -H 'Content-Type: application/json' \
  -d '{"runId":"<runId from /api/results>"}'
```

## Peer Diagnostics

### Full ESP-Now link report
```sh
curl -X POST $GATE/peer/test | jq .
```

### Request a clock sync
```sh
curl -X POST $GATE/peer/sync
```

### Watch peer reachability
```sh
watch -n 1 "curl -s $GATE/status | jq '.espNow.reachable'"
```

## Storage

### Filesystem usage
```sh
curl $GATE/storage | jq .
```

### List sessions and download a session's runs
```sh
curl $GATE/sessions | jq .
curl "$GATE/sessions/file?num=3&file=runs.jsonl"
```

## Error Handling

### Detect validation errors
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apPassword":"short"}' | jq '.error'
# "apPassword must be empty or >=8 chars"
```

### Check HTTP status code
```sh
curl -s -o /dev/null -w "%{http_code}" \
  -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta":0}'
# 400
```

## See Also

- [API.md](API.md) — Full API reference and route table
- [openapi.yaml](openapi.yaml) — OpenAPI spec (Swagger UI, Redoc, etc.)
