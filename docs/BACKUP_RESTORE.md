# Config Backup & Restore

The **Reset** page in the device UI has a **Backup & Restore** section. Use it to export configuration as JSON, then restore it after a factory reset or when replacing a gate with new hardware.

## What is in the backup

`GET /api/config` (the export source) returns:

| Field | Restored? | Notes |
|---|---|---|
| `gateNumber` | Yes | Determines role (1=Start, 12=Finish, 2–11=Intermediate) |
| `deviceLabel` | Yes | Optional display name |
| `peerMac` | Yes | Start gate's peer MAC; finish gate auto-discovers so this may be empty |
| `staSsid` | Yes | Station Wi-Fi network name |
| `apPassword` | Yes | Stored in plaintext in the backup file |
| `staPassword` | Yes | Stored in plaintext in the backup file |
| `wifiChannel` | Yes | ESP-Now + AP channel (1–13) |
| `triggerDelta` | Yes | Baseline-relative sensor trigger threshold (volts) |
| `dualTriggerEnabled` | Yes | Wheel track dual-trigger mode on/off |
| `wheelTrackTimeoutMs` | Yes | Second-wheel detection window (ms) |
| `officialTrigger` | Yes | `"first"` or `"second"` — which wheel crossing starts the clock |
| `deviceId` | — | Derived from gateNumber + MAC; not restored (MAC is hardware-specific) |
| `role` | — | Derived from gateNumber; not a separate field |
| `startThreshold` / `finishThreshold` / `line2Threshold` | — | Legacy fields; not in the active trigger path |

**Riders are not included.** They are stored separately in NVS. After restore, riders must be re-registered via NFC tap or re-imported via the peer sync tool on the Peer Tools page.

**Session/event data is not included.** Historical runs live on LittleFS and can be downloaded individually via the Files page before a reset.

## Restore flow — same hardware, factory reset

1. On the Reset page, click **Download Config (JSON)** and save the file.
2. Click **Factory Reset** and confirm. The device reboots with default settings.
3. Reconnect to the gate AP (`Gate-<#>-<mac>`, default password `changeme123`).
4. On the Reset page, click **Restore Config (JSON)** and select the saved file. The device restores all settings (including passwords) and reboots.
5. Reconnect using your AP password and re-register riders via NFC, or use **Peer Tools → Sync Riders** if the other gate still has the roster.

## Restore flow — new hardware (board replacement)

When the physical board is replaced the eFuse MAC changes, so `deviceId` and the AP SSID will differ. The config backup still restores everything useful:

**Start gate replaced:**
1. Flash new board with the current firmware.
2. Connect to the new AP (SSID will reflect the new MAC).
3. On the Reset page, click **Restore Config (JSON)** and select the start gate backup. Passwords are restored automatically.
4. The finish gate will auto-discover the new start gate MAC on next ping (within ~30 s) and update its `peerMac` automatically — no manual action needed on the finish gate.

**Finish gate replaced:**
1. Flash new board with current firmware.
2. Connect to new AP and restore the finish gate backup (sets `gateNumber = 12`, `triggerDelta`, wheel track, Wi-Fi channel, passwords).
3. The start gate must be updated with the new finish gate MAC via **Gate Config → Peer MAC**, or left blank so it auto-discovers on next ping.

**Intermediate gate replaced:**
1. Flash and restore intermediate gate backup (sets `gateNumber`, channel, `triggerDelta`, passwords).
2. No peer MAC changes needed (intermediate gates use broadcast pings).

## Known limitations

- **Riders must be re-registered** after factory reset. If the peer gate still has the roster, use Peer Tools → Sync Riders to push it to the restored gate.
- **Session history is not portable.** LittleFS data cannot be transferred between boards; download individual session files via the Files page before resetting if you need them.
- **`deviceId` changes on new hardware.** AP SSID, DHCP hostname, and `eventId` prefixes all change with the MAC. Existing cloud-uploaded run records are unaffected.
