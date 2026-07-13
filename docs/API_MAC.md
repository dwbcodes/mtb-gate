# PUT /api/config/mac

Update the gate number and/or peer MAC address. Role, device ID, device label, and AP SSID are all **derived from the gate number** — they cannot be set directly. Saving this config **reboots the device** so the new identity takes effect everywhere (AP SSID, AP IP, ESP-Now).

## Request

```
PUT /api/config/mac
Content-Type: application/json

{
  "gateNumber": 12,
  "peerMac": "DC:B4:D9:9C:48:EC"
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `gateNumber` | number | No | 1–254. 1 = start gate, 12 = finish gate, anything else = intermediate |
| `peerMac` | string | No | `AA:BB:CC:DD:EE:FF` format (17 chars) or empty string (= auto-discover) |

Omitted fields are left unchanged. Even if only `peerMac` is sent, deviceId/role/label are re-derived from the current gate number.

## Response (Success)

```json
{
  "ok": true,
  "rebooting": true
}
```

The device reboots shortly after responding.

## Response (Error)

```json
{
  "error": "peerMac must be AA:BB:CC:DD:EE:FF format"
}
```

or

```json
{
  "error": "gateNumber must be 1-254"
}
```

## Derived Values

| gateNumber | role | deviceId | deviceLabel |
|------------|------|----------|-------------|
| 1 | `start` | `Gate-Start-<mac>` | `Gate Start` |
| 12 | `finish` | `Gate-Finish-<mac>` | `Gate Finish` |
| other (2–11, 13–254) | `intermediate` | `Gate-<n>-<mac>` | `Gate <n>` |

The AP IP also follows the gate number: `192.168.4.<gateNumber>`.

## Auto-discovery (recommended)

Leave `peerMac` empty on non-start gates. The start gate broadcasts an ESP-Now Ping every 10 seconds; other gates auto-adopt the start gate's MAC (and Wi-Fi channel) on the first Ping they hear and persist it. The start gate likewise auto-registers any responding peer.

## Serial Equivalent

```
> api config/mac {"gateNumber":12,"peerMac":""}
```

## Examples

```sh
# Make this device the finish gate (auto-discover peer), reboots
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"gateNumber":12,"peerMac":""}'

# Pin the peer MAC explicitly
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":"DC:B4:D9:9C:48:EC"}'
```
