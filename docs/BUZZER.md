# Buzzer Audio Feedback

## Hardware

- **Component**: 85 dB passive buzzer (3.3 V compatible)
- **Pin**: GPIO 5 (`BUZZER_PIN` in `firmware/gate/src/main.cpp`)
- **Wiring**: signal wire to GPIO 5, other wire to GND
- **Resistor**: not needed for most 3.3 V passive buzzers; add 100 Ω if the buzzer draws >20 mA

### Pin Selection

GPIO 5 avoids conflicts with:
- I2C for the NFC reader (GPIO 8 = SDA, GPIO 10 = SCL)
- The pressure sensor ADC input (GPIO 4)

## Sound Patterns

Driven via the ESP32 LEDC PWM peripheral (channel 0), not the Arduino `tone()` API. `buzzerTone(freq, durationMs)` is non-blocking: the main loop switches the duty off when `buzzerStopAtMs` passes, keeping the 100 ms run loop responsive.

| Event | Sound |
|-------|-------|
| Rider scanned | Ascending 8-note arpeggio (200→800 Hz, "coin insert" style) |
| Countdown second 10 | 800 Hz, 500 ms |
| Countdown seconds 5–1 | 1000 Hz, 200 ms each |
| GO | 2000 Hz, 2000 ms |
| Finish received | 1500 Hz, 500 ms |
| Calibration start | 800 Hz, 300 ms |
| Calibration "press the tube now" | 3 × 1200 Hz, 150 ms (peer prompt: 2 × 1000 Hz) |
| Calibration success | Rising two-tone: 800 Hz then 1200 Hz |
| Calibration failure | Low 400 Hz, 500 ms |

The buzzer is forced off (`buzzerOff()`) when a run is cancelled or deleted so a GO tone never outlives its run.
