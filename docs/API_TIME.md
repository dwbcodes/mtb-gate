# PUT /api/config/time

Update the active sensor trigger calibration. Firmware detects a trigger when the analog reading rises above the rolling baseline by `triggerDelta` volts.

## Request

```
PUT /api/config/time
Content-Type: application/json

{
  "triggerDelta": 0.30
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `triggerDelta` | number | No | 0.01-2.00 (V above baseline) |

Legacy fields `startThreshold`, `line2Threshold`, and `finishThreshold` are still accepted and stored for compatibility with old backups and test clients, but the current trigger decision path uses `triggerDelta`.

## Response (Success)

```json
{
  "ok": true
}
```

## Response (Error)

```json
{
  "error": "triggerDelta must be 0.01-2.00"
}
```

## Validation Rules

- `triggerDelta` must be between 0.01 and 2.00 volts
- Any omitted fields are left unchanged
- All fields are optional

## Side Effects

1. Configuration saved to NVS
2. `triggerDelta` is applied immediately to the baseline-relative sensor trigger path
3. No device restart required

## Notes

- **Trigger meaning**: a sensor is triggered when its analog reading is greater than `rolling baseline + triggerDelta`
- **Baseline**: rolling average of recent sensor readings, frozen during countdown and active trigger windows
- **Calibration**: the device samples idle sensor noise on boot; adjust `triggerDelta` with this API when bench testing shows the default is too sensitive or not sensitive enough
- **Typical values**: 0.05-0.30 V depending on sensor noise and tube response

## Serial Equivalent

None.

## Examples

### curl - Update Trigger Delta

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta":0.25}'
```

### curl - Restore Legacy Threshold Fields

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{
    "triggerDelta":0.25,
    "startThreshold":0.80,
    "line2Threshold":0.75,
    "finishThreshold":0.85
  }'
```

## Error Examples

### Trigger Delta Out Of Range

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{"triggerDelta":0}'
```

Response:
```json
{
  "error": "triggerDelta must be 0.01-2.00"
}
```
