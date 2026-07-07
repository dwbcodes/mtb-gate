# Buzzer Countdown Audio Feedback

## Hardware

- **Component**: 85dB passive buzzer (3.3V compatible)
- **Pin**: GPIO 7
- **Wiring**: Signal wire to GPIO 7, other wire to GND
- **Resistor**: Not needed for most 3.3V passive buzzers; add 100ohm if buzzer draws >20mA

### Pin Selection

GPIO 7 was chosen because it avoids conflicts with:
- I2C (GPIO 8/10 used by NFC)
- Sensor Line 1 (GPIO 0)
- Sensor Line 2 (GPIO 2/3)

## Countdown Pattern

| Countdown | Action | Frequency | Duration |
|-----------|--------|-----------|----------|
| 10 (scan) | Long low buzz | 500 Hz | 500ms |
| 9, 8, 7, 6 | Silent | -- | -- |
| 5 | Medium buzz | 800 Hz | 300ms |
| 4 | Silent | -- | -- |
| 3 | Short high buzz | 1000 Hz | 200ms |
| 2 | Short high buzz | 1000 Hz | 200ms |
| 1 | Short high buzz | 1000 Hz | 200ms |
| GO (0) | Long high buzz | 1500 Hz | 3000ms |

## Implementation

Uses ESP32 Arduino `tone(pin, freq, duration)` which is non-blocking -- starts PWM and returns immediately, auto-stops after the specified duration. This keeps the 100ms countdown loop responsive.

`noTone(BUZZER_PIN)` is called when a run finishes to ensure the buzzer stops cleanly.
