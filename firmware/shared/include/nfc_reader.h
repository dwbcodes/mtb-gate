#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

class NfcReader {
public:
  void begin();
  bool isInitialized() const { return initialized_; }
  bool readTag(String& outTagId);
  void startListening(unsigned long timeoutMs = 15000);
  bool getScannedTag(String& outTagId);
  void poll();  // Call from loop() to continuously scan during listen window

private:
  Adafruit_PN532* nfc_;
  bool initialized_ = false;
  String lastScannedTag_;
  bool tagScanned_ = false;
  unsigned long listeningUntil_ = 0;
};
