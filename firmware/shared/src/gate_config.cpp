#include "gate_config.h"

GateRole parseGateRole(const String& roleStr) {
  if (roleStr.equalsIgnoreCase("finish"))       return GateRole::Finish;
  if (roleStr.equalsIgnoreCase("intermediate")) return GateRole::Intermediate;
  return GateRole::Start;
}

GateConfig GateConfigStore::load() {
  Preferences preferences;
  preferences.begin(kNamespace, true);
  const uint8_t rawGateNumber = preferences.getUChar(kGateNumberKey, 1);
  const uint8_t storedGateNumber = rawGateNumber > 0 ? rawGateNumber : 1;
  const String deviceId = buildDeviceId(storedGateNumber);
  const String storedLabel = preferences.getString(kDeviceLabelKey, defaultDeviceLabel(storedGateNumber));
  const String storedApPassword = preferences.getString(kApPasswordKey, "changeme123");
  const String storedStaSsid = preferences.getString(kStaSsidKey, "");
  const String storedStaPassword = preferences.getString(kStaPasswordKey, "");
  const float storedStartThreshold = preferences.getFloat(kStartThresholdKey, 2.0F);
  const float storedFinishThreshold = preferences.getFloat(kFinishThresholdKey, 2.0F);
  const float storedLine2Threshold = preferences.getFloat(kLine2ThresholdKey, 2.0F);
  const float storedTriggerDelta = preferences.getFloat(kTriggerDeltaKey, 0.3F);
  const uint8_t storedWifiChannel = preferences.getUChar(kWifiChannelKey, 1);
  const String storedRole = preferences.getString(kRoleKey, "start");
  const String storedPeerMac = preferences.getString(kPeerMacKey, "");
  preferences.end();

  return {
    deviceId,
    storedLabel,
    storedApPassword,
    storedStaSsid,
    storedStaPassword,
    storedStartThreshold,
    storedFinishThreshold,
    storedLine2Threshold,
    storedTriggerDelta,
    storedWifiChannel,
    parseGateRole(storedRole),
    storedPeerMac,
    storedGateNumber
  };
}

GateConfig GateConfigStore::save(const GateConfig& config) {
  Preferences preferences;
  preferences.begin(kNamespace, false);
  preferences.putString(kDeviceLabelKey, config.deviceLabel);
  preferences.putString(kApPasswordKey, config.apPassword);
  preferences.putString(kStaSsidKey, config.staSsid);
  preferences.putString(kStaPasswordKey, config.staPassword);
  preferences.putFloat(kStartThresholdKey, config.startThreshold);
  preferences.putFloat(kFinishThresholdKey, config.finishThreshold);
  preferences.putFloat(kLine2ThresholdKey, config.line2Threshold);
  preferences.putFloat(kTriggerDeltaKey, config.triggerDelta);
  preferences.putUChar(kWifiChannelKey, config.wifiChannel);
  preferences.putString(kRoleKey, gateRoleName(config.role));
  preferences.putString(kPeerMacKey, config.peerMac);
  preferences.putUChar(kGateNumberKey, config.gateNumber);
  preferences.end();
  return config;
}

String GateConfigStore::buildDeviceId(uint8_t gateNumber) {
  const uint64_t mac = ESP.getEfuseMac();
  // eFuse MAC is little-endian: byte 0 (first octet) sits in lowest bits
  const uint8_t b0 = (mac >>  0) & 0xFF;
  const uint8_t b1 = (mac >>  8) & 0xFF;
  const uint8_t b2 = (mac >> 16) & 0xFF;
  const uint8_t b3 = (mac >> 24) & 0xFF;
  const uint8_t b4 = (mac >> 32) & 0xFF;
  const uint8_t b5 = (mac >> 40) & 0xFF;
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "Gate-%d-%02x%02x%02x%02x%02x%02x",
    gateNumber, b0, b1, b2, b3, b4, b5);
  return String(buffer);
}

String GateConfigStore::defaultDeviceLabel(uint8_t gateNumber) {
  return "Gate " + String(gateNumber);  // 1-based: Gate 1, Gate 2, ...
}
