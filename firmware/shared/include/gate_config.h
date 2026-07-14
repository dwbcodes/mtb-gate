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
  String apPassword = "changeme123";
  String staSsid;
  String staPassword;
  float startThreshold = 2.0F;
  float finishThreshold = 2.0F;
  float line2Threshold = 2.0F;
  float triggerDelta = 0.3F;  // voltage delta above/below baseline that counts as a trigger; set by calibration
  uint8_t wifiChannel = 1;
  GateRole role = GateRole::Start;
  String peerMac;
  uint8_t gateNumber = 1;
  bool     dualTriggerEnabled = false;    // enable dual-trigger (front + rear wheel) detection
  uint16_t wheelTrackTimeoutMs = 3000;    // window for second wheel before flagging wheel lift
  String   officialTrigger = "first";     // "first" or "second" — authoritative wheel for metrics
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
  static constexpr const char* kGateNumberKey    = "gateNum";
  static constexpr const char* kDualTriggerKey   = "dualTrigger";
  static constexpr const char* kWheelTimeoutKey  = "wheelTimeout";
  static constexpr const char* kOfficialTrigKey  = "officialTrig";

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
