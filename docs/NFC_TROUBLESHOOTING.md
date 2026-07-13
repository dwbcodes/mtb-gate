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
  "message": "NFC reader not detected or not initialized. Check power and I2C wiring: SDA=GPIO8 (pin 5), SCL=GPIO10 (pin 4), GND, 3.3V"
}
```

You can also scan the whole I2C bus:
```
http://192.168.4.1/api/i2c/scan
```

## ESP32-C3 DevKit M1 Pin Configuration

### I2C Wiring (PN532 NFC Reader)

**Correct wiring** (see `firmware/shared/src/nfc_reader.cpp`):
```
PN532 Module → ESP32-C3 DevKit M1
─────────────────────────────────
SDA (data)   → GPIO 8
SCL (clock)  → GPIO 10
GND          → GND
VCC (+3.3V)  → 3V3 (or 5V if module supports it)
```

### Pin Reference

| GPIO | Function |
|------|----------|
| GPIO 8 | **I2C SDA** (NFC data) |
| GPIO 10 | **I2C SCL** (NFC clock) |
| GPIO 6 | NFC IRQ (assigned but not read — driver polls over I2C) |
| GPIO 7 | NFC RESET (assigned but unused) |

Do **not** use GPIO 11 — it is VDD_SPI on the ESP32-C3.

## Troubleshooting Steps

### 1. Verify Wiring
- [ ] SDA wire connected to **GPIO 8**
- [ ] SCL wire connected to **GPIO 10**
- [ ] GND connected to ground
- [ ] VCC connected to 3.3V power
- [ ] All connections are secure

### 2. Check Power
- [ ] PN532 module has a power indicator LED (usually red)
- [ ] LED should be **on** when powered

### 3. Check the I2C Address

The PN532's I2C address is **0x24**. The firmware probes 0x24 before initializing the driver, so a module on a different address will report "not detected". Use `/api/i2c/scan` to see what addresses respond.

## Common Issues & Solutions

### Issue: "NFC reader not detected"
1. **Wrong pins**: SDA must be on **GPIO 8** and SCL on **GPIO 10**
2. **Power issue**: verify 3.3V is connected and stable
3. **Loose connections**: reseat all I2C wires
4. **Wrong I2C address**: check with `/api/i2c/scan` (expect 0x24)
5. **Defective module**: test with a known-working I2C device on the same pins

### Issue: "Card reads but tag ID not captured"
1. Hold the card closer to the reader (~5–10 cm max range)
2. Try different angles
3. Check the card is ISO14443A (Mifare / NTAG — most NFC cards)
4. Some cards have read protection — try another card

### Issue: "Tap NFC button does nothing"
1. Open `/api/nfc/diagnostics` — verify the reader is initialized
2. Check the browser console for JavaScript errors
3. Refresh the page

### Issue: NFC works but the sensor misbehaves during runs
This is expected behavior being managed: I2C transactions corrupt ESP32-C3 ADC reads, so the firmware suspends NFC polling during calibration and active runs (and calls `Wire.end()` at boot if no reader is detected). Re-scan cancellation is unavailable mid-run — use the web UI stop button instead.

## Testing NFC Detection

### Via Serial (115200 baud)
The device attempts NFC init ~2 seconds after boot on the start gate. Watch for `[NFC] Reader initialized successfully` or `[NFC] Reader not detected - releasing I2C bus`.

To exercise the run flow without hardware, inject a scan:
```
scan=<tagId>
```

### Via API
```bash
# Start listening for NFC cards (15 s window)
curl -X POST http://192.168.4.1/api/nfc/listen

# After tapping a card, read the captured tag
curl http://192.168.4.1/api/nfc/tag
```

## Technical Notes

- **NFC init timing**: deferred to ~2 s after boot (start gate only); lazy re-init on first `/api/nfc/listen`
- **I2C probe**: the firmware NACK-probes 0x24 before touching the Adafruit driver, so a missing module fails fast instead of hanging
- **Supported cards**: ISO14443A (Mifare, NTAG, most NFC cards/stickers)
- **Range**: ~5–10 cm depending on antenna quality

## Firmware Configuration

Current I2C pins are set in `firmware/shared/src/nfc_reader.cpp`:
```cpp
Wire.begin(8, 10);  // SDA=GPIO8, SCL=GPIO10
```
