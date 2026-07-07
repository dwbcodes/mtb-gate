# PUT /api/config/mac

Update peer MAC address, gate role, and device label. Changes take effect immediately; ESP-Now peer is re-registered.

## Request

```
PUT /api/config/mac
Content-Type: application/json

{
  "peerMac": "0c:4e:a0:66:a4:14",
  "role": "start",
  "deviceLabel": "Start Gate"
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `peerMac` | string | No | AA:BB:CC:DD:EE:FF format or empty string |
| `role` | string | No | `start`, `finish`, or `intermediate` |
| `deviceLabel` | string | No | 1–48 characters |

## Response (Success)

```json
{
  "ok": true
}
```

## Response (Error)

```json
{
  "error": "peerMac must be empty or AA:BB:CC:DD:EE:FF format"
}
```

## Validation Rules

- `peerMac`: Must be exactly 17 characters in `AA:BB:CC:DD:EE:FF` format, or empty (empty = auto-discover from start gate Ping)
- `role`: Must be `start`, `finish`, or `intermediate` (case-insensitive)
- `deviceLabel`: Optional; must be ≤48 characters if provided

## Side Effects

1. Configuration saved to NVS
2. If `peerMac` is valid (17 chars), peer is immediately registered with ESP-Now
3. If `peerMac` is empty, device waits for start gate to send a Ping (which triggers auto-discovery)

## Serial Equivalent

None (role and MAC are core device properties; serial is primarily for debugging).

## Examples

### curl — Set peer MAC

```sh
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":"dc:b4:d9:9c:48:ec"}'
```

### curl — Change role to finish

```sh
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"role":"finish"}'
```

### curl — Clear peer MAC (enable auto-discovery)

```sh
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":""}'
```

### curl — Update all three fields

```sh
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{
    "peerMac":"0c:4e:a0:66:a4:14",
    "role":"finish",
    "deviceLabel":"Finish Gate"
  }'
```

## Error Examples

### Invalid MAC format

```sh
curl -X PUT http://192.168.4.1/api/config/mac \
  -H 'Content-Type: application/json' \
  -d '{"peerMac":"0c:4e:a0:66:a4"}'
```

Response:
```json
{
  "error": "peerMac must be empty or AA:BB:CC:DD:EE:FF format"
}
```

### Invalid role

```json
{
  "error": "Invalid role (use start, finish, or intermediate)"
}
```

## Workflows

### Pair two gates manually

**On Start Gate**:
1. Check its MAC (from home page or `GET /api/status`)
2. Note the MAC: `dc:b4:d9:9c:48:ec`

**On Finish Gate**:
1. Set Start Gate's MAC as peer:
   ```sh
   curl -X PUT http://192.168.4.1/api/config/mac \
     -H 'Content-Type: application/json' \
     -d '{"peerMac":"dc:b4:d9:9c:48:ec"}'
   ```
2. Verify connection: `GET /api/status` → `espNow.connected: true`

### Auto-discovery (recommended)

**On Finish Gate**:
1. Leave `peerMac` empty (or already empty)
2. Start Gate will send Ping every 30 seconds
3. Finish Gate auto-discovers Start Gate's MAC on first Ping
4. No manual configuration needed

## Notes

- **Role is compile-time**: In production, role is baked into firmware; this endpoint is for testing only
- **Auto-discovery is recommended**: Leave `peerMac` empty on non-start gates; the start gate will discover them automatically
- **Intermediate gates**: Support for multi-checkpoint timing (future feature); currently same behavior as finish gate
