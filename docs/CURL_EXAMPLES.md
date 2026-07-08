# MTB Gate API — curl Examples

Quick reference for testing the API with curl.

## Setup

All examples assume the gate is accessible at `http://192.168.4.1`. Connect to the gate's Wi-Fi AP first.

```sh
# Set up a variable for convenience
GATE="http://192.168.4.1/api"
```

## Status & Configuration

### Get device status
```sh
curl $GATE/status | jq .
```

Output:
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

### Get full configuration
```sh
curl $GATE/config | jq .
```

### Extract just the device ID
```sh
curl -s $GATE/status | jq -r '.deviceId'
# Output: gate-3c0a
```

### Check if connected to peer
```sh
curl -s $GATE/status | jq '.espNow.connected'
# Output: true
```

## Wi-Fi Configuration

### Update AP password only
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apSsid":"MTBGate","apPassword":"newpass123"}'
```

### Configure station network
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{
    "apSsid": "MTBGate",
    "apPassword": "localpass1",
    "staSsid": "CampNetwork",
    "staPassword": "camppass1",
    "wifiChannel": 11
  }'
```

### Change Wi-Fi channel only
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"wifiChannel": 6}'
```

### Disconnect from station network
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"staSsid": ""}'
```

## Peer MAC & Role

### Set peer MAC (on finish gate)
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":"dc:b4:d9:9c:48:ec"}'
```

### Clear peer MAC (enable auto-discovery)
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":""}'
```

### Change gate role
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"role":"finish"}'
```

### Update device label
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"deviceLabel":"Start Gate - Main Track"}'
```

### Update all three at once
```sh
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d '{
    "peerMac":"0c:4e:a0:66:a4:14",
    "role":"finish",
    "deviceLabel":"Finish Gate"
  }'
```

## Sensor Calibration

### Update trigger delta
```sh
curl -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta": 0.25}'
```

### Reduce sensitivity
```sh
curl -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta": 0.40}'
```

### Reset to default
```sh
curl -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta": 0.30}'
```

## Rider Management

### List all riders
```sh
curl $GATE/riders | jq .
```

Output:
```json
[
  {
    "riderId": "rider-tag-001",
    "displayName": "Dave Wilson",
    "tagId": "tag-001"
  },
  {
    "riderId": "rider-tag-002",
    "displayName": "Sarah Chen",
    "tagId": "tag-002"
  }
]
```

### Count riders
```sh
curl -s $GATE/riders | jq 'length'
# Output: 2
```

### Register a single rider
```sh
curl -X POST $GATE/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave Wilson"}'
```

### Register multiple riders
```sh
for i in {1..5}; do
  curl -X POST $GATE/riders \
    -H 'Content-Type: application/json' \
    -d "{\"tagId\":\"tag-$(printf %03d $i)\",\"displayName\":\"Rider $i\"}"
done
```

### Update rider display name
```sh
curl -X POST $GATE/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave W. (Updated)"}'
```

### Get a specific rider
```sh
curl -s $GATE/riders | jq '.[] | select(.tagId == "tag-001")'
```

### Delete a rider
```sh
curl -X DELETE $GATE/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001"}'
```

### Delete all riders
```sh
curl -s $GATE/riders | jq -r '.[].tagId' | while read tagId; do
  curl -X DELETE $GATE/riders \
    -H 'Content-Type: application/json' \
    -d "{\"tagId\":\"$tagId\"}"
done
```

## Diagnostics

### Send test ping to peer
```sh
curl -X POST $GATE/ping
```

Response (success):
```json
{"ok": true}
```

Response (error):
```json
{"error": "Peer MAC not configured"}
```

### Monitor ESP-Now RTT in real time
```sh
while true; do
  clear
  echo "=== ESP-Now Status ==="
  curl -s $GATE/status | jq '.espNow'
  sleep 1
done
```

### Watch for peer connection
```sh
watch -n 1 "curl -s $GATE/status | jq '.espNow.connected'"
```

## Advanced Workflows

### Bootstrap a gate from scratch

1. **Set device label**
   ```sh
   curl -X PUT $GATE/config/mac \
     -H 'Content-Type: application/json' \
     -d '{"deviceLabel":"My Gate"}'
   ```

2. **Update Wi-Fi settings**
   ```sh
   curl -X PUT $GATE/config/wifi \
     -H 'Content-Type: application/json' \
     -d '{
       "apSsid": "MyGate",
       "apPassword": "secure123",
       "wifiChannel": 6
     }'
   ```

3. **Register initial riders**
   ```sh
   curl -X POST $GATE/riders \
     -H 'Content-Type: application/json' \
     -d '{"tagId":"rider-001","displayName":"Alice"}'
   ```

4. **Verify setup**
   ```sh
   curl -s $GATE/config | jq '{deviceLabel, apSsid, wifiChannel}'
   curl -s $GATE/riders | jq 'length'
   ```

### Pair two gates manually

**On Start Gate** (note MAC):
```sh
curl -s $GATE/status | jq -r '.mac'
# Output: dc:b4:d9:9c:48:ec
```

**On Finish Gate** (set Start Gate as peer):
```sh
START_MAC="dc:b4:d9:9c:48:ec"
curl -X PUT $GATE/config/mac \
  -H 'Content-Type: application/json' \
  -d "{\"peerMac\":\"$START_MAC\"}"
```

**Verify connection** (on Finish Gate):
```sh
curl -s $GATE/status | jq '.espNow.connected'
# Should output: true
```

### Calibrate sensors interactively

```sh
#!/bin/bash
# Semi-interactive sensor calibration

while true; do
  echo ""
  echo "Current trigger delta:"
  curl -s $GATE/config | jq '.triggerDelta'
  echo ""
  echo "Enter new trigger delta (or press Enter to skip):"
  read newTriggerDelta

  if [ -n "$newTriggerDelta" ]; then
    curl -X PUT $GATE/config/time \
      -H 'Content-Type: application/json' \
      -d "{\"triggerDelta\":$newTriggerDelta}"
    echo "Updated trigger delta to $newTriggerDelta"
  fi

  echo "Continue? (y/n)"
  read continue
  [ "$continue" != "y" ] && break
done
```

## Error Handling

### Detect validation errors
```sh
curl -X PUT $GATE/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apPassword":"short"}' \
  | jq '.error'
# Output: "apPassword must be empty or >=8 chars"
```

### Check HTTP status code
```sh
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT $GATE/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta":0}')

if [ "$HTTP_CODE" -eq 400 ]; then
  echo "Validation error"
fi
```

### Retry on failure
```sh
curl -X POST $GATE/ping --retry 3 --retry-delay 1
```

## Tips

- Use `jq` for readable output: `curl ... | jq .`
- Use `jq` for filtering: `jq '.espNow.connected'`
- Use `-s` for silent mode: `curl -s $GATE/status`
- Use `-w "%{http_code}"` to capture status codes
- Save responses: `curl ... > response.json`
- Use `watch` for live monitoring: `watch -n 1 "curl ..."`

## See Also

- [API.md](API.md) — Full API reference
- [openapi.yaml](openapi.yaml) — OpenAPI spec (use with Swagger UI, Redoc, etc.)
