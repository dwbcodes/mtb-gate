#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include "gate_types.h"

struct GateConfig {
  String deviceId;
  String deviceLabel;
  String apPassword;
  String staSsid;
  String staPassword;
  float startThreshold;
  float finishThreshold;
  float line2Threshold;
  float triggerDelta;
  uint8_t wifiChannel;
  GateRole role;
  String peerMac;
  uint8_t gateNumber;
};

class GateConfigStore {
public:
  GateConfig load();
  GateConfig save(const GateConfig& config);
  static String buildDeviceId(uint8_t gateNumber);

private:
  static constexpr const char* kNamespace = "mtb-gate";
  static constexpr const char* kDeviceLabelKey = "deviceLabel";
  static constexpr const char* kApPasswordKey = "apPassword";
  static constexpr const char* kStaSsidKey = "staSsid";
  static constexpr const char* kStaPasswordKey = "staPassword";
  static constexpr const char* kStartThresholdKey = "startTh";
  static constexpr const char* kFinishThresholdKey = "finishTh";
  static constexpr const char* kLine2ThresholdKey = "line2Th";
  static constexpr const char* kTriggerDeltaKey = "trigDelta";
  static constexpr const char* kWifiChannelKey = "wifiCh";
  static constexpr const char* kRoleKey = "role";
  static constexpr const char* kPeerMacKey = "peerMac";
  static constexpr const char* kGateNumberKey = "gateNum";

  static String defaultDeviceLabel(uint8_t gateNumber);
};

inline const char* gateRoleName(GateRole role) {
  switch (role) {
    case GateRole::Finish:       return "finish";
    case GateRole::Intermediate: return "intermediate";
    default:                     return "start";
  }
}

GateRole parseGateRole(const String& roleStr);
