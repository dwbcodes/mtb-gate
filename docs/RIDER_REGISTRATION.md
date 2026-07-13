# Rider Registration Guide

## Adding Riders via NFC

Riders are registered to NFC tags (MiFare Classic, NTAG, or similar ISO14443A compatible cards/stickers). Each rider has:
- **Tag ID**: The unique NFC tag identifier (hex format, e.g., `04AB12CD`)
- **Display Name**: Human-friendly name (e.g., "Dave Wilson")

### Step-by-Step: Register a New Rider

#### Via Device UI (Recommended)

1. **Connect to Gate Wi-Fi**
   - SSID: the device ID, `Gate-<#>-<mac>` (e.g., `Gate-Start-a1b2c3d4e5f6`)
   - Password: `changeme123` (default)
   - Open browser to `http://192.168.4.1/` (start gate)

2. **Navigate to Riders Tab**
   - Click the "Riders" tab in the navigation bar

3. **Start NFC Listening**
   - Click the **"📱 Tap NFC"** button
   - Status text changes to "Listening for 15 seconds..."
   - The device is now ready to scan

4. **Tap Your NFC Card/Tag**
   - Hold the NFC card/sticker to the PN532 reader
   - Reader will detect the tag and display its ID
   - Status shows: "✓ Scanned: 04AB12CD"

5. **Enter Rider Name**
   - A prompt appears asking for the rider's display name
   - Enter name and click OK
   - Example: `Dave Wilson`, `Alice Chen`, `Bob Martinez`

6. **Confirm Registration**
   - Rider appears in the "Registered Riders" list
   - Name and Tag ID are displayed
   - Status shows: "✓ Registered: Dave Wilson"

### Via REST API

If you prefer to register riders programmatically:

```bash
curl -X POST http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{
    "tagId": "04AB12CD",
    "displayName": "Dave Wilson"
  }'
```

Response:
```json
{
  "ok": true
}
```

### Via Serial Console

Connect to the device serial port (115200 baud) and use:

```
api riders/add {"tagId":"04AB12CD","displayName":"Dave Wilson"}
```

## Viewing Registered Riders

### Device UI
- Open "Riders" tab
- All registered riders displayed with their tag IDs
- Click "Refresh" to reload

### REST API
```bash
curl http://192.168.4.1/api/riders
```

Response:
```json
[
  {
    "riderId": "rider-04AB12CD",
    "displayName": "Dave Wilson",
    "tagId": "04AB12CD"
  },
  {
    "riderId": "rider-A1B2C3D4",
    "displayName": "Sarah Chen",
    "tagId": "A1B2C3D4"
  }
]
```

### Serial Console
```
api riders
```

## Removing a Rider

### Device UI
1. Go to "Reset" tab → "Clear All Riders" button
   - Deletes **all** riders (be careful!)

### REST API
```bash
curl -X DELETE http://192.168.4.1/api/riders \
  -H 'Content-Type: application/json' \
  -d '{"tagId": "04AB12CD"}'
```

### Serial Console
```
api riders/delete {"tagId":"04AB12CD"}
```

## NFC Hardware Setup

### PN532 Reader Wiring (I2C Mode)

**ESP32-C3 DevKit M1 pins** (see `firmware/shared/src/nfc_reader.cpp`):
- **SDA (Data)**: GPIO 8
- **SCL (Clock)**: GPIO 10
- **IRQ**: GPIO 6 (assigned but not read — the driver polls over I2C)
- **RESET**: GPIO 7

**Wiring Diagram**:
```
PN532 Module     ESP32-C3
─────────────────────────
VCC      ──────→ 3V3
GND      ──────→ GND
SDA      ──────→ GPIO 8
SCL      ──────→ GPIO 10
IRQ      ──────→ GPIO 6
RESET    ──────→ GPIO 7
```

See [NFC_TROUBLESHOOTING.md](NFC_TROUBLESHOOTING.md) if the reader is not detected.

### Compatible NFC Cards

- **MiFare Classic 1K** (most common, cheap)
- **NTAG213/215/216** (newer, better security)
- **MiFare Ultralight** (small, simple)
- **ISO14443A Type A** (generic, standard)

**Recommended**: NTAG213 cards or MiFare stickers (durable, rewritable)

## Troubleshooting NFC Registration

### Problem: "No tag detected" after 15 seconds

**Solutions:**
1. **Check reader power**: Is the PN532 powered (check LED)?
2. **Verify I2C connection**: Pins SDA/SCL properly connected?
3. **Try different card**: Use a known working NFC card
4. **Restart device**: Power cycle the gate
5. **Check serial for errors**: Monitor at 115200 baud for "[NFC]" messages

### Problem: Tag detected but name prompt doesn't appear

1. **Check browser console**: Press F12, check for JavaScript errors
2. **Reload page**: Refresh browser
3. **Try API directly**: `curl -X POST http://192.168.4.1/api/nfc/listen`, tap the card, then `curl http://192.168.4.1/api/nfc/tag`
4. **Check server logs**: Watch serial output for HTTP errors

### Problem: Same rider registered multiple times

- Each tag ID is unique; same tag + different name = **update**, not duplicate
- To replace a rider's name, use the same tag ID with a new name
- Old entry is automatically overwritten

### Problem: Memory full (32 riders max)

- Device supports maximum 32 riders
- Use "Clear All Riders" (Reset tab) to delete and start over
- Or use REST API to delete individual riders

## Rider ID Format

Each registered rider gets a unique `riderId`:

```
riderId = "rider-" + tagId
```

**Examples:**
- Tag `04AB12CD` → Rider ID `rider-04AB12CD`
- Tag `A1B2C3D4` → Rider ID `rider-A1B2C3D4`

This ID is used internally for timing results and run linkage.

## Best Practices

1. **Label cards clearly**: Write the rider name on the card for easy identification
2. **Use consistent naming**: Stick to a naming convention (e.g., "FirstName LastName")
3. **Test before race day**: Verify all cards scan properly in advance
4. **Keep backup cards**: Have spare NFC cards in case one fails
5. **Store config backups**: Use "Download Config" to save rider list
6. **Register early**: Do all NFC registration before the event starts

## Advanced: Import/Export Riders

### Export Rider List (JSON)
1. Go to "Reset" tab → "📥 Download Config"
2. Saves JSON with all riders and device config
3. Restore by modifying JSON and re-uploading (future feature)

### Bulk Import via API
```bash
# Save all riders to file
curl http://192.168.4.1/api/riders > riders.json

# Later: re-import (script required)
cat riders.json | while read -r rider; do
  curl -X POST http://192.168.4.1/api/riders \
    -H 'Content-Type: application/json' \
    -d "$rider"
done
```

---

**Questions?** Check the main API documentation: `/docs/API_RIDERS.md`
