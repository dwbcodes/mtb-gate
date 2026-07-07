# PUT /api/config/time

Update sensor trip thresholds for start, line 2, and finish triggers. Thresholds are analog voltage levels (0.00–2.00 V) that determine when a sensor is considered triggered.

## Request

```
PUT /api/config/time
Content-Type: application/json

{
  "startThreshold": 0.85,
  "line2Threshold": 0.85,
  "finishThreshold": 0.85
}
```

## Request Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `startThreshold` | number | No | 0.00–2.00 (V) |
| `line2Threshold` | number | No | 0.00–2.00 (V) |
| `finishThreshold` | number | No | 0.00–2.00 (V) |

## Response (Success)

```json
{
  "ok": true
}
```

## Response (Error)

```json
{
  "error": "Thresholds must be 0.00-2.00"
}
```

## Validation Rules

- All thresholds must be between 0.00 and 2.00 (volts)
- Any omitted fields are left unchanged
- All fields are optional

## Side Effects

1. Configuration saved to NVS
2. Sensor gate objects are immediately re-instantiated with new thresholds
3. No device restart required

## Notes

- **Threshold meaning**: A sensor is triggered when its analog reading **exceeds** the threshold
- **Start gate thresholds**: `startThreshold` (pin 2) and `line2Threshold` (pin 3)
- **Finish gate threshold**: `finishThreshold` (pin 2)
- **Units**: All values are in volts; typical pressure sensors map 0–100 PSI to 0–5V
- **Typical values**: 0.85 V works well for pressure sensors under normal conditions
- **Calibration**: Use the device UI (config page) or trial-and-error to find optimal values

## Serial Equivalent

None (sensor thresholds are analog and device-specific; not mirrored via serial).

## Examples

### curl — Update only start threshold

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{"startThreshold":0.90}'
```

### curl — Update all thresholds

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{
    "startThreshold":0.80,
    "line2Threshold":0.75,
    "finishThreshold":0.85
  }'
```

### curl — Fine-tune line 2 sensor

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{"line2Threshold":0.82}'
```

## Error Examples

### Threshold out of range

```sh
curl -X PUT http://192.168.4.1/api/config/time \
  -H 'Content-Type: application/json' \
  -d '{"startThreshold":3.0}'
```

Response:
```json
{
  "error": "Thresholds must be 0.00-2.00"
}
```

## Workflow: Calibration

1. **Baseline**: Set all thresholds to 0.85 V (default)
2. **Test**: Trigger each sensor manually (e.g., stand on start gate, press line 2 pad, etc.)
3. **Monitor**: Watch the device dashboard for "trigger detected" messages
4. **Adjust**: If sensor is too sensitive (triggers at rest), increase threshold; if not sensitive enough, decrease
5. **Verify**: Test several times to ensure reliability
6. **Commit**: Thresholds are automatically saved; no additional step needed

## Notes

- Thresholds apply immediately without device restart
- Changes affect only the gate itself (not peer gates)
- Start gate has two thresholds (pins 2 and 3); finish gate has one (pin 2)
- For proper race timing, all sensors should trigger within ~50 ms of the actual rider event
