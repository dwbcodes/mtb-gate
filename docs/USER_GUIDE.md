# MTB Gate User Guide

Welcome! This guide walks you through setting up your timing gates, registering riders, and running standing-start practice sessions. No technical knowledge required.

## What You Have

- **Start Gate** — the brain of the system. Riders swipe in here, the countdown runs here, and results are shown here.
- **Finish Gate** — detects the finish crossing and reports it back to the Start Gate wirelessly (works up to ~250 m away, no router needed).
- **Pressure tubes** — one at the start line and one at the finish line. Riding over a tube triggers the gate.
- **NFC tags or cards** — one per rider, used to identify who is riding.

Both gates run the same software. A gate's job (start or finish) is set by its **gate number**: gate 1 is the Start Gate, gate 12 is the Finish Gate.

## First-Time Setup

### Connect to the Start Gate

- Power on both gates.
- On your phone or laptop, join the Start Gate's Wi-Fi network. The network name looks like `Gate-Start-a1b2c3d4e5f6`.
- The default password is `changeme123`.
- Open a browser and go to `http://192.168.4.1/`.

You should see this control panel. The top bar shows the gate's name and whether the Finish Gate is connected.

### Link the gates

- Go to **Configuration → Gate Config**.
- Leave **Peer MAC Address** empty — the gates find each other automatically when both are powered on.
- If auto-discovery does not kick in, type the Finish Gate's MAC address (printed on the device or shown on its Network page) and press **Save Gate Settings**.
- The top bar should change to **Peer connected** within a few seconds.

### Optional: change passwords and Wi-Fi

- Go to **Configuration → Network**.
- Set a new **Access Point Password** (8+ characters) to secure your gate.
- If you want the gate to also join your home or venue Wi-Fi (for cloud upload), enter the **Station Network SSID** and password.
- Press **Save Wi-Fi Settings**.

## Registering Riders

Each rider needs an NFC tag registered once. Up to 32 riders can be stored.

- Go to **Monitor → Riders** (Start Gate only).
- Press **Tap NFC**. The gate listens for 15 seconds.
- Hold the rider's tag or card against the NFC reader on the Start Gate.
- When the card is detected, enter the rider's name and confirm.
- The rider appears in the **Registered Riders** list.

Riders are stored on the gate and survive power cycles. Use **Sync Riders** in Developer → Peer Tools if you want the roster copied to the Finish Gate.

## Running a Session

- The rider rolls up to the start line and swipes their tag on the Start Gate.
- The gate announces a **10-second countdown** with beeps, ending in a GO signal.
- The rider launches on GO, crossing the start-line pressure tube, and sprints to the finish line.
- The Finish Gate detects the crossing and the result appears on the **Results** page within a couple of seconds.

Several riders can queue up: each swipe adds a run, and overlapping attempts are timed independently.

### False starts

Crossing the start tube **before GO** is a false start. The run still completes and is timed, but a **5-second penalty** is added and the result is flagged in red.

### Reading the results

| Metric | Meaning |
| --- | --- |
| Gate Time | GO signal to crossing the start line (reaction) |
| Course | Start line to finish line |
| Total | Official time — GO-to-finish, or course-only plus penalty after a false start |
| Potential | Best possible time without the penalty |

The Results page refreshes automatically every 2 seconds. Each attempt shows the rider's name and swipe time.

### Managing runs

- **Stop** — end a run in progress (for example, the rider pulled out).
- **Remove** — take a queued or live run off the queue.
- **Delete** / **Delete All** — remove saved results. This cannot be undone.

Results are stored on the gate, so nothing is lost if you close the browser or the gate loses power mid-session.

## Wheel Track (optional)

Wheel Track times both wheels crossing the start tube and flags wheel lifts.

- Go to **Configuration → Gate Config → Wheel Track**.
- Enable **dual-trigger detection**.
- Pick which wheel counts as the official trigger (front or rear) and how long to wait for the second wheel.

When enabled, results also show the start and finish crossing times.

## Troubleshooting

### Top bar says "Peer NOT reachable"

- Check the Finish Gate is powered on.
- Move the gates closer together and check again — range is up to ~250 m with clear line of sight.
- On **Gate Config**, verify the Peer MAC address, or clear it to use auto-discovery.
- Reboot both gates (Configuration → Reset → Reboot Device).

### Runs never finish / no finish time

- Make sure the finish pressure tube is connected to the Finish Gate and lies flat across the course.
- Check the top bar shows **Peer connected** before starting a run.

### The start tube doesn't trigger

- The sensor calibrates itself at power-on: keep the tube still and unloaded for the first few seconds after switching the gate on.
- Ride over the tube, don't tiptoe — a firm wheel crossing is what the sensor expects.

### NFC tag not detected

- Hold the tag flat against the reader, within the 15-second listen window.
- Try slowly moving the tag around the reader area — the sweet spot is small.
- If no tag ever works, see the NFC troubleshooting guide in the project documentation.

### Locked out / forgotten password

Connect a computer to the gate by USB and use the serial console (115200 baud) to reset the configuration. Factory reset erases all settings and riders, including the AP password.

## Resetting and Backups

On **Configuration → Reset** you can:

- **Reboot Device** — restart, keeping all settings.
- **Factory Reset** — erase everything, back to defaults. Cannot be undone.
- **Clear All Riders** — delete the rider roster only.
- **Download Config** — save a JSON backup of your settings.
- **Restore Config** — load a previously downloaded backup.

## Good to Know

- The Start Gate owns all timing — the Finish Gate only reports crossings, so times stay accurate even if Wi-Fi is congested.
- Everything works fully offline. Wi-Fi is only needed for configuration and optional cloud upload.
- Default AP password is `changeme123` — change it before taking the system to a shared venue.
