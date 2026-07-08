Build the firmware and flash it to all connected gates.

Steps:
1. Run `make build` to compile the firmware. If it fails, fix the errors and retry.
2. Run `make upload` to flash all connected devices (both /dev/ttyACM0 and /dev/ttyACM1).
3. Wait for both gates to boot (~3 seconds after flash completes).
4. Verify the finish gate auto-discovered the start gate by reading serial output from /dev/ttyACM1 for ~15 seconds using pyserial:
   ```python
   import serial, time
   s = serial.Serial('/dev/ttyACM1', 115200, timeout=15)
   data = b''
   start = time.time()
   while time.time() - start < 15:
       chunk = s.read(s.in_waiting or 1)
       if chunk:
           data += chunk
       time.sleep(0.1)
   print(data.decode('utf-8', errors='replace'))
   s.close()
   ```
5. Confirm the finish gate shows `peer=0C:4E:A0:66:A4:14` (start gate MAC) and NOT `peer=11:22:33:44:55:66`.
6. Report build size, flash result, and finish gate peer status.

If only one device is connected, use `make upload PORT=/dev/ttyACM0` for the single device.
