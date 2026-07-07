#include "nfc_reader.h"
#include <esp_log.h>

// PN532 on I2C bus
// I2C pins: SDA=GPIO8, SCL=GPIO10
// GPIO11 = VDD_SPI on ESP32-C3 — must NOT be used.
// SDA=GPIO8, SCL=GPIO10 (user wiring).
// IRQ/RESET are set as GPIO modes in the PN532 constructor but never read
// (i2c_dev polling is used). Use free GPIOs that don't conflict with I2C.
#define PN532_IRQ   (6)
#define PN532_RESET (7)
#define NFC_INIT_TIMEOUT_MS 500  // Max time to wait for I2C response

void NfcReader::begin() {
  initialized_ = false;

  // Initialize I2C bus with explicit pins
  // ESP32-C3 DevKit M1: SDA=GPIO5, SCL=GPIO4
  Wire.begin(8, 10);  // SDA=GPIO8, SCL=GPIO10
  yield();

  // Probe I2C bus for PN532 (address 0x24) before touching the driver.
  // This returns immediately with NACK if no hardware is connected, avoiding
  // the indefinite IRQ-pin wait inside Adafruit_PN532::getFirmwareVersion().
  Wire.beginTransmission(0x24);
  if (Wire.endTransmission() != 0) {
    // No device at 0x24 — return without blocking
    return;
  }
  yield();

  nfc_ = new Adafruit_PN532(PN532_IRQ, PN532_RESET);
  yield();

  if (!nfc_->begin()) {
    yield();
    return;
  }
  yield();

  uint32_t versiondata = nfc_->getFirmwareVersion();
  if (!versiondata) {
    yield();
    return;
  }
  yield();

  if (!nfc_->SAMConfig()) {
    yield();
    return;
  }
  yield();

  initialized_ = true;

  // Suppress I2C error logs from Wire — PN532 polling generates harmless
  // "requestFrom(): i2cRead returned Error -1" on every no-tag read
  esp_log_level_set("Wire", ESP_LOG_NONE);
}

bool NfcReader::readTag(String& outTagId) {
  if (!initialized_) return false;

  uint8_t success;
  uint8_t uid[] = { 0, 0, 0, 0, 0, 0, 0 };
  uint8_t uidLength;

  // Wait for ISO14443A type cards (Mifare, etc) - short timeout keeps loop() responsive
  success = nfc_->readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 50);

  if (!success) {
    return false;
  }

  // Convert UID to hex string
  char tagIdStr[32] = {0};
  for (uint8_t i = 0; i < uidLength; i++) {
    snprintf(&tagIdStr[i*2], 4, "%02X", uid[i]);
  }

  outTagId = String(tagIdStr);
  lastScannedTag_ = outTagId;
  tagScanned_ = true;

  return true;
}

void NfcReader::startListening(unsigned long timeoutMs) {
  listeningUntil_ = millis() + timeoutMs;
  tagScanned_ = false;
}

bool NfcReader::getScannedTag(String& outTagId) {
  if (!initialized_) return false;

  // Check if listening timeout expired
  if (millis() > listeningUntil_) {
    return false;
  }

  // Try to read a tag
  if (readTag(outTagId)) {
    tagScanned_ = true;
    return true;
  }

  // Return previously scanned tag if available
  if (tagScanned_) {
    outTagId = lastScannedTag_;
    return true;
  }

  return false;
}

void NfcReader::poll() {
  if (!initialized_ || tagScanned_ || millis() > listeningUntil_) return;
  String tagId;
  readTag(tagId);  // result cached in lastScannedTag_/tagScanned_ if found
}
