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
  const String storedApPassword = preferences.getString(kApPasswordKey, "changeme123");
  const String storedStaSsid = preferences.getString(kStaSsidKey, "");
  const String storedStaPassword = preferences.getString(kStaPasswordKey, "");
  const float storedStartThreshold = preferences.getFloat(kStartThresholdKey, 2.0F);
  const float storedFinishThreshold = preferences.getFloat(kFinishThresholdKey, 2.0F);
  const float storedLine2Threshold = preferences.getFloat(kLine2ThresholdKey, 2.0F);
  const float storedTriggerDelta = preferences.getFloat(kTriggerDeltaKey, 0.3F);
  const uint8_t storedWifiChannel = preferences.getUChar(kWifiChannelKey, 1);
  const String storedPeerMac = preferences.getString(kPeerMacKey, "");
  const bool storedDualTrigger = preferences.getBool(kDualTriggerKey, false);
  const uint16_t storedWheelTimeout = preferences.getUShort(kWheelTimeoutKey, 3000);
  const String storedOfficialTrig = preferences.getString(kOfficialTrigKey, "first");
  preferences.end();

  // Role is derived from gate number — gate 1 = Start, gate 12 = Finish, else Intermediate
  GateRole derivedRole = (storedGateNumber == 1) ? GateRole::Start
                       : (storedGateNumber == 12) ? GateRole::Finish
                       : GateRole::Intermediate;

  // Label: regenerate from gate number to stay in sync with naming convention
  String label = defaultDeviceLabel(storedGateNumber);

  return {
    deviceId,
    label,
    storedApPassword,
    storedStaSsid,
    storedStaPassword,
    storedStartThreshold,
    storedFinishThreshold,
    storedLine2Threshold,
    storedTriggerDelta,
    storedWifiChannel,
    derivedRole,
    storedPeerMac,
    storedGateNumber,
    storedDualTrigger,
    storedWheelTimeout,
    storedOfficialTrig
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
  preferences.putBool(kDualTriggerKey, config.dualTriggerEnabled);
  preferences.putUShort(kWheelTimeoutKey, config.wheelTrackTimeoutMs);
  preferences.putString(kOfficialTrigKey, config.officialTrigger);
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
  char buffer[32];
  const char* suffix = (gateNumber == 1) ? "Start" : (gateNumber == 12) ? "Finish" : nullptr;
  if (suffix) {
    snprintf(buffer, sizeof(buffer), "Gate-%s-%02x%02x%02x%02x%02x%02x",
      suffix, b0, b1, b2, b3, b4, b5);
  } else {
    snprintf(buffer, sizeof(buffer), "Gate-%d-%02x%02x%02x%02x%02x%02x",
      gateNumber, b0, b1, b2, b3, b4, b5);
  }
  return String(buffer);
}

String GateConfigStore::defaultDeviceLabel(uint8_t gateNumber) {
  if (gateNumber == 1) return "Gate Start";
  if (gateNumber == 12) return "Gate Finish";
  return "Gate " + String(gateNumber);
}
