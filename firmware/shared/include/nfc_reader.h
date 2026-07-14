#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

// Wraps the PN532 NFC reader with lazy, non-blocking init (see begin() in
// nfc_reader.cpp for the I2C pinout and probe-before-init rationale).
// I2C on this bus is known to corrupt ESP32-C3 ADC reads, so callers must
// avoid polling this class while a run/calibration is using the sensor ADC.
class NfcReader {
public:
  void begin();
  bool isInitialized() const { return initialized_; }
  bool readTag(String& outTagId);
  // Opens a window during which getScannedTag()/poll() will report a tag.
  void startListening(unsigned long timeoutMs = 15000);
  // Returns the tag scanned during the current listen window, if any.
  bool getScannedTag(String& outTagId);
  void poll();  // Call from loop() to continuously scan during listen window

private:
  Adafruit_PN532* nfc_ = nullptr;
  bool initialized_ = false;
  String lastScannedTag_;
  bool tagScanned_ = false;
  unsigned long listenStartMs_ = 0;
  unsigned long listenDurationMs_ = 0;
};
