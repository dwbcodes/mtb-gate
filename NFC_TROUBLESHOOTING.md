# NFC Reader Troubleshooting Guide

## Quick Diagnosis

### Check NFC Status via API
Open your browser and navigate to:
```
http://192.168.4.1/api/nfc/diagnostics
```

You'll see a response like:
```json
{
  "initialized": true,
  "message": "NFC reader initialized successfully"
}
```

Or if not detected:
```json
{
  "initialized": false,
  "message": "NFC reader not detected or not initialized. Check I2C wiring: SDA=GPIO5, SCL=GPIO4"
}
```

## ESP32-C3 DevKit M1 Pin Configuration

### I2C Wiring (PN532 NFC Reader)

**Correct Wiring:**
```
PN532 Module → ESP32-C3 DevKit M1
─────────────────────────────────
SDA (data)   → GPIO 5  (Pin 5)
SCL (clock)  → GPIO 4  (Pin 4)
GND          → GND
VCC (+3.3V)  → 3V3 (or 5V if module supports it)
```

### ESP32-C3 DevKit M1 Pin Reference

| GPIO | Physical Pin | Function |
|------|------|----------|
| GPIO 5 | Pin 5 | **I2C SDA** (NFC data) |
| GPIO 4 | Pin 4 | **I2C SCL** (NFC clock) |
| GPIO 11 | Pin 11 | NFC IRQ (optional) |
| GPIO 12 | Pin 12 | NFC RESET (optional) |

## Troubleshooting Steps

### 1. Verify Wiring
- [ ] SDA wire connected to **GPIO 5** (not pin 3)
- [ ] SCL wire connected to **GPIO 4** ✓
- [ ] GND connected to ground
- [ ] VCC connected to 3.3V power
- [ ] All connections are secure

### 2. Check Power
- [ ] PN532 module has power indicator LED (usually red)
- [ ] LED should be **on** when powered
- [ ] Try alternative 3.3V source if available

### 3. Verify I2C Communication
Test command via serial:
```
Type in serial monitor: ping
Response should show ESP-Now communication
```

### 4. Check for I2C Address

The PN532 default I2C address is **0x24**

If the module uses different address, the firmware needs to be updated.

## Common Issues & Solutions

### Issue: "NFC reader not detected"
**Solutions:**
1. **Wrong pin for SDA**: Make sure SDA is on **GPIO 5**, not GPIO 3
2. **Power issue**: Verify 3.3V power is connected and stable
3. **Loose connections**: Reseat all I2C wires
4. **Wrong I2C address**: Check PN532 module documentation for actual I2C address
5. **Defective module**: Test with a known-working I2C device on same pins

### Issue: "Card reads but tag ID not captured"
**Solutions:**
1. Device is listening but card isn't being detected
2. Try holding card closer to reader
3. Try different angles
4. Check if card is NFC Type 2 (most common)
5. Some cards have read protection - try another card

### Issue: "Tap NFC button does nothing"
**Solutions:**
1. Open `/api/nfc/diagnostics` - verify reader is initialized
2. Check browser console for JavaScript errors
3. Make sure device-ui is the latest version (auto-initialize enabled)
4. Try refreshing the page

## Testing NFC Detection

### Manual Test via Serial
```bash
# Connect to device serial at 115200 baud
# Type: ping
# Response: Should show device is running

# The device will automatically attempt NFC init at 2 seconds after boot
# Watch for "[NFC] Reader initialized successfully" or "[NFC] Reader not detected"
```

### Test NFC Listen Endpoint
```bash
# Start listening for NFC cards
curl -X POST http://192.168.4.1/api/nfc/listen

# In another terminal, check for detected tag (after scanning)
curl http://192.168.4.1/api/nfc/tag
```

## If Still Not Working

### Gather Debug Info
Please provide:
1. Output of `/api/nfc/diagnostics` endpoint
2. Serial monitor output showing boot messages
3. Photo of your wiring connections
4. Confirm you're using PN532 module (not PN532v3)
5. Confirm I2C address (usually printed on module: 0x24)

### Alternative: Manual Tag ID Entry
If NFC hardware isn't available:
1. Use the device-ui without NFC
2. Manually enter tag ID when prompted
3. All other features work normally

## Technical Notes

- **NFC Init Timing**: Device initializes NFC 2 seconds after boot
- **I2C Timeout**: 500ms timeout - if PN532 doesn't respond, it fails gracefully
- **Supported Cards**: NFC Type 2 ISO14443A cards (Mifare, most NFC cards)
- **Max Distance**: ~5-10cm depending on antenna quality

## Firmware Configuration

Current I2C pins (hardcoded):
```cpp
Wire.begin(5, 4);  // SDA=GPIO5, SCL=GPIO4
```

To change these pins, edit:
`firmware/shared/src/nfc_reader.cpp` line 14

And update the pin numbers accordingly.
