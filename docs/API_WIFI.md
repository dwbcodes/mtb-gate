# PUT /api/config/wifi

Update Wi-Fi settings: AP password, station network credentials, and Wi-Fi channel. The device restarts its network stack after responding.

The **AP SSID is not configurable** — it always equals the device ID (`Gate-<#>-<mac>`), so gates stay identifiable. To change it, change the gate number via `PUT /api/config/mac`.

## Request

```
PUT /api/config/wifi
Content-Type: application/json

{
  "apPassword": "secure123",
  "staSsid": "HomeNetwork",
  "staPassword": "homewifi1",
  "wifiChannel": 6
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `apPassword` | string | No | Empty string (open AP) or ≥8 characters |
| `staSsid` | string | No | Station network to join (empty = don't join) |
| `staPassword` | string | No | Station password |
| `wifiChannel` | number | No | 1–13; used by both the AP and ESP-Now |

Omitted fields are left unchanged.

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

or

```json
{
  "error": "wifiChannel must be 1-13"
}
```

## Side Effects

1. Configuration saved to NVS
2. Networking restarted after the response is sent (AP + STA reconfigured); expect a brief disconnect
3. Non-start gates auto-adopt the start gate's channel from its ESP-Now Ping, so in practice you only need to set the channel on the start gate

## Serial Equivalent

```
> api config/wifi {"staSsid":"HomeNetwork","staPassword":"homewifi1"}
```

## Examples

```sh
# Change the AP password
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"apPassword":"newpass123"}'

# Join a station network
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"staSsid":"CampNetwork","staPassword":"camppass1"}'

# Leave the station network
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H 'Content-Type: application/json' \
  -d '{"staSsid":""}'
```
