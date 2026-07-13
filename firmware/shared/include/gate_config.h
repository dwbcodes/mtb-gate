#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include "gate_types.h"

// gateNumber is the single source of truth: role, deviceId, and
// deviceLabel are all derived from it (1 = Start, 12 = Finish, else
// Intermediate — see buildDeviceId()/defaultDeviceLabel() and
// updateMacConfigFromJson() in main.cpp). role is persisted redundantly
// for convenience but recomputed from gateNumber on every load().
struct GateConfig {
  String deviceId;
  String deviceLabel;
  String apPassword;
  String staSsid;
  String staPassword;
  float startThreshold;
  float finishThreshold;
  float line2Threshold;
  float triggerDelta;  // voltage delta above/below baseline that counts as a trigger; set by calibration
  uint8_t wifiChannel;
  GateRole role;
  String peerMac;
  uint8_t gateNumber;
};

// Persists GateConfig to NVS ("mtb-gate" namespace) via Preferences.
class GateConfigStore {
public:
  GateConfig load();
  GateConfig save(const GateConfig& config);
  // deviceId format: "Gate-<#>-<mac>", with "Start"/"Finish" substituted
  // for the number when gateNumber is 1/12 respectively. Also used as the
  // AP SSID and DHCP hostname.
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
