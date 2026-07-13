# /api/riders

Manage rider registration. Riders are stored on-device in NVS (32-entry limit) and identified by NFC tag ID. Each rider has a deterministic `riderId` derived from their tag ID. Register riders on the **start gate**: every add/delete is broadcast to the other gates over ESP-Now, so the roster stays in sync automatically.

## GET /api/riders

List all registered riders.

### Request

```
GET /api/riders
```

No body required.

### Response

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

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `riderId` | string | Unique rider ID (`rider-<tagId>`) — auto-generated, read-only |
| `displayName` | string | User-friendly name (e.g., "Dave Wilson") |
| `tagId` | string | NFC tag ID (e.g., "tag-001") |

### Validation

None — read-only query.

### Serial Equivalent

```
> api riders
[
  {"riderId":"rider-tag-001", "displayName":"Dave Wilson", "tagId":"tag-001"},
  {"riderId":"rider-tag-002", "displayName":"Sarah Chen", "tagId":"tag-002"}
]
```

### Examples

#### curl

```sh
curl http://192.168.4.1/api/riders | jq .
```

#### Response (empty roster)

```json
[]
```

---

## POST /api/riders

Register or update a rider. Upsert: if the tag ID already exists, the display name is updated.

### Request

```
POST /api/riders
Content-Type: application/json

{
  "tagId": "tag-001",
  "displayName": "Dave Wilson"
}
```

### Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `tagId` | string | Yes | Any length; must be unique per rider |
| `displayName` | string | Yes | 1–128 characters |

### Response (Success)

```json
{
  "ok": true
}
```

### Response (Error)

```json
{
  "error": "tagId and displayName required"
}
```

### Validation Rules

- `tagId`: Required; any value (e.g., NFC UID, barcode, etc.)
- `displayName`: Required
- Storage limit: 32 riders max

### Side Effects

1. Rider entry saved to NVS (upsert by `tagId`)
2. Roster broadcast to peer gates over ESP-Now
3. Roster exported to `/riders.json` on the device filesystem
4. If the roster is already full (32 riders), a new tag is silently ignored (the response is still `{"ok":true}`)

### Serial Equivalent

```
> api riders/add {"tagId":"tag-001","displayName":"Dave Wilson"}
```

### Examples

#### curl — Register a new rider

```sh
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave Wilson"}'
```

Response:
```json
{
  "ok": true,
  "riderId": "rider-tag-001"
}
```

#### curl — Update rider display name

```sh
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001","displayName":"Dave W."}'
```

#### curl — Register multiple riders

```sh
# Batch register 3 riders
for id in 001 002 003; do
  curl -X POST http://192.168.4.1/api/riders \
    -H 'Content-Type: application/json' \
    -d "{\"tagId\":\"tag-$id\",\"displayName\":\"Rider $id\"}"
done
```

### Error: Missing field

```sh
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001"}'
```

Response:
```json
{
  "error": "tagId and displayName required"
}
```

---

## DELETE /api/riders

Remove a rider from the roster. The tag ID can be given either as a query parameter (`DELETE /api/riders?tagId=tag-001`) or in a JSON body.

### Request

```
DELETE /api/riders
Content-Type: application/json

{
  "tagId": "tag-001"
}
```

### Request Fields

| Field | Type | Required |
|-------|------|----------|
| `tagId` | string | Yes (query param or body) |

### Response (Success)

```json
{
  "ok": true
}
```

Deleting a tag that does not exist still returns `{"ok":true}` (idempotent delete). The only error is a missing `tagId` (`400`).

### Side Effects

1. Rider entry removed from NVS
2. Updated roster broadcast to peer gates over ESP-Now and exported to `/riders.json`

### Serial Equivalent

```
> api riders/delete {"tagId":"tag-001"}
```

### Examples

#### curl — Delete a rider

```sh
curl -X DELETE http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"tag-001"}'
```

#### curl — Delete multiple riders

```sh
for id in 001 002; do
  curl -X DELETE http://192.168.4.1/api/riders \
    -H 'Content-Type: application/json' \
    -d "{\"tagId\":\"tag-$id\"}"
done
```

---

## Notes

- **Capacity**: Maximum 32 riders per device
- **Persistence**: All riders are stored in NVS and survive power cycles
- **Identifier format**: `riderId` is always `rider-<tagId>`. Example: if `tagId = "chip-12345"`, then `riderId = "rider-chip-12345"`
- **Upsert behavior**: POST always creates or updates; use the same `tagId` to overwrite a rider's display name
- **Roster sync**: only edit riders on the start gate; finish/intermediate gates receive the roster via ESP-Now and overwrite their local copy
- **Deletion**: Reorders the internal array; indices may change, but `tagId` and `riderId` remain stable
