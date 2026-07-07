# /api/riders

Manage rider registration. Riders are stored locally on the start gate (32-entry limit) and identified by NFC tag ID. Each rider has a deterministic `riderId` derived from their tag ID.

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
> riders
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
  "ok": true,
  "riderId": "rider-tag-001"
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
- `displayName`: Required; must be non-empty
- Storage limit: 32 riders max

### Side Effects

1. Rider entry saved to NVS
2. If tag ID already exists, display name is overwritten (upsert behavior)
3. If roster is full (32 riders), adding a new tag returns 400 error
4. No device restart required

### Serial Equivalent

```
> riders.add tag-001 Dave Wilson
[RIDER] Added/updated: tag-001 -> Dave Wilson
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

Remove a rider from the roster.

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
| `tagId` | string | Yes |

### Response (Success)

```json
{
  "ok": true
}
```

### Response (Error)

```json
{
  "error": "Rider not found"
}
```

### Validation Rules

- `tagId`: Required; must match an existing rider

### Side Effects

1. Rider entry removed from NVS
2. All riders after the deleted entry are shifted down in the array
3. No device restart required

### Serial Equivalent

```
> riders.del tag-001
[RIDER] Deleted: tag-001
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

### Error: Rider not found

```sh
curl -X DELETE http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId":"nonexistent"}'
```

Response:
```json
{
  "error": "Rider not found"
}
```

---

## Notes

- **Capacity**: Maximum 32 riders per device
- **Persistence**: All riders are stored in NVS and survive power cycles
- **Identifier format**: `riderId` is always `rider-<tagId>`. Example: if `tagId = "chip-12345"`, then `riderId = "rider-chip-12345"`
- **Upsert behavior**: POST always creates or updates; use the same `tagId` to overwrite a rider's display name
- **Deletion**: Reorders the internal array; indices may change, but `tagId` and `riderId` remain stable
