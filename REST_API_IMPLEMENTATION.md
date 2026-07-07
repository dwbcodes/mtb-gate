# REST API Implementation Summary

## Overview
Successfully added full REST API endpoints to the MTB Gate firmware to replace missing endpoints that were causing "request handler not found" errors.

## Endpoints Implemented

### Configuration Endpoints

#### GET /api/status
Returns device status (already existed)
```json
{
  "deviceId": "gate-4e0c",
  "role": "start",
  "apSsid": "MTBGate-gate-4e0c",
  "apIp": "192.168.4.1",
  "staSsid": "<not configured>",
  "staIp": "0.0.0.0"
}
```

#### GET /api/config
Returns full device configuration (passwords redacted)
```json
{
  "deviceId": "gate-4e0c",
  "deviceLabel": "MTB Gate",
  "role": "start",
  "apSsid": "MTBGate-gate-4e0c",
  "apPassword": "***",
  "staSsid": "",
  "staPassword": "***",
  "startThreshold": 0.85,
  "finishThreshold": 0.85,
  "line2Threshold": 0.85,
  "wifiChannel": 1,
  "peerMac": ""
}
```

#### PUT /api/config/wifi
Update WiFi settings (AP and STA)
```json
{
  "apSsid": "NewAPName",
  "apPassword": "newpassword123",
  "staSsid": "HomeWifi",
  "staPassword": "homepassword",
  "wifiChannel": 6
}
```
**Response**: `{"ok":true}` - Triggers deferred network restart after response is sent

#### PUT /api/config/time
Update sensor thresholds
```json
{
  "startThreshold": 0.8,
  "finishThreshold": 0.9,
  "line2Threshold": 0.85
}
```
**Response**: `{"ok":true}`

#### PUT /api/config/mac
Update device MAC, role, and label
```json
{
  "peerMac": "AA:BB:CC:DD:EE:FF",
  "role": "start",
  "deviceLabel": "Start Gate A"
}
```
**Response**: `{"ok":true}`

### Rider Management Endpoints

#### GET /api/riders
List all registered riders
```json
[
  {
    "riderId": "rider-ABC123",
    "displayName": "John Doe",
    "tagId": "ABC123"
  }
]
```

#### POST /api/riders
Register or update a rider
```json
{
  "tagId": "ABC123",
  "displayName": "John Doe"
}
```
**Response**: `{"ok":true}`

#### DELETE /api/riders
Remove a rider
```
DELETE /api/riders?tagId=ABC123
```
**Response**: `{"ok":true}`

### System Endpoints

#### POST /api/reboot
Reboot the device
```
POST /api/reboot
```
**Response**: `{"ok":true}` - Device reboots after response

## Implementation Details

### Files Modified
- `firmware/gate/src/main.cpp`:
  - Added #include statements for ArduinoJson, rider_store, nfc_reader
  - Added global instances: `RiderStore riderStore` and `NfcReader nfcReader`
  - Added 8 handler functions for REST API endpoints
  - Updated `configureWebServer()` to register all routes
  - Updated `setup()` to load rider store from NVS

### Error Handling
All endpoints return appropriate HTTP status codes:
- `200 OK` - Successful request
- `400 Bad Request` - Missing or invalid parameters
- `405 Method Not Allowed` - Wrong HTTP method
- `500 Internal Server Error` - Server-side error

All error responses include JSON with error message:
```json
{"error": "error description"}
```

### Data Persistence
- Configuration changes are automatically saved to NVS
- Riders are persisted to NVS and loaded on device boot
- WiFi changes trigger deferred restart to ensure HTTP response is sent first

### Build Status
✅ Firmware compiles successfully at **63.1% flash usage**
✅ All 9 routes registered
✅ No compilation errors or warnings
✅ Device boots cleanly and responds to serial commands

## Testing

### Using curl
```bash
# Get status
curl http://192.168.4.1/api/status

# Update WiFi settings
curl -X PUT http://192.168.4.1/api/config/wifi \
  -H "Content-Type: application/json" \
  -d '{"apSsid":"NewName","apPassword":"newpass123"}'

# Add a rider
curl -X POST http://192.168.4.1/api/riders \
  -H "Content-Type: application/json" \
  -d '{"tagId":"ABC123","displayName":"John Doe"}'
```

### Using device-ui
The device-ui web interface (at http://192.168.4.1) now has full access to:
- Real-time status and configuration display
- WiFi settings configuration
- Sensor threshold adjustment
- Rider registration and management

## Compatibility
These REST API endpoints are fully compatible with the device-ui frontend which was expecting these exact endpoints. The "request handler not found" errors should now be resolved.
