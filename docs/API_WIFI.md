# PUT /api/config/wifi

Update Wi-Fi network settings: access point SSID/password, station network, and Wi-Fi channel. Changes take effect immediately; device restarts Wi-Fi.

## Request

```
PUT /api/config/wifi
Content-Type: application/json

{
  "apSsid": "MyGate",
  "apPassword": "secure123",
  "staSsid": "HomeNetwork",
  "staPassword": "homewifi",
  "wifiChannel": 6
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `apSsid` | string | Yes | 1–32 characters |
| `apPassword` | string | No | Empty string or ≥8 characters |
| `staSsid` | string | No | 1–32 characters (empty = don't join a network) |
| `staPassword` | string | No | Empty string or ≥8 characters (ignored if staSsid is empty) |
| `wifiChannel` | number | No | 1–13 |

## Response (Success)

```json
{
  "ok": true
}
```

## Response (Error)

```json
{
  "error": "apPassword must be empty or >=8 chars"
}
```

## Validation Rules

- `apSsid`: Required, must be non-empty
- `apPassword`: Must be empty or ≥8 characters
- `staSsid`: If specified, can be any length; if empty, `staPassword` is ignored
- `staPassword`: If `staSsid` is provided, password must be present and ≥8 chars (or empty to skip)
- `wifiChannel`: Must be 1–13

## Side Effects

1. Configuration saved to NVS
2. Wi-Fi stack restarted (AP and STA networks reconfigured)
3. ESP-Now peer re-registered on the new channel
4. Device may briefly disconnect and reconnect

## Serial Equivalent

None (Wi-Fi is device-specific and not mirrored via serial).

## Examples

### curl — Update only AP password

```sh
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apSsid":"MTBGate","apPassword":"newpass123"}'
```

### curl — Configure station network

```sh
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{
    "apSsid":"MTBGate",
    "apPassword":"localpass1",
    "staSsid":"CampNetwork",
    "staPassword":"camppass1",
    "wifiChannel":11
  }'
```

### Error: Password too short

```sh
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apSsid":"MTBGate","apPassword":"short"}'
```

Response:
```json
{
  "error": "apPassword must be empty or >=8 chars"
}
```

### Error: No AP SSID

```json
{
  "error": "apSsid required"
}
```

### Error: Invalid channel

```json
{
  "error": "wifiChannel must be 1-13"
}
```

## Notes

- The device will always host an access point; the AP cannot be disabled
- If `staSsid` is empty, the device will not attempt to join an external network
- Wi-Fi channel applies to both AP and ESP-Now peer communication
- If peer MAC is configured, the device automatically re-registers the peer on the new channel
