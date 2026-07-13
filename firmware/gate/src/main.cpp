#include <Arduino.h>
#include <HardwareSerial.h>
#include <Wire.h>
#include <WebServer.h>
#include <WiFi.h>
#include <LittleFS.h>
#include <esp_now.h>
#include <ArduinoJson.h>
#include "gate_config.h"
#include "run_queue.h"
#include "sensor_gate.h"
#include "rider_store.h"
#include "nfc_reader.h"
#include "device_ui.h"
#include "event_store.h"
#include "gate_log.h"

namespace {
GateConfigStore configStore;
GateConfig config = {
  "Gate-1-setup",       // deviceId (overwritten by configStore.load())
  "Gate 1",             // deviceLabel
  "changeme123",        // apPassword
  "",                   // staSsid
  "",                   // staPassword
  2.0F,                 // startThreshold
  2.0F,                 // finishThreshold
  2.0F,                 // line2Threshold
  0.3F,                 // triggerDelta
  1,                    // wifiChannel
  GateRole::Start,      // role
  "",                   // peerMac
  1                     // gateNumber (1-based: 1=start, 2=finish, ...)
};

RunQueue queue;
SensorGate startSensor(2.0F);
SensorGate finishSensor(2.0F);
WebServer server(80);
RiderStore riderStore;
NfcReader nfcReader;
EventStore eventStore;
bool nfcInitDone = false;
unsigned long nfcInitAfterMs = 0;

unsigned long lastLogAt = 0;
IPAddress apIp;
IPAddress staIp;
bool pendingNetworkRestart = false;
bool pendingReboot = false;
bool pendingCalibration = false;
bool pendingChannelScan = false;

// Non-blocking calibration state machine
enum class CalState : uint8_t { Idle, PeerSent, LocalIdle, LocalPress, Done };
struct CalibrationContext {
  CalState state = CalState::Idle;
  unsigned long phaseStartMs = 0;
  float idleMin, idleMax, idleSum;
  int idleCount;
  float peakV;
  float troughV;
  String phase;
  String message;
  String gate;
  bool success;
  bool peerPressBeeped;
  bool skipLocal;  // peer-only mode: skip local calibration after peer
};
CalibrationContext cal;
String lastScannedNfcTag = "";
String observedNfcTag = "";
bool nfcTagPresent = false;

// ESP-Now messaging
enum class EspNowMsgType : uint8_t {
  Ping = 1,          // Start→broadcast: discovery + keepalive
  FinishTrigger = 2, // Finish→start: sensor triggered
  SyncRequest = 3,   // Start→finish: T1 = start millis()
  SyncResponse = 4,  // Finish→start: echo T1 + T2 = finish millis()
  SyncConfirm = 5,   // Start→finish: corrected offset
  RiderSync = 6,     // Start→broadcast: rider entry (chunked)
  Calibrate = 7,     // Start→peer: trigger remote calibration
};

struct __attribute__((packed)) EspNowPayload {
  EspNowMsgType type;
  unsigned long timestampMs;   // primary timestamp
  unsigned long timestampMs2;  // secondary (used for sync)
};

// Rider sync message — one rider per ESP-Now frame (max 250 bytes)
struct __attribute__((packed)) RiderSyncMsg {
  EspNowMsgType type;    // RiderSync
  uint8_t totalCount;    // total riders being sent (0 = clear all)
  uint8_t index;         // this rider's index (0-based)
  char tagId[24];        // null-terminated
  char displayName[32];  // null-terminated
};

uint8_t peerMacBytes[6] = {0};
bool espNowReady = false;
unsigned long lastPingAt = 0;
constexpr unsigned long PING_INTERVAL_MS = 10000;

// Clock sync state
long clockOffsetMs = 0;        // finish gate: add to local millis() to get start-gate time
bool clockSynced = false;
unsigned long syncT1 = 0;      // start gate: T1 of pending sync request
unsigned long lastRttMs = 0;   // start gate: last measured RTT
unsigned long lastSyncAtMs = 0; // start gate: when last sync completed

// Sensor pin and reading
constexpr int SENSOR_LINE1_PIN = 4;
constexpr int BUZZER_PIN = 5;
// LEDC hardware buzzer — attached once in setup(), toggled via duty
constexpr uint8_t BUZZER_LEDC_CHAN = 0;
unsigned long buzzerStopAtMs = 0;

void buzzerOff() {
  ledcWrite(BUZZER_LEDC_CHAN, 0);
  buzzerStopAtMs = 0;
}

void buzzerTone(unsigned int freq, unsigned long durationMs = 0) {
  if (freq == 0) { buzzerOff(); return; }
  ledcSetup(BUZZER_LEDC_CHAN, freq, 8);
  ledcWrite(BUZZER_LEDC_CHAN, 128);
  if (durationMs > 0) {
    buzzerStopAtMs = millis() + durationMs;
  }
}

// Ascending arpeggio inspired by classic arcade coin-insert jingle
void playStartTune() {
  static const uint16_t notes[] = {
    200, 240, 280, 320, 400, 480, 600, 800
  };
  static const uint16_t durations[] = {
    100, 100,  80,  80,  60,  60,  50,  200
  };
  for (int i = 0; i < 8; i++) {
    ledcSetup(BUZZER_LEDC_CHAN, notes[i], 8);
    ledcWrite(BUZZER_LEDC_CHAN, 128);
    delay(durations[i]);
    ledcWrite(BUZZER_LEDC_CHAN, 0);
    delay(10);
  }
}
constexpr float ADC_MAX = 4095.0F;
constexpr float ADC_VREF = 3.3F;

// Countdown state
constexpr int COUNTDOWN_SECONDS = 10;
constexpr unsigned long PENALTY_MS = 5000;
String activeRunId = "";
int lastAnnouncedSecond = -1;
bool falseStartDetected = false;
unsigned long falseStartTriggeredAtMs = 0;

float readSensorVoltage(int pin) {
  int raw = analogRead(pin);
  return (raw / ADC_MAX) * ADC_VREF;
}

// Baseline-relative trigger: detect spike above rolling average
constexpr int BASELINE_SAMPLES = 20;
float triggerDelta = 0.15F;  // voltage rise above baseline to trigger (updated from config/calibration)
constexpr int DEBOUNCE_COUNT = 3;
float baselineBuffer[BASELINE_SAMPLES];
int baselineIndex = 0;
bool baselineFilled = false;
int sensorAboveCount = 0;

void updateBaseline(float voltage) {
  baselineBuffer[baselineIndex] = voltage;
  baselineIndex = (baselineIndex + 1) % BASELINE_SAMPLES;
  if (baselineIndex == 0) baselineFilled = true;
}

float getBaseline() {
  int count = baselineFilled ? BASELINE_SAMPLES : baselineIndex;
  if (count == 0) return 1.65F;  // default rest voltage
  float sum = 0;
  for (int i = 0; i < count; i++) sum += baselineBuffer[i];
  return sum / count;
}

bool baselineFrozen = false;

void freezeBaseline() { baselineFrozen = true; }
void unfreezeBaseline() { baselineFrozen = false; }

bool sensorTriggered(int pin) {
  int raw = analogRead(pin);
  float voltage = (raw / ADC_MAX) * ADC_VREF;
  // Reject floor readings (0V = disconnected/corrupted)
  if (voltage < 0.02F) {
    sensorAboveCount = 0;
    return false;
  }
  float baseline = getBaseline();
  // ADC saturation detection: if baseline is high (>2.5V, i.e. sensor idles
  // near rail) and we hit ADC max, treat saturation AS the trigger signal.
  // The MPXV7002DP outputs ~2.5V idle at 5V supply, which maps to ~3.1V
  // on ESP32-C3 ADC. Pressure pushes it to rail (4095).
  bool adcSaturated = (raw >= 4090) && (baseline > 2.5F);
  // Bidirectional: MPXV7002DP pressure tube can produce signal in either
  // direction depending on port wiring. Detect any significant deviation.
  float deviation = voltage - baseline;
  if (adcSaturated || deviation > triggerDelta || deviation < -triggerDelta) {
    sensorAboveCount++;
  } else {
    sensorAboveCount = 0;
    if (!baselineFrozen) {
      updateBaseline(voltage);
    }
  }
  return sensorAboveCount >= DEBOUNCE_COUNT;
}

// Forward declaration for calibration
void sendEspNowMsg(EspNowMsgType type, const uint8_t* destMac, unsigned long ts1, unsigned long ts2);
void startWifi();
void initEspNow();

// target: "all" = peer then local (default), "local" = this gate only, "peer" = peer only
void startCalibration(bool fromStartGate, const String& target = "all") {
  if (activeRunId.length() > 0) {
    GateLog::info("CAL", "Cannot calibrate during active run");
    cal.state = CalState::Done;
    cal.phase = "done";
    cal.message = "Cannot calibrate during active run";
    cal.success = false;
    cal.phaseStartMs = millis();
    return;
  }

  buzzerTone(800, 300); // Short beep: calibration starting

  bool doPeer = fromStartGate && config.gateNumber == 1 && espNowReady && target != "local";
  bool doLocal = target != "peer";
  cal.skipLocal = !doLocal;

  if (doPeer) {
    cal.state = CalState::PeerSent;
    cal.phase = "peer_sent";
    cal.message = "Calibrating peer gate... Do NOT touch the finish tube.";
    cal.gate = "finish";
    cal.peerPressBeeped = false;
    GateLog::info("CAL", "Sending calibrate command to peer gate...");
    sendEspNowMsg(EspNowMsgType::Calibrate, peerMacBytes, 0, 0);
    cal.phaseStartMs = millis();
  } else if (doLocal) {
    cal.state = CalState::LocalIdle;
    cal.phase = "local_idle";
    cal.gate = (config.gateNumber == 1) ? "start" : "gate-" + String(config.gateNumber);
    cal.message = String(cal.gate) + ": Do NOT touch the tube (sampling noise)...";
    cal.idleMin = 9.0F;
    cal.idleMax = 0.0F;
    cal.idleSum = 0.0F;
    cal.idleCount = 0;
    cal.phaseStartMs = millis();
    GateLog::info("CAL", "Phase 1: Sampling idle noise for 3 seconds...");
  } else {
    // peer-only but no peer available
    cal.state = CalState::Done;
    cal.phase = "done";
    cal.message = "No peer gate available";
    cal.success = false;
    cal.phaseStartMs = millis();
  }
}

void updateCalibration() {
  if (cal.state == CalState::Idle) return;

  unsigned long elapsed = millis() - cal.phaseStartMs;

  if (cal.state == CalState::PeerSent) {
    if (elapsed >= 10000) {
      if (cal.skipLocal) {
        GateLog::info("CAL", "Peer calibration window complete (peer-only mode).");
        cal.state = CalState::Done;
        cal.phase = "done";
        cal.message = "Peer gate calibration complete";
        cal.success = true;
        buzzerTone(800, 200); delay(250);
        buzzerTone(1200, 300);
        cal.phaseStartMs = millis();
      } else {
        GateLog::info("CAL", "Peer calibration window complete. Starting local calibration...");
        cal.state = CalState::LocalIdle;
        cal.phase = "local_idle";
        cal.gate = "start";
        cal.message = "Start gate: Do NOT touch the tube (sampling noise)...";
        cal.idleMin = 9.0F;
        cal.idleMax = 0.0F;
        cal.idleSum = 0.0F;
        cal.idleCount = 0;
        cal.phaseStartMs = millis();
      }
    } else if (elapsed >= 3000 && elapsed < 8000) {
      cal.message = "Peer gate: PRESS the finish tube now!";
      if (!cal.peerPressBeeped) {
        cal.peerPressBeeped = true;
        buzzerTone(1000, 150); delay(200);
        buzzerTone(1000, 150);
      }
    }
    return;
  }

  if (cal.state == CalState::LocalIdle) {
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    if (v < cal.idleMin) cal.idleMin = v;
    if (v > cal.idleMax) cal.idleMax = v;
    cal.idleSum += v;
    cal.idleCount++;
    // Log every 10th sample to show ADC behavior during idle sampling
    if (cal.idleCount % 10 == 0) {
      GateLog::info("CAL", "idle sample #" + String(cal.idleCount) + " v=" + String(v, 2) +
        "V min=" + String(cal.idleMin, 2) + " max=" + String(cal.idleMax, 2));
    }

    if (elapsed >= 3000) {
      float idleAvg = cal.idleSum / cal.idleCount;
      float noiseRange = cal.idleMax - cal.idleMin;
      GateLog::info("CAL", "Idle: avg=" + String(idleAvg, 2) + "V noise=" + String(noiseRange, 2) + "V");

      // Sanity check: if idle SATURATES at ADC max, sensor is disconnected or ADC is corrupted
      // (Note: MPXV7002DP at 5V supply idles at ~2.5V real / ~3.1V mapped, which is fine)
      if (idleAvg > 3.28F) {
        GateLog::info("CAL", "FAILED - sensor saturated at ADC rail (" + String(idleAvg, 2) + "V), check wiring");
        cal.state = CalState::Done;
        cal.phase = "done";
        cal.message = "FAILED - sensor reads " + String(idleAvg, 2) + "V (rail), check wiring";
        cal.success = false;
        cal.phaseStartMs = millis();
        buzzerTone(400, 500);
        return;
      }

      cal.state = CalState::LocalPress;
      cal.phase = "local_press";
      cal.message = String(cal.gate) + ": PRESS the tube now!";
      cal.peakV = 0.0F;
      cal.troughV = 9.0F;
      cal.phaseStartMs = millis();
      // Three quick beeps: "PRESS the tube now!"
      buzzerTone(1200, 150); delay(200);
      buzzerTone(1200, 150); delay(200);
      buzzerTone(1200, 150);
      GateLog::info("CAL", "Phase 2: PRESS the tube now (5 seconds)...");
    }
    return;
  }

  if (cal.state == CalState::LocalPress) {
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    if (v > cal.peakV) cal.peakV = v;
    if (v < cal.troughV) cal.troughV = v;
    // Log every 10th sample to show peak/trough tracking during press phase
    static int pressCount = 0;
    pressCount++;
    if (pressCount % 10 == 0) {
      GateLog::info("CAL", "press #" + String(pressCount) + " v=" + String(v, 2) +
        "V peak=" + String(cal.peakV, 2) + " trough=" + String(cal.troughV, 2));
    }

    if (elapsed >= 5000) {
      pressCount = 0;
      float idleAvg = cal.idleSum / cal.idleCount;
      float noiseRange = cal.idleMax - cal.idleMin;
      // Bidirectional: tube press may increase OR decrease voltage depending on port wiring
      float peakDelta = cal.peakV - idleAvg;     // upward deviation
      float troughDelta = idleAvg - cal.troughV;  // downward deviation
      float maxDelta = max(peakDelta, troughDelta);
      GateLog::info("CAL", "Peak: " + String(cal.peakV, 2) + "V (+" + String(peakDelta, 2) +
        "V) Trough: " + String(cal.troughV, 2) + "V (-" + String(troughDelta, 2) + "V)");

      if (maxDelta < noiseRange * 1.2F) {
        GateLog::info("CAL", "FAILED - signal not significantly above noise");
        cal.message = "FAILED - press harder or check tube connection";
        cal.success = false;
        buzzerTone(400, 500); // Low tone: failure
      } else {
        // Set threshold midway between noise ceiling and strongest signal direction
        float newDelta = (noiseRange + maxDelta) / 2.0F;
        if (newDelta < 0.05F) newDelta = 0.05F;
        if (newDelta > 1.5F) newDelta = 1.5F;  // Cap at 1.5V — higher is likely bad data
        triggerDelta = newDelta;
        config.triggerDelta = newDelta;
        config = configStore.save(config);
        GateLog::info("CAL", "SUCCESS - delta set to " + String(newDelta, 2) + "V");
        cal.message = "SUCCESS - trigger delta set to " + String(newDelta, 2) + "V";
        cal.success = true;
        // Rising two-tone: success
        buzzerTone(800, 200); delay(250);
        buzzerTone(1200, 300);
      }
      cal.state = CalState::Done;
      cal.phase = "done";
      cal.phaseStartMs = millis();

      // Re-seed baseline from calibration idle average (not live reads which
      // may still be settling after the press phase)
      if (cal.success) {
        float idleAvg = cal.idleSum / cal.idleCount;
        for (int i = 0; i < BASELINE_SAMPLES; i++) {
          baselineBuffer[i] = idleAvg;
        }
        baselineFilled = true;
        sensorAboveCount = 0;
        unfreezeBaseline();  // let baseline self-correct during idle
        GateLog::info("CAL", "Baseline seeded from idle avg: " + String(idleAvg, 2) + "V delta=" + String(triggerDelta, 2) + "V");
      }
    }
    return;
  }

  if (cal.state == CalState::Done) {
    if (elapsed >= 5000) {
      cal.state = CalState::Idle;
      cal.phase = "idle";
      cal.message = "";
    }
  }
}

// --- ESP-Now helpers ---

bool parseMac(const String& macStr, uint8_t* out) {
  if (macStr.length() != 17) return false;
  return sscanf(macStr.c_str(), "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx",
    &out[0], &out[1], &out[2], &out[3], &out[4], &out[5]) == 6;
}

void registerEspNowPeer(const uint8_t* mac) {
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;
  if (!esp_now_is_peer_exist(mac)) {
    esp_now_add_peer(&peerInfo);
  }
}

void sendEspNowMsg(EspNowMsgType type, const uint8_t* destMac, unsigned long ts1 = 0, unsigned long ts2 = 0) {
  EspNowPayload payload;
  payload.type = type;
  payload.timestampMs = ts1 ? ts1 : millis();
  payload.timestampMs2 = ts2;
  esp_err_t result = esp_now_send(destMac, (uint8_t*)&payload, sizeof(payload));
  if (result != ESP_OK) {
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
      destMac[0], destMac[1], destMac[2], destMac[3], destMac[4], destMac[5]);
    GateLog::info("ESP-NOW", "Send FAILED to " + String(macStr) + " err=" + String(result));
  }
}

static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

void sendPing() {
  // Include Wi-Fi channel in timestampMs2 so non-start gates can auto-adopt
  sendEspNowMsg(EspNowMsgType::Ping, BROADCAST_MAC, millis(), (unsigned long)config.wifiChannel);
}

void broadcastRiders() {
  if (config.role != GateRole::Start) return;
  uint8_t total = (uint8_t)riderStore.count();

  if (total == 0) {
    // Send a single message with totalCount=0 to signal "clear all"
    RiderSyncMsg msg = {};
    msg.type = EspNowMsgType::RiderSync;
    msg.totalCount = 0;
    msg.index = 0;
    esp_now_send(BROADCAST_MAC, (uint8_t*)&msg, sizeof(msg));
    GateLog::info("RIDERS", "Broadcast clear (0 riders)");
    return;
  }

  for (uint8_t i = 0; i < total; i++) {
    RiderEntry* entry = riderStore.at(i);
    if (!entry) continue;

    RiderSyncMsg msg = {};
    msg.type = EspNowMsgType::RiderSync;
    msg.totalCount = total;
    msg.index = i;
    strncpy(msg.tagId, entry->tagId.c_str(), sizeof(msg.tagId) - 1);
    strncpy(msg.displayName, entry->displayName.c_str(), sizeof(msg.displayName) - 1);

    esp_now_send(BROADCAST_MAC, (uint8_t*)&msg, sizeof(msg));
    delay(15);  // small gap between frames to avoid congestion
  }
  GateLog::info("RIDERS", "Broadcast " + String(total) + " riders");
}

void sendSyncRequest() {
  if (!espNowReady) return;
  syncT1 = millis();
  sendEspNowMsg(EspNowMsgType::SyncRequest, peerMacBytes, syncT1);
  GateLog::info("SYNC", "Request sent (T1=" + String(syncT1) + ")");
}

void sendEspNowFinishTrigger() {
  if (!espNowReady) {
    GateLog::info("FINISH", "ESP-Now NOT ready - trigger lost! peerMac=" + config.peerMac);
    return;
  }
  GateLog::info("FINISH", "Sending finish trigger via ESP-Now to " + config.peerMac);
  sendEspNowMsg(EspNowMsgType::FinishTrigger, peerMacBytes, millis());
}

// sendRemoteCalibrate() removed — calibration is now non-blocking via CalibrationContext state machine

// Called on start gate when finish gate reports trigger
// finishMs = start gate's millis() at time of ESP-Now receipt
void onFinishReceived(unsigned long finishCorrectedMs) {
  for (size_t i = 0; i < queue.size(); i++) {
    RunRecord* run = queue.at(i);
    if (run && run->status == RunStatus::OnCourse && run->finishTriggeredAtMs == 0) {
      run->finishTriggeredAtMs = finishCorrectedMs;
      unsigned long goToFinishMs = finishCorrectedMs - run->goAtMs;
      unsigned long triggerToFinishMs = finishCorrectedMs - run->startTriggeredAtMs;
      unsigned long totalMs = goToFinishMs + (falseStartDetected ? PENALTY_MS : 0);
      buzzerTone(1500, 500);
      GateLog::info("FINISH", "---- Results ----");
      GateLog::info("FINISH", "  GO to Finish:      " + String(goToFinishMs / 1000.0F, 3) + "s");
      GateLog::info("FINISH", "  Trigger to Finish: " + String(triggerToFinishMs / 1000.0F, 3) + "s");
      GateLog::info("FINISH", "  Total:             " + String(totalMs / 1000.0F, 3) + "s" + (falseStartDetected ? " (includes 5.00s penalty)" : ""));
      GateLog::info("FINISH", "-----------------");
      eventStore.logEvent("finish_triggered", run->runId, run->riderId, finishCorrectedMs);
      run->status = RunStatus::Finished;
      eventStore.logRunSummary(*run, falseStartDetected);
      eventStore.logEvent("run_completed", run->runId, run->riderId, finishCorrectedMs);
      falseStartDetected = false;
      falseStartTriggeredAtMs = 0;
      return;
    }
  }
  GateLog::info("FINISH", "Received finish trigger but no active run");
}

void autoRegisterPeer(const uint8_t* mac, const char* macStr) {
  String senderMac = String(macStr);
  if (!espNowReady || config.peerMac != senderMac) {
    config.peerMac = senderMac;
    memcpy(peerMacBytes, mac, 6);
    registerEspNowPeer(peerMacBytes);
    espNowReady = true;
    config = configStore.save(config);
  }
}

void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len < 1) return;  // need at least the type byte
  EspNowMsgType msgType = (EspNowMsgType)data[0];

  // Handle RiderSync before the size check (different struct size)
  if (msgType == EspNowMsgType::RiderSync && len >= (int)sizeof(RiderSyncMsg)) {
    if (config.gateNumber == 1) return;  // start gate ignores
    const RiderSyncMsg* msg = (const RiderSyncMsg*)data;

    if (msg->totalCount == 0) {
      riderStore.clearAll();
      eventStore.exportRiders(riderStore);
      GateLog::info("RIDERS", "Cleared all riders (synced from start)");
      return;
    }

    // On first rider (index 0), clear existing to rebuild
    if (msg->index == 0) {
      riderStore.clearAll();
    }

    RiderEntry entry;
    entry.tagId = String(msg->tagId);
    entry.displayName = String(msg->displayName);
    entry.riderId = "rider-" + entry.tagId;
    riderStore.save(entry);

    if (msg->index == msg->totalCount - 1) {
      eventStore.exportRiders(riderStore);
      GateLog::info("RIDERS", "Synced " + String(msg->totalCount) + " riders from start gate");
    }
    return;
  }

  if (len < (int)sizeof(EspNowPayload)) return;
  const EspNowPayload* payload = (const EspNowPayload*)data;

  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
    mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  // --- Non-start gate handlers ---
  if (config.gateNumber != 1) {
    if (payload->type == EspNowMsgType::Ping) {
      String senderMac = String(macStr);
      bool configChanged = false;

      // Auto-discover start gate MAC
      if (config.peerMac != senderMac) {
        GateLog::info("ESP-NOW", "Auto-discovered start gate: " + senderMac + " (was: " + config.peerMac + ")");
        config.peerMac = senderMac;
        memcpy(peerMacBytes, mac, 6);
        registerEspNowPeer(peerMacBytes);
        espNowReady = true;
        configChanged = true;
      }

      // Auto-adopt Wi-Fi channel from start gate (carried in timestampMs2)
      int startChannel = (int)payload->timestampMs2;
      if (startChannel >= 1 && startChannel <= 13 && startChannel != config.wifiChannel) {
        GateLog::info("ESP-NOW", "Adopting start gate channel " + String(startChannel) + " (was: " + String(config.wifiChannel) + ")");
        config.wifiChannel = startChannel;
        configChanged = true;
        // Restart Wi-Fi on new channel
        config = configStore.save(config);
        startWifi();
        initEspNow();
        return;
      }

      if (configChanged) {
        config = configStore.save(config);
      }
      return;
    }

    if (payload->type == EspNowMsgType::SyncRequest) {
      // Respond immediately with T1 echoed + our local T2
      unsigned long T2 = millis();
      sendEspNowMsg(EspNowMsgType::SyncResponse, mac, payload->timestampMs, T2);
      return;
    }

    if (payload->type == EspNowMsgType::SyncConfirm) {
      // payload->timestampMs = start gate's millis at send
      // payload->timestampMs2 = RTT in ms
      unsigned long rttMs = payload->timestampMs2;
      clockOffsetMs = (long)payload->timestampMs + (long)(rttMs / 2) - (long)millis();
      clockSynced = true;
      GateLog::info("SYNC", "Clock synced: offset=" + String(clockOffsetMs) + "ms RTT=" + String(rttMs) + "ms");
      return;
    }

    if (payload->type == EspNowMsgType::Calibrate) {
      GateLog::info("CAL", "Remote calibration requested by start gate");
      pendingCalibration = true;
      return;
    }
    return;
  }

  // --- Start gate handlers ---
  // Auto-register any responding peer so placeholder MACs get replaced
  autoRegisterPeer(mac, macStr);

  if (payload->type == EspNowMsgType::SyncResponse) {
    unsigned long T4 = millis();
    unsigned long T1 = payload->timestampMs;   // our original T1 echoed back
    unsigned long rttMs = T4 - T1;
    lastRttMs = rttMs;
    lastSyncAtMs = T4;
    // Send confirm with our current time and the RTT
    sendEspNowMsg(EspNowMsgType::SyncConfirm, mac, millis(), rttMs);
    GateLog::info("SYNC", "Confirmed: RTT=" + String(rttMs) + "ms");
    return;
  }

  if (payload->type == EspNowMsgType::FinishTrigger) {
    GateLog::info("ESP-NOW", "Finish trigger from " + String(macStr));
    // Stamp with start gate's own millis() — authoritative clock per design.
    // ESP-Now latency (~5-15ms) is acceptable measurement error.
    onFinishReceived(millis());
  }
}

void initEspNow() {
  if (esp_now_init() != ESP_OK) {
    GateLog::info("ESP-NOW", "Init failed");
    return;
  }
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_register_send_cb([](const uint8_t* mac, esp_now_send_status_t status) {
    if (status != ESP_NOW_SEND_SUCCESS) {
      char macStr[18];
      snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
      GateLog::info("ESP-NOW", "Delivery FAILED to " + String(macStr));
    }
  });

  // Register broadcast peer on all gates so they can receive broadcasts
  registerEspNowPeer(BROADCAST_MAC);
  GateLog::info("ESP-NOW", "Channel=" + String(config.wifiChannel));

  // If we already have a saved peer, register it
  if (config.peerMac.length() == 17 && parseMac(config.peerMac, peerMacBytes)) {
    registerEspNowPeer(peerMacBytes);
    espNowReady = true;
    GateLog::info("ESP-NOW", "Ready, peer=" + config.peerMac);
  } else {
    GateLog::info("ESP-NOW", "Listening for peer...");
  }
}

bool hasStaConnection() {
  return staIp.toString() != "0.0.0.0";
}

void printHelp() {
  GateLog::print("Commands: status | role=start | role=finish | wifi | calibrate");
  GateLog::print("Console API: api status | api config | api config/wifi <json> | api config/time <json> | api config/mac <json> | api riders | api riders/add <json> | api riders/delete <json> | api ping");
}

void printStatus() {
  GateLog::print("Device " + config.deviceId + " (" + config.deviceLabel + ") running as " + gateRoleName(config.role));
  GateLog::print("AP SSID: " + config.deviceId);
  GateLog::print("AP Password: " + String(config.apPassword.length() > 0 ? config.apPassword : "<open>"));
  GateLog::print("AP IP: " + apIp.toString());
  GateLog::print("MAC: " + WiFi.macAddress());
  GateLog::print("STA SSID: " + String(config.staSsid.length() > 0 ? config.staSsid : "<not configured>"));
  GateLog::print("STA IP: " + staIp.toString());
}

void printWifiStatus() {
  GateLog::info("WIFI", "AP network " + config.deviceId + " available at http://" + apIp.toString());
  GateLog::info("WIFI", "AP SSID: " + config.deviceId);
  GateLog::info("WIFI", "AP Password: " + String(config.apPassword.length() > 0 ? config.apPassword : "<open>"));
  GateLog::info("WIFI", "AP IP: " + apIp.toString());
  if (config.staSsid.length() > 0 && hasStaConnection()) {
    GateLog::info("WIFI", "Station network " + config.staSsid + " available at http://" + staIp.toString());
  }
}

void applySensorThresholds() {
  startSensor = SensorGate(config.startThreshold);
  finishSensor = SensorGate(config.finishThreshold);
}

void startWifi() {
  yield();
  WiFi.mode(WIFI_AP_STA);
  yield();
  WiFi.setSleep(false);
  yield();

  const uint8_t gateIpOctet = config.gateNumber > 0 ? config.gateNumber : 1;
  const IPAddress apStaticIp(192, 168, 4, gateIpOctet);
  const IPAddress apGateway(192, 168, 4, 1);
  const IPAddress apSubnet(255, 255, 255, 0);
  WiFi.softAPConfig(apStaticIp, apGateway, apSubnet);
  yield();

  bool apStarted = false;
  if (config.apPassword.length() >= 8) {
    apStarted = WiFi.softAP(config.deviceId.c_str(), config.apPassword.c_str(), config.wifiChannel);
  } else {
    apStarted = WiFi.softAP(config.deviceId.c_str(), nullptr, config.wifiChannel);
  }
  yield();
  apIp = apStarted ? WiFi.softAPIP() : IPAddress(0, 0, 0, 0);
  yield();

  staIp = IPAddress(0, 0, 0, 0);
  if (config.staSsid.length() > 0) {
    WiFi.setHostname(config.deviceId.c_str());
    WiFi.begin(config.staSsid.c_str(), config.staPassword.c_str());
    yield();
    const unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 3000UL) {
      delay(50);
      yield();
    }
    yield();

    if (WiFi.status() == WL_CONNECTED) {
      staIp = WiFi.localIP();
    }
  }
  yield();
}

bool validPassword(const String& password) {
  return password.length() == 0 || password.length() >= 8;
}

static const char* runStatusName(RunStatus s) {
  switch (s) {
    case RunStatus::Queued:        return "Queued";
    case RunStatus::Countdown:     return "Countdown";
    case RunStatus::AwaitingStart: return "AwaitingStart";
    case RunStatus::OnCourse:      return "OnCourse";
    case RunStatus::Finished:      return "Finished";
    case RunStatus::TimedOut:      return "TimedOut";
    case RunStatus::Cancelled:     return "Cancelled";
    default:                       return "Unknown";
  }
}

String statusJson() {
  JsonDocument doc;
  doc["deviceId"] = config.deviceId;
  doc["deviceLabel"] = config.deviceLabel;
  doc["role"] = gateRoleName(config.role);
  doc["mac"] = WiFi.macAddress();
  doc["uptimeMs"] = millis();
  doc["apSsid"] = config.deviceId;
  doc["apIp"] = apIp.toString();
  doc["staSsid"] = config.staSsid;
  doc["staIp"] = staIp.toString();
  doc["startThreshold"] = config.startThreshold;
  doc["finishThreshold"] = config.finishThreshold;
  doc["line2Threshold"] = config.line2Threshold;
  doc["triggerDelta"] = config.triggerDelta;
  JsonObject espNow = doc["espNow"].to<JsonObject>();
  espNow["configured"] = config.peerMac.length() > 0;
  espNow["peerMac"] = config.peerMac;
  espNow["lastRttMs"] = lastRttMs;
  long syncAgo = lastSyncAtMs > 0 ? (long)(millis() - lastSyncAtMs) : -1;
  espNow["lastSyncAgoMs"] = syncAgo;
  espNow["reachable"] = syncAgo >= 0 && syncAgo < 60000;
  espNow["wifiChannel"] = config.wifiChannel;

  JsonArray queueArr = doc["queue"].to<JsonArray>();
  for (size_t i = 0; i < queue.size(); i++) {
    RunRecord* run = queue.at(i);
    if (!run) continue;
    JsonObject entry = queueArr.add<JsonObject>();
    entry["runId"] = run->runId;
    entry["riderId"] = run->riderId;
    entry["riderName"] = run->riderName;
    entry["status"] = runStatusName(run->status);
    JsonObject metrics = entry["metrics"].to<JsonObject>();
    if (run->goAtMs > 0 && run->startTriggeredAtMs > 0)
      metrics["reactionMs"] = (long)run->startTriggeredAtMs - (long)run->goAtMs;
    else
      metrics["reactionMs"] = nullptr;
    if (run->startTriggeredAtMs > 0 && run->line2TriggeredAtMs > 0)
      metrics["launchMs"] = (long)(run->line2TriggeredAtMs - run->startTriggeredAtMs);
    else
      metrics["launchMs"] = nullptr;
    if (run->startTriggeredAtMs > 0 && run->finishTriggeredAtMs > 0)
      metrics["courseMs"] = (long)(run->finishTriggeredAtMs - run->startTriggeredAtMs);
    else
      metrics["courseMs"] = nullptr;
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

String configJson() {
  JsonDocument doc;
  doc["deviceId"] = config.deviceId;
  doc["deviceLabel"] = config.deviceLabel;
  doc["gateNumber"] = config.gateNumber;
  doc["role"] = gateRoleName(config.role);
  doc["apPassword"] = "***";
  doc["staSsid"] = config.staSsid;
  doc["staPassword"] = "***";
  doc["startThreshold"] = config.startThreshold;
  doc["finishThreshold"] = config.finishThreshold;
  doc["line2Threshold"] = config.line2Threshold;
  doc["triggerDelta"] = config.triggerDelta;
  doc["wifiChannel"] = config.wifiChannel;
  doc["peerMac"] = config.peerMac;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

String ridersJson() {
  JsonDocument doc;
  JsonArray riders = doc.to<JsonArray>();
  for (size_t i = 0; i < riderStore.count(); i++) {
    RiderEntry* entry = riderStore.at(i);
    if (entry) {
      JsonObject rider = riders.add<JsonObject>();
      rider["riderId"] = entry->riderId;
      rider["displayName"] = entry->displayName;
      rider["tagId"] = entry->tagId;
    }
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

void printApiResponse(const String& payload) {
  GateLog::info("API", payload);
}

bool payloadHasError(const String& payload) {
  return payload.indexOf("\"error\"") >= 0;
}

void sendJson(int statusCode, const String& payload) {
  server.send(statusCode, "application/json", payload);
}

void sendJsonError(int statusCode, const char* message) {
  JsonDocument doc;
  doc["error"] = message;
  String payload;
  serializeJson(doc, payload);
  sendJson(statusCode, payload);
}

void sendJsonOperation(HTTPMethod method, String (*operation)(const String&), bool restartNetwork = false) {
  if (server.method() != method) {
    sendJsonError(405, "Method not allowed");
    return;
  }

  const String body = server.arg("plain");
  if (body.length() == 0) {
    sendJsonError(400, "Body required");
    return;
  }

  const String payload = operation(body);
  if (payloadHasError(payload)) {
    sendJson(400, payload);
    return;
  }

  sendJson(200, payload);
  if (restartNetwork) {
    pendingNetworkRestart = true;
  }
}

void sendEmptyBodyOperation(HTTPMethod method, String (*operation)()) {
  if (server.method() != method) {
    sendJsonError(405, "Method not allowed");
    return;
  }

  sendJson(200, operation());
}

String updateTimeConfigFromJson(const String& body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    return R"({"error":"Invalid JSON"})";
  }

  GateConfig next = config;
  if (doc["startThreshold"].is<float>()) next.startThreshold = doc["startThreshold"].as<float>();
  if (doc["finishThreshold"].is<float>()) next.finishThreshold = doc["finishThreshold"].as<float>();
  if (doc["line2Threshold"].is<float>()) next.line2Threshold = doc["line2Threshold"].as<float>();
  if (doc["triggerDelta"].is<float>()) next.triggerDelta = doc["triggerDelta"].as<float>();

  if (next.startThreshold < 0.0F || next.startThreshold > 2.0F ||
      next.finishThreshold < 0.0F || next.finishThreshold > 2.0F ||
      next.line2Threshold < 0.0F || next.line2Threshold > 2.0F) {
    return R"({"error":"Thresholds must be 0.00-2.00"})";
  }
  if (next.triggerDelta < 0.01F || next.triggerDelta > 2.0F) {
    return R"({"error":"triggerDelta must be 0.01-2.00"})";
  }

  config = configStore.save(next);
  applySensorThresholds();
  triggerDelta = config.triggerDelta;
  return R"({"ok":true})";
}

String updateWifiConfigFromJson(const String& body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    return R"({"error":"Invalid JSON"})";
  }

  GateConfig next = config;
  if (doc["apPassword"].is<String>()) next.apPassword = doc["apPassword"].as<String>();
  if (doc["staSsid"].is<String>()) next.staSsid = doc["staSsid"].as<String>();
  if (doc["staPassword"].is<String>()) next.staPassword = doc["staPassword"].as<String>();
  if (doc["wifiChannel"].is<int>()) next.wifiChannel = doc["wifiChannel"].as<int>();

  if (!validPassword(next.apPassword)) {
    return R"({"error":"apPassword must be empty or >=8 chars"})";
  }
  if (next.wifiChannel < 1 || next.wifiChannel > 13) {
    return R"({"error":"wifiChannel must be 1-13"})";
  }

  config = configStore.save(next);
  return R"({"ok":true})";
}

String updateMacConfigFromJson(const String& body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    return R"({"error":"Invalid JSON"})";
  }

  GateConfig next = config;
  if (doc["peerMac"].is<String>()) next.peerMac = doc["peerMac"].as<String>();
  if (doc["gateNumber"].is<int>()) {
    const int gn = doc["gateNumber"].as<int>();
    if (gn < 1 || gn > 254) {
      return R"({"error":"gateNumber must be 1-254"})";
    }
    next.gateNumber = (uint8_t)gn;
  }
  // Always derive deviceId, role, and label from gate number
  next.deviceId = GateConfigStore::buildDeviceId(next.gateNumber);
  next.role = (next.gateNumber == 1) ? GateRole::Start
            : (next.gateNumber == 12) ? GateRole::Finish
            : GateRole::Intermediate;
  next.deviceLabel = (next.gateNumber == 1) ? "Gate Start"
                   : (next.gateNumber == 12) ? "Gate Finish"
                   : "Gate " + String(next.gateNumber);

  if (next.peerMac.length() > 0 && next.peerMac.length() != 17) {
    return R"({"error":"peerMac must be AA:BB:CC:DD:EE:FF format"})";
  }

  config = configStore.save(next);
  pendingReboot = true;
  return R"({"ok":true,"rebooting":true})";
}

String addRiderFromJson(const String& body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    return R"({"error":"Invalid JSON"})";
  }

  if (!doc["tagId"].is<String>() || !doc["displayName"].is<String>()) {
    return R"({"error":"tagId and displayName required"})";
  }

  String tagId = doc["tagId"].as<String>();
  String displayName = doc["displayName"].as<String>();
  RiderEntry entry;
  entry.riderId = "rider-" + tagId;
  entry.displayName = displayName;
  entry.tagId = tagId;
  riderStore.save(entry);
  eventStore.logEvent("rider_registered", "", entry.riderId);
  eventStore.exportRiders(riderStore);
  broadcastRiders();
  return R"({"ok":true})";
}

String deleteRiderFromJson(const String& body) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    return R"({"error":"Invalid JSON"})";
  }

  if (!doc["tagId"].is<String>()) {
    return R"({"error":"tagId required"})";
  }

  String removedTagId = doc["tagId"].as<String>();
  riderStore.remove(removedTagId);
  eventStore.logEvent("rider_removed", "", "rider-" + removedTagId);
  eventStore.exportRiders(riderStore);
  broadcastRiders();
  return R"({"ok":true})";
}

String pingJson() {
  return R"({"ok":true,"sent":false})";
}

bool requireStartGateForPeerCommand() {
  if (config.gateNumber == 1) return true;
  sendJsonError(409, "Start Gate only");
  return false;
}

bool requireEspNowForPeerCommand() {
  if (espNowReady) return true;
  sendJsonError(409, "ESP-NOW is not ready");
  return false;
}

bool requireConnectedPeerForPeerCommand() {
  if (config.peerMac.length() == 17) return true;
  sendJsonError(409, "No ESP-NOW peer connected");
  return false;
}

void sendPeerCommandOk(const char* message, bool sent = true) {
  JsonDocument doc;
  doc["ok"] = true;
  doc["sent"] = sent;
  doc["message"] = message;
  if (config.peerMac.length() > 0) doc["peerMac"] = config.peerMac;
  String payload;
  serializeJson(doc, payload);
  sendJson(200, payload);
}

void sendNoCacheHeaders() {
  server.sendHeader("Cache-Control", "no-cache, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
}

void sendCompressedAsset(int statusCode, const char* contentType, const uint8_t* data, size_t len) {
  sendNoCacheHeaders();
  server.sendHeader("Content-Encoding", "gzip");
  server.send_P(statusCode, contentType, (const char*)data, len);
}

void handleRoot() {
  sendCompressedAsset(200, "text/html; charset=utf-8", index_html_data, index_html_len);
}

void handleStylesCss() {
  sendCompressedAsset(200, "text/css", styles_css_data, styles_css_len);
}

void handleMainJs() {
  sendCompressedAsset(200, "application/javascript", main_js_data, main_js_len);
}

void sendMarkdownDoc(const uint8_t* data, size_t len) {
  sendCompressedAsset(200, "text/markdown; charset=utf-8", data, len);
}

void handleDocsApi() { sendMarkdownDoc(docs_api_md_data, sizeof(docs_api_md_data)); }
void handleDocsCurlExamples() { sendMarkdownDoc(docs_curl_examples_md_data, sizeof(docs_curl_examples_md_data)); }
void handleDocsApiStatus() { sendMarkdownDoc(docs_api_status_md_data, sizeof(docs_api_status_md_data)); }
void handleDocsApiRiders() { sendMarkdownDoc(docs_api_riders_md_data, sizeof(docs_api_riders_md_data)); }
void handleDocsApiConfig() { sendMarkdownDoc(docs_api_config_md_data, sizeof(docs_api_config_md_data)); }
void handleDocsApiWifi() { sendMarkdownDoc(docs_api_wifi_md_data, sizeof(docs_api_wifi_md_data)); }
void handleDocsApiTime() { sendMarkdownDoc(docs_api_time_md_data, sizeof(docs_api_time_md_data)); }
void handleDocsApiMac() { sendMarkdownDoc(docs_api_mac_md_data, sizeof(docs_api_mac_md_data)); }

void handleDocsOpenApiJson() {
  sendCompressedAsset(200, "application/json; charset=utf-8", docs_openapi_json_data, docs_openapi_json_len);
}

}  // Close namespace

void startRunForRider(const String& tagId);

void handleStatusApi() {
  server.send(200, "application/json; charset=utf-8", statusJson());
}

void restartNetworking() {
  WiFi.disconnect(true, true);
  delay(200);
  startWifi();
  printWifiStatus();
}

void handleGetConfig() {
  sendJson(200, configJson());
}

void handlePutConfigWifi() {
  sendJsonOperation(HTTP_PUT, updateWifiConfigFromJson, true);
}

void handlePutConfigTime() {
  sendJsonOperation(HTTP_PUT, updateTimeConfigFromJson);
}

void handlePutConfigMac() {
  sendJsonOperation(HTTP_PUT, updateMacConfigFromJson);
}

void handleGetRiders() {
  sendJson(200, ridersJson());
}

void handlePostRiders() {
  sendJsonOperation(HTTP_POST, addRiderFromJson);
}

void handleDeleteRiders() {
  if (server.method() != HTTP_DELETE) {
    sendJsonError(405, "Method not allowed");
    return;
  }

  String tagId = server.arg("tagId");
  if (tagId.length() == 0) {
    String body = server.arg("plain");
    if (body.length() > 0) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, body);
      if (error) {
        sendJsonError(400, "Invalid JSON");
        return;
      }
      if (doc["tagId"].is<String>()) {
        tagId = doc["tagId"].as<String>();
      }
    }
  }
  if (tagId.length() == 0) {
    sendJsonError(400, "tagId required");
    return;
  }

  riderStore.remove(tagId);
  eventStore.logEvent("rider_removed", "", "rider-" + tagId);
  eventStore.exportRiders(riderStore);
  broadcastRiders();
  sendJson(200, R"({"ok":true})");
}

void handlePostReboot() {
  sendJson(200, R"({"ok":true})");
  GateLog::info("REBOOT", "Reboot requested via API");
  delay(500);
  ESP.restart();
}

void handlePostCalibrate() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (cal.state != CalState::Idle) {
    sendJsonError(409, "Calibration already in progress");
    return;
  }
  String target = "all";
  if (server.hasArg("gate")) {
    target = server.arg("gate");
    if (target != "all" && target != "local" && target != "peer") {
      sendJsonError(400, "gate must be 'all', 'local', or 'peer'");
      return;
    }
  }
  startCalibration(true, target);
  sendJson(200, R"({"ok":true,"message":"Calibration started"})");
}

void handleGetCalibrateStatus() {
  JsonDocument doc;
  doc["phase"] = cal.phase.length() ? cal.phase : "idle";
  doc["message"] = cal.message.length() ? cal.message : "Ready to calibrate";
  doc["gate"] = cal.gate.length() ? cal.gate : "";
  doc["triggerDelta"] = config.triggerDelta;
  if (cal.state == CalState::Done) doc["success"] = cal.success;
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handlePostPing() {
  sendEmptyBodyOperation(HTTP_POST, pingJson);
}

void handlePostPeerPing() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand()) return;
  sendPing();
  sendPeerCommandOk("ESP-NOW discovery ping broadcast");
}

void handlePostPeerTest() {
  if (!requireEspNowForPeerCommand()) return;
  // Send sync request and return current connectivity state
  if (espNowReady) {
    sendSyncRequest();
  }
  JsonDocument doc;
  doc["ok"] = true;
  doc["peerMac"] = config.peerMac;
  doc["espNowReady"] = espNowReady;
  doc["wifiChannel"] = config.wifiChannel;
  doc["lastRttMs"] = lastRttMs;
  long syncAgo = lastSyncAtMs > 0 ? (long)(millis() - lastSyncAtMs) : -1;
  doc["lastSyncAgoMs"] = syncAgo;
  doc["reachable"] = syncAgo >= 0 && syncAgo < 60000;
  doc["clockSynced"] = clockSynced;
  doc["clockOffsetMs"] = clockOffsetMs;
  doc["message"] = (syncAgo >= 0 && syncAgo < 60000)
    ? "Peer reachable (RTT " + String(lastRttMs) + "ms)"
    : "Peer NOT reachable - check channel and distance";
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handlePostPeerSync() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand() || !requireConnectedPeerForPeerCommand()) return;
  sendSyncRequest();
  sendPeerCommandOk("ESP-NOW clock sync request sent");
}

void handlePostPeerCalibrate() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand() || !requireConnectedPeerForPeerCommand()) return;
  sendEspNowMsg(EspNowMsgType::Calibrate, peerMacBytes);
  GateLog::info("CAL", "Remote calibration command sent via peer API");
  sendPeerCommandOk("ESP-NOW peer calibration command sent");
}

void handlePostPeerClock() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand()) return;
  sendSyncRequest();
  // Return last known sync data (new sync result will be available on next poll)
  JsonDocument doc;
  doc["ok"] = true;
  doc["message"] = "Clock sync request sent";
  doc["lastRttMs"] = lastRttMs;
  doc["lastSyncAgoMs"] = lastSyncAtMs > 0 ? millis() - lastSyncAtMs : -1;
  doc["peerClockOffset"] = clockOffsetMs;
  doc["peerClockSynced"] = clockSynced;
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handleGetPeerClock() {
  JsonDocument doc;
  doc["startGateMs"] = millis();
  doc["lastRttMs"] = lastRttMs;
  doc["lastSyncAgoMs"] = lastSyncAtMs > 0 ? (long)(millis() - lastSyncAtMs) : -1;
  doc["peerClockOffset"] = clockOffsetMs;
  doc["peerClockSynced"] = clockSynced;
  doc["role"] = gateRoleName(config.role);
  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void sendPingOnAllChannels() {
  if (!espNowReady) return;
  GateLog::info("ESP-NOW", "Scanning all channels for peer " + config.peerMac);

  // Remove existing peer registration
  esp_now_del_peer(peerMacBytes);

  for (uint8_t ch = 1; ch <= 13; ch++) {
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, peerMacBytes, 6);
    peerInfo.channel = ch;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);

    sendEspNowMsg(EspNowMsgType::Ping, peerMacBytes, millis(), (unsigned long)config.wifiChannel);
    delay(20);

    esp_now_del_peer(peerMacBytes);
  }

  // Re-register on channel 0 (current channel) for normal operation
  registerEspNowPeer(peerMacBytes);
  GateLog::info("ESP-NOW", "Channel scan complete, peer re-registered on current channel");
}

void handlePostPeerPush() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand()) return;
  pendingChannelScan = true;
  sendPeerCommandOk("Channel scan queued - pinging peer on all 13 channels");
}

void handlePostPeerRidersSync() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (!requireStartGateForPeerCommand() || !requireEspNowForPeerCommand()) return;
  broadcastRiders();
  sendPeerCommandOk("ESP-NOW rider roster sync broadcast");
}

void handleNfcStartListen() {
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  // Initialize NFC reader on first use (lazy init)
  if (!nfcReader.isInitialized()) {
    nfcReader.begin();
  }

  // Start listening for NFC tags for 15 seconds
  lastScannedNfcTag = "";
  if (nfcReader.isInitialized()) {
    nfcReader.startListening(15000);  // 15 second listen window
    server.send(200, "application/json", R"({"ok":true,"message":"Listening for NFC card..."})");
  } else {
    server.send(503, "application/json", R"({"error":"NFC reader not detected. Check power, SDA/SCL wiring: SDA=GPIO8, SCL=GPIO10"})");
  }
}

void handleNfcGetTag() {
  if (server.method() != HTTP_GET) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }
  
  // Check for scanned tag
  String tagId;
  if (nfcReader.getScannedTag(tagId)) {
    lastScannedNfcTag = tagId;
    String response = R"({"ok":true,"tagId":")" + tagId + R"("})";
    server.send(200, "application/json", response);
  } else {
    server.send(200, "application/json", R"({"ok":false,"tagId":null})");
  }
}


void handleNfcDiagnostics() {
  // Try to initialize NFC reader if not yet initialized
  if (!nfcReader.isInitialized()) {
    nfcReader.begin();
  }

  String payload = "{";
  payload += R"("initialized":)" + String(nfcReader.isInitialized() ? "true" : "false") + ",";
  payload += R"("message":")";

  if (nfcReader.isInitialized()) {
    payload += "NFC reader initialized successfully";
  } else {
    payload += "NFC reader not detected or not initialized. Check power and I2C wiring: SDA=GPIO8 (pin 5), SCL=GPIO10 (pin 4), GND, 3.3V";
  }

  payload += R"(")";
  payload += "}";
  server.send(200, "application/json", payload);
}


void handleI2cScan() {
  String response = R"({"devices":[)";
  bool found = false;
  
  // Scan I2C addresses 0x00-0x7F
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t error = Wire.endTransmission();
    
    if (error == 0) {  // Device found
      if (found) response += ",";
      response += "0x" + String(addr, HEX);
      found = true;
    }
  }
  
  response += R"(],"message":")";
  if (found) {
    response += "Found I2C device(s). If PN532 uses 0x24, it should be detected.";
  } else {
    response += "No I2C devices found! Check power, GND, SDA/SCL connections.";
  }
  response += R"("})";
  
  server.send(200, "application/json", response);
}


void handleGetEvents() {
  int limit = 50;
  if (server.hasArg("limit")) limit = server.arg("limit").toInt();
  if (limit < 1) limit = 1;
  if (limit > 50) limit = 50;
  sendJson(200, eventStore.getEventsJson(limit));
}

void handleGetRuns() {
  int limit = 50;
  if (server.hasArg("limit")) limit = server.arg("limit").toInt();
  if (limit < 1) limit = 1;
  if (limit > 50) limit = 50;
  sendJson(200, eventStore.getRunsJson(limit));
}

// --- /api/results: merged live queue + persisted runs ---

void handleGetResults() {
  int limit = 20;
  if (server.hasArg("limit")) limit = server.arg("limit").toInt();
  if (limit < 1) limit = 1;
  if (limit > 50) limit = 50;

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();

  // Live queue runs (active/in-progress first)
  for (size_t i = 0; i < queue.size(); i++) {
    RunRecord* run = queue.at(i);
    if (!run) continue;
    JsonObject obj = arr.add<JsonObject>();
    obj["runId"] = run->runId;
    obj["riderId"] = run->riderId;
    obj["riderName"] = run->riderName;
    obj["status"] = runStatusName(run->status);
    obj["live"] = true;
    if (run->goAtMs > 0 && run->startTriggeredAtMs > 0)
      obj["reactionMs"] = (long)run->startTriggeredAtMs - (long)run->goAtMs;
    if (run->startTriggeredAtMs > 0 && run->line2TriggeredAtMs > 0)
      obj["launchMs"] = (long)(run->line2TriggeredAtMs - run->startTriggeredAtMs);
    if (run->startTriggeredAtMs > 0 && run->finishTriggeredAtMs > 0)
      obj["courseMs"] = (long)(run->finishTriggeredAtMs - run->startTriggeredAtMs);
  }

  // Persisted runs (newest first, already JSON objects from getRunsJson)
  int persistedLimit = limit - (int)queue.size();
  if (persistedLimit > 0) {
    String persisted = eventStore.getRunsJson(persistedLimit);
    JsonDocument pdoc;
    deserializeJson(pdoc, persisted);
    JsonArray parr = pdoc.as<JsonArray>();
    for (JsonObject prun : parr) {
      // Skip duplicates (run might be in both queue and persisted)
      String pRunId = prun["runId"].as<String>();
      bool dup = false;
      for (size_t i = 0; i < queue.size(); i++) {
        RunRecord* qr = queue.at(i);
        if (qr && qr->runId == pRunId) { dup = true; break; }
      }
      if (!dup) {
        JsonObject obj = arr.add<JsonObject>();
        for (JsonPair kv : prun) obj[kv.key()] = kv.value();
        obj["live"] = false;
      }
    }
  }

  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handlePostResults() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (config.role != GateRole::Start) {
    sendJsonError(409, "Start gate only");
    return;
  }
  JsonDocument body;
  if (deserializeJson(body, server.arg("plain"))) {
    sendJsonError(400, "Invalid JSON");
    return;
  }
  String tagId = body["tagId"] | "";
  if (tagId.length() == 0) {
    sendJsonError(400, "tagId required");
    return;
  }
  startRunForRider(tagId);
  // Return current active run info
  if (activeRunId.length() > 0) {
    RunRecord* run = queue.find(activeRunId);
    if (run) {
      JsonDocument resp;
      resp["ok"] = true;
      resp["runId"] = run->runId;
      resp["riderName"] = run->riderName;
      resp["status"] = runStatusName(run->status);
      String out;
      serializeJson(resp, out);
      sendJson(200, out);
      return;
    }
  }
  sendJson(200, R"({"ok":true,"message":"Run started or re-scan cancelled previous"})");
}

void handlePostResultsStop() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  if (activeRunId.length() == 0) {
    sendJsonError(409, "No active run");
    return;
  }
  RunRecord* run = queue.find(activeRunId);
  if (run) {
    run->status = RunStatus::Cancelled;
    eventStore.logEvent("run_cancelled", activeRunId, run->riderId, millis());
    GateLog::info("RUN", "Run cancelled via API: " + activeRunId);
  }
  activeRunId = "";
  falseStartDetected = false;
  falseStartTriggeredAtMs = 0;
  buzzerOff();
  unfreezeBaseline();
  queue.removeTerminal();
  sendJson(200, R"({"ok":true,"message":"Active run cancelled"})");
}

void handleDeleteResults() {
  if (server.method() != HTTP_DELETE) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  JsonDocument body;
  if (deserializeJson(body, server.arg("plain"))) {
    sendJsonError(400, "Invalid JSON");
    return;
  }
  String runId = body["runId"] | "";
  if (runId.length() == 0) {
    sendJsonError(400, "runId required");
    return;
  }
  // Check live queue first
  RunRecord* live = queue.find(runId);
  if (live) {
    if (live->runId == activeRunId) {
      activeRunId = "";
      falseStartDetected = false;
      falseStartTriggeredAtMs = 0;
      buzzerOff();
      unfreezeBaseline();
    }
    queue.remove(runId);
    sendJson(200, R"({"ok":true,"source":"live"})");
    return;
  }
  // Try persisted
  if (eventStore.deleteRun(runId)) {
    sendJson(200, R"({"ok":true,"source":"persisted"})");
    return;
  }
  sendJsonError(404, "Run not found");
}

void handleGetStorage() {
  sendJson(200, eventStore.getStorageJson());
}

void handleGetSessions() {
  sendJson(200, eventStore.getSessionsJson());
}

bool normalizeLittleFsPath(const String& input, String& out) {
  out = input;
  out.trim();
  out.replace("\\", "/");
  if (out.length() == 0) out = "/";
  if (!out.startsWith("/")) out = "/" + out;
  while (out.indexOf("//") >= 0) out.replace("//", "/");
  if (out.indexOf("..") >= 0) return false;
  if (out.length() > 1 && out.endsWith("/")) out.remove(out.length() - 1);
  return true;
}

String fileNameFromPath(const String& path) {
  if (path == "/") return "/";
  int slash = path.lastIndexOf('/');
  return slash >= 0 ? path.substring(slash + 1) : path;
}

String contentTypeForPath(const String& path) {
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".jsonl")) return "application/x-ndjson; charset=utf-8";
  if (path.endsWith(".txt") || path.endsWith(".log") || path.endsWith(".md")) return "text/plain; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "text/plain; charset=utf-8";
}

void handleGetFiles() {
  String path;
  if (!normalizeLittleFsPath(server.arg("path"), path)) {
    sendJsonError(400, "Invalid path");
    return;
  }

  File dir = LittleFS.open(path);
  if (!dir) {
    sendJsonError(404, "Path not found");
    return;
  }
  if (!dir.isDirectory()) {
    dir.close();
    sendJsonError(400, "Path is not a directory");
    return;
  }

  JsonDocument doc;
  doc["path"] = path;
  doc["totalBytes"] = LittleFS.totalBytes();
  doc["usedBytes"] = LittleFS.usedBytes();
  JsonArray entries = doc["entries"].to<JsonArray>();

  File entry = dir.openNextFile();
  while (entry) {
    String entryPath = String(entry.path());
    if (!entryPath.startsWith("/")) entryPath = path == "/" ? "/" + entryPath : path + "/" + entryPath;
    JsonObject obj = entries.add<JsonObject>();
    obj["name"] = fileNameFromPath(entryPath);
    obj["path"] = entryPath;
    obj["type"] = entry.isDirectory() ? "dir" : "file";
    obj["size"] = entry.isDirectory() ? 0 : entry.size();
    entry.close();
    entry = dir.openNextFile();
  }
  dir.close();

  String out;
  serializeJson(doc, out);
  sendJson(200, out);
}

void handleGetFileView() {
  String path;
  if (!normalizeLittleFsPath(server.arg("path"), path)) {
    sendJsonError(400, "Invalid path");
    return;
  }

  File file = LittleFS.open(path, "r");
  if (!file) {
    sendJsonError(404, "File not found");
    return;
  }
  if (file.isDirectory()) {
    file.close();
    sendJsonError(400, "Path is a directory");
    return;
  }

  constexpr size_t kMaxFileViewBytes = 24576;
  size_t fileSize = file.size();
  bool truncated = fileSize > kMaxFileViewBytes;
  String body;
  body.reserve((truncated ? kMaxFileViewBytes : fileSize) + 1);
  size_t readBytes = 0;
  while (file.available() && readBytes < kMaxFileViewBytes) {
    body += char(file.read());
    readBytes++;
  }
  file.close();

  server.sendHeader("X-File-Size", String(fileSize));
  server.sendHeader("X-File-Truncated", truncated ? "true" : "false");
  sendNoCacheHeaders();
  server.send(200, contentTypeForPath(path), body);
}

void handleGetSessionFile() {
  // URL: /api/sessions/<num>/<filename>
  // WebServer doesn't support path params, so we use query params
  if (!server.hasArg("num") || !server.hasArg("file")) {
    sendJsonError(400, "num and file query params required");
    return;
  }
  int num = server.arg("num").toInt();
  String filename = server.arg("file");

  // Only allow safe filenames
  if (filename != "events.jsonl" && filename != "runs.jsonl" &&
      filename != "manifest.json" && filename != "sync.json") {
    sendJsonError(400, "Invalid filename");
    return;
  }

  String content = eventStore.getSessionFile(num, filename);
  if (content.length() == 0) {
    sendJsonError(404, "File not found");
    return;
  }

  String contentType = filename.endsWith(".json") ? "application/json" : "application/x-ndjson";
  server.send(200, contentType, content);
}

void handlePostPrune() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  eventStore.pruneOldSessions(5);
  sendJson(200, eventStore.getStorageJson());
}

void configureWebServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/styles.css", HTTP_GET, handleStylesCss);
  server.on("/main.js", HTTP_GET, handleMainJs);
  server.on("/docs/API.md", HTTP_GET, handleDocsApi);
  server.on("/docs/openapi.json", HTTP_GET, handleDocsOpenApiJson);
  server.on("/docs/CURL_EXAMPLES.md", HTTP_GET, handleDocsCurlExamples);
  server.on("/docs/API_STATUS.md", HTTP_GET, handleDocsApiStatus);
  server.on("/docs/API_RIDERS.md", HTTP_GET, handleDocsApiRiders);
  server.on("/docs/API_CONFIG.md", HTTP_GET, handleDocsApiConfig);
  server.on("/docs/API_WIFI.md", HTTP_GET, handleDocsApiWifi);
  server.on("/docs/API_TIME.md", HTTP_GET, handleDocsApiTime);
  server.on("/docs/API_MAC.md", HTTP_GET, handleDocsApiMac);

  // REST API endpoints
  server.on("/api/status", HTTP_GET, handleStatusApi);
  server.on("/api/config", HTTP_GET, handleGetConfig);
  server.on("/api/config/wifi", HTTP_PUT, handlePutConfigWifi);
  server.on("/api/config/time", HTTP_PUT, handlePutConfigTime);
  server.on("/api/config/mac", HTTP_PUT, handlePutConfigMac);
  server.on("/api/riders", HTTP_GET, handleGetRiders);
  server.on("/api/riders", HTTP_POST, handlePostRiders);
  server.on("/api/riders", HTTP_DELETE, handleDeleteRiders);
  server.on("/api/ping", HTTP_POST, handlePostPing);
  server.on("/api/peer/ping", HTTP_POST, handlePostPeerPing);
  server.on("/api/peer/test", HTTP_POST, handlePostPeerTest);
  server.on("/api/peer/sync", HTTP_POST, handlePostPeerSync);
  server.on("/api/peer/calibrate", HTTP_POST, handlePostPeerCalibrate);
  server.on("/api/peer/clock", HTTP_POST, handlePostPeerClock);
  server.on("/api/peer/clock", HTTP_GET, handleGetPeerClock);
  server.on("/api/peer/push", HTTP_POST, handlePostPeerPush);
  server.on("/api/peer/riders/sync", HTTP_POST, handlePostPeerRidersSync);
  server.on("/api/reboot", HTTP_POST, handlePostReboot);
  server.on("/api/calibrate", HTTP_POST, handlePostCalibrate);
  server.on("/api/calibrate/status", HTTP_GET, handleGetCalibrateStatus);
  
  // Event/storage endpoints
  server.on("/api/results", HTTP_GET, handleGetResults);
  server.on("/api/results", HTTP_POST, handlePostResults);
  server.on("/api/results/stop", HTTP_POST, handlePostResultsStop);
  server.on("/api/results", HTTP_DELETE, handleDeleteResults);
  server.on("/api/events", HTTP_GET, handleGetEvents);
  server.on("/api/runs", HTTP_GET, handleGetRuns);
  server.on("/api/storage", HTTP_GET, handleGetStorage);
  server.on("/api/files", HTTP_GET, handleGetFiles);
  server.on("/api/files/view", HTTP_GET, handleGetFileView);
  server.on("/api/sessions", HTTP_GET, handleGetSessions);
  server.on("/api/sessions/file", HTTP_GET, handleGetSessionFile);
  server.on("/api/storage/prune", HTTP_POST, handlePostPrune);

  // NFC endpoints
  server.on("/api/nfc/listen", HTTP_POST, handleNfcStartListen);
  server.on("/api/nfc/tag", HTTP_GET, handleNfcGetTag);
  server.on("/api/nfc/diagnostics", HTTP_GET, handleNfcDiagnostics);
  server.on("/api/i2c/scan", HTTP_GET, handleI2cScan);
  
  server.enableCORS(true);
  server.begin();
}

void handleSerialCommand(const String& rawCommand) {
  String command = rawCommand;
  command.trim();  // strips \r, \n, and leading/trailing spaces
  if (command.length() == 0) return;

  if (command.equalsIgnoreCase("api status")) {
    printApiResponse(statusJson());
    return;
  }

  if (command.equalsIgnoreCase("api config")) {
    printApiResponse(configJson());
    return;
  }

  if (command.startsWith("api config/wifi ")) {
    printApiResponse(updateWifiConfigFromJson(command.substring(16)));
    pendingNetworkRestart = true;
    return;
  }

  if (command.startsWith("api config/time ")) {
    printApiResponse(updateTimeConfigFromJson(command.substring(16)));
    return;
  }

  if (command.startsWith("api config/mac ")) {
    printApiResponse(updateMacConfigFromJson(command.substring(15)));
    return;
  }

  if (command.equalsIgnoreCase("api riders")) {
    printApiResponse(ridersJson());
    return;
  }

  if (command.startsWith("api riders/add ")) {
    printApiResponse(addRiderFromJson(command.substring(15)));
    return;
  }

  if (command.startsWith("api riders/delete ")) {
    printApiResponse(deleteRiderFromJson(command.substring(18)));
    return;
  }

  if (command.equalsIgnoreCase("api ping")) {
    printApiResponse(R"({"ok":true,"sent":false})");
    return;
  }

  if (command.equalsIgnoreCase("api runs")) {
    printApiResponse(eventStore.getRunsJson(10));
    return;
  }

  if (command.equalsIgnoreCase("api storage")) {
    printApiResponse(eventStore.getStorageJson());
    return;
  }

  if (command.equalsIgnoreCase("status")) {
    printStatus();
    return;
  }

  if (command.equalsIgnoreCase("role=start")) {
    config.role = GateRole::Start;
    config = configStore.save(config);
    GateLog::print("Saved role=start. Rebooting...");
    delay(500);
    ESP.restart();
    return;
  }

  if (command.equalsIgnoreCase("role=finish")) {
    config.role = GateRole::Finish;
    config = configStore.save(config);
    GateLog::print("Saved role=finish. Rebooting...");
    delay(500);
    ESP.restart();
    return;
  }

  if (command.equalsIgnoreCase("adc")) {
    GateLog::info("ADC", "Scanning all ADC pins (GPIO 0-4)...");
    for (int pin = 0; pin <= 4; pin++) {
      float v = (analogRead(pin) / ADC_MAX) * ADC_VREF;
      GateLog::info("ADC", "GPIO" + String(pin) + ": " + String(v, 2) + "V (raw=" + String(analogRead(pin)) + ")");
    }
    return;
  }

  if (command.equalsIgnoreCase("calibrate")) {
    if (cal.state != CalState::Idle) {
      GateLog::info("CAL", "Calibration already in progress");
      return;
    }
    startCalibration(true);
    return;
  }

  if (command.startsWith("scan=")) {
    String tagId = command.substring(5);
    tagId.trim();
    if (tagId.length() > 0) {
      GateLog::info("SERIAL", "Simulated NFC scan: " + tagId);
      startRunForRider(tagId);
    } else {
      GateLog::print("Usage: scan=<tagId>");
    }
    return;
  }

  if (command.equalsIgnoreCase("wifi")) {
    printWifiStatus();
    printStatus();
    return;
  }

  if (command.equalsIgnoreCase("reboot")) {
    GateLog::print("Rebooting...");
    delay(500);
    ESP.restart();
    return;
  }

  printHelp();
}

void startRunForRider(const String& tagId) {
  RiderEntry* rider = nullptr;
  for (size_t i = 0; i < riderStore.count(); i++) {
    RiderEntry* e = riderStore.at(i);
    if (e && e->tagId == tagId) { rider = e; break; }
  }
  if (!rider) {
    GateLog::info("RUN", "Unknown tag " + tagId + " - register rider first");
    return;
  }
  if (activeRunId.length() > 0) {
    // Same rider re-scans -> stop and delete their active run immediately.
    RunRecord* activeRun = queue.find(activeRunId);
    if (activeRun && activeRun->riderId == rider->riderId) {
      const String cancelledRunId = activeRunId;
      GateLog::info("RUN", "Rider " + rider->displayName + " re-scanned - stopping and deleting run");
      eventStore.logEvent("run_cancelled", cancelledRunId, rider->riderId, millis());
      activeRunId = "";
      falseStartDetected = false;
      falseStartTriggeredAtMs = 0;
      buzzerOff();
      unfreezeBaseline();
      queue.remove(cancelledRunId);
      return;
    }
    GateLog::info("RUN", "Run already active for another rider, ignoring scan");
    return;
  }

  RunRecord run;
  run.runId = config.deviceId + "-" + rider->riderId + "-" + String(millis());
  run.riderId = rider->riderId;
  run.riderName = rider->displayName;
  run.status = RunStatus::Queued;
  run.queuedAtMs = millis();
  run.countdownStartedAtMs = 0;
  run.goAtMs = 0;
  run.startTriggeredAtMs = 0;
  run.line2TriggeredAtMs = 0;
  run.finishTriggeredAtMs = 0;

  if (!queue.enqueue(run)) {
    GateLog::info("RUN", "Queue full");
    return;
  }

  activeRunId = run.runId;
  lastAnnouncedSecond = -1;
  falseStartDetected = false;
  falseStartTriggeredAtMs = 0;
  sensorAboveCount = 0;

  eventStore.logEvent("run_created", run.runId, rider->riderId, millis());

  // Sync clocks with finish gate before countdown
  sendSyncRequest();

  playStartTune();
  GateLog::info("RUN", "Rider " + rider->displayName + " scanned - starting countdown");
}

unsigned long lastStartDiagAt = 0;

void handleStartGateLoop(unsigned long now) {
  if (activeRunId.length() == 0) {
    // Force-update baseline during idle — no run active, so any reading is
    // valid idle data. This lets baseline self-correct after calibration or
    // sensor drift without being gated by triggerDelta.
    float idleV = readSensorVoltage(SENSOR_LINE1_PIN);
    if (idleV > 0.02F && idleV < 3.28F) {
      updateBaseline(idleV);
    }
    sensorAboveCount = 0;
    // Periodic idle diagnostics every 10s (matches finish gate behavior)
    if (now - lastStartDiagAt >= 10000) {
      lastStartDiagAt = now;
      float v = readSensorVoltage(SENSOR_LINE1_PIN);
      float bl = getBaseline();
      GateLog::info("START", "Idle: v=" + String(v, 2) + "V bl=" + String(bl, 2) +
        "V thr=" + String(bl + triggerDelta, 2) + "V delta=" + String(triggerDelta, 2) + "V");
    }
    return;
  }

  RunRecord* run = queue.find(activeRunId);
  if (!run) { activeRunId = ""; unfreezeBaseline(); return; }

  // Queued → start countdown
  if (run->status == RunStatus::Queued) {
    queue.updateStatus(run->runId, RunStatus::Countdown, now);
    freezeBaseline();
    lastAnnouncedSecond = COUNTDOWN_SECONDS;
    eventStore.logEvent("countdown_started", run->runId, run->riderId, now);
    GateLog::info("RUN", "Countdown: " + String(COUNTDOWN_SECONDS));
    return;
  }

  // Countdown → tick each second, check for false start
  if (run->status == RunStatus::Countdown) {
    unsigned long elapsed = now - run->countdownStartedAtMs;
    int secondsLeft = COUNTDOWN_SECONDS - (int)(elapsed / 1000);

    if (secondsLeft >= 0 && secondsLeft != lastAnnouncedSecond) {
      lastAnnouncedSecond = secondsLeft;
      if (secondsLeft > 0) {
        GateLog::info("RUN", "Countdown: " + String(secondsLeft));
      }
      switch (secondsLeft) {
        case 10: buzzerTone(800, 500); break;
        case 5: case 4: case 3: case 2: case 1: buzzerTone(1000, 200); break;
      }
      // Diagnostic: log sensor state each countdown second
      float cdV = readSensorVoltage(SENSOR_LINE1_PIN);
      float cdBl = getBaseline();
      GateLog::info("SENSOR", "v=" + String(cdV, 2) + "V bl=" + String(cdBl, 2) +
        "V thr=" + String(cdBl + triggerDelta, 2) + "V above=" + String(sensorAboveCount));
    }

    // Check false start throughout entire countdown
    if (!falseStartDetected && sensorTriggered(SENSOR_LINE1_PIN)) {
      falseStartDetected = true;
      falseStartTriggeredAtMs = now;
      eventStore.logEvent("false_start", run->runId, run->riderId, now);
      float fsV = readSensorVoltage(SENSOR_LINE1_PIN);
      float fsBl = getBaseline();
      GateLog::info("RUN", "FALSE START! v=" + String(fsV, 2) + "V bl=" + String(fsBl, 2) +
        "V delta=" + String(triggerDelta, 2) + "V - 5s penalty");
    }

    // Countdown complete
    if (elapsed >= (unsigned long)COUNTDOWN_SECONDS * 1000UL) {
      eventStore.logEvent("go", run->runId, run->riderId, now);
      if (falseStartDetected) {
        // Rider already crossed the line — go straight to OnCourse
        queue.updateStatus(run->runId, RunStatus::AwaitingStart, now);
        queue.updateStatus(run->runId, RunStatus::OnCourse, now);
        if (falseStartTriggeredAtMs > 0) {
          run->startTriggeredAtMs = falseStartTriggeredAtMs;
        }
        GateLog::info("RUN", "GO! FALSE START - Reaction: 5.00s (penalty)");
        GateLog::info("RUN", "On course - waiting for finish gate...");
        buzzerTone(2000, 2000);
        unfreezeBaseline();
      } else {
        queue.updateStatus(run->runId, RunStatus::AwaitingStart, now);
        sensorAboveCount = 0;  // reset debounce — don't carry countdown noise into trigger
        GateLog::info("RUN", "GO!");
        buzzerTone(2000, 2000);
      }
    }
    return;
  }

  // AwaitingStart → wait for sensor trigger
  if (run->status == RunStatus::AwaitingStart) {
    // Diagnostic: log sensor state every 500ms while waiting for trigger
    static unsigned long lastAwaitDiagAt = 0;
    if (now - lastAwaitDiagAt >= 500) {
      lastAwaitDiagAt = now;
      float awV = readSensorVoltage(SENSOR_LINE1_PIN);
      float awBl = getBaseline();
      GateLog::info("SENSOR", "await: v=" + String(awV, 2) + "V bl=" + String(awBl, 2) +
        "V thr=" + String(awBl + triggerDelta, 2) + "V above=" + String(sensorAboveCount));
    }
    if (sensorTriggered(SENSOR_LINE1_PIN)) {
      queue.updateStatus(run->runId, RunStatus::OnCourse, now);
      eventStore.logEvent("start_triggered", run->runId, run->riderId, now);
      unsigned long reactionMs = run->startTriggeredAtMs - run->goAtMs;
      float tV = readSensorVoltage(SENSOR_LINE1_PIN);
      float tBl = getBaseline();
      GateLog::info("RUN", "TRIGGERED v=" + String(tV, 2) + "V bl=" + String(tBl, 2) +
        "V delta=" + String(triggerDelta, 2) + "V - Reaction: " + String(reactionMs / 1000.0F, 3) + "s");
      GateLog::info("RUN", "On course - waiting for finish gate...");
      unfreezeBaseline();
    }
    return;
  }

  // OnCourse → waiting for finish gate (handled by onFinishReceived callback)
  // Timeout after 5 minutes to prevent stuck runs when finish gate loses state
  if (run->status == RunStatus::OnCourse) {
    constexpr unsigned long ONCOURSE_TIMEOUT_MS = 5UL * 60UL * 1000UL;
    if (run->startTriggeredAtMs > 0 && (now - run->startTriggeredAtMs) > ONCOURSE_TIMEOUT_MS) {
      GateLog::info("RUN", "OnCourse timeout after 5 min - no finish received for " + run->runId);
      run->status = RunStatus::TimedOut;
      eventStore.logEvent("run_timed_out", run->runId, run->riderId, now);
      activeRunId = "";
      buzzerOff();
      unfreezeBaseline();
      queue.removeTerminal();
    }
    return;
  }

  // Finished → clear active run and clean up queue
  if (run->status == RunStatus::Finished) {
    buzzerOff();
    activeRunId = "";
    queue.removeTerminal();
    return;
  }

  // Cancelled → clean up
  if (run->status == RunStatus::Cancelled) {
    activeRunId = "";
    queue.removeTerminal();
    return;
  }
}

bool finishTriggered = false;
unsigned long finishCooldownUntil = 0;
constexpr unsigned long FINISH_COOLDOWN_MS = 5000;  // 5s lockout after trigger
unsigned long lastFinishDiagAt = 0;

void handleFinishGateLoop() {
  // Skip sensor checks during calibration to avoid false triggers
  if (cal.state != CalState::Idle && cal.state != CalState::Done) return;

  if (finishTriggered) {
    if (millis() > finishCooldownUntil) {
      finishTriggered = false;
      sensorAboveCount = 0;
      unfreezeBaseline();
      GateLog::info("FINISH", "Ready for next trigger");
    }
    return;  // Skip ALL sensor reads during cooldown
  }

  // Periodic diagnostics every 10s
  if (millis() - lastFinishDiagAt >= 10000) {
    lastFinishDiagAt = millis();
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    float bl = getBaseline();
    GateLog::info("FINISH", "Sensor: v=" + String(v, 2) + "V baseline=" + String(bl, 2) +
      "V delta=" + String(triggerDelta, 2) + "V threshold=" + String(bl + triggerDelta, 2) +
      "V espNow=" + String(espNowReady ? "yes" : "NO") +
      " peer=" + config.peerMac);
  }

  if (sensorTriggered(SENSOR_LINE1_PIN)) {
    GateLog::info("FINISH", "Sensor triggered - sending to start gate");
    buzzerTone(1500, 500);
    sendEspNowFinishTrigger();
    eventStore.logEvent("finish_sensor", "", "", millis(), clockOffsetMs);
    finishTriggered = true;
    finishCooldownUntil = millis() + FINISH_COOLDOWN_MS;
    sensorAboveCount = 0;
    freezeBaseline();
  }
}

void setup() {
  GateLog::begin(115200);
  delay(250);

  GateLog::raw("");
  GateLog::raw("========================================");
  GateLog::raw("[BOOT] MTB Gate starting...");
  GateLog::raw("========================================");

  config = configStore.load();
  GateLog::setHost(config.deviceId);

  riderStore.loadAll();
  eventStore.begin(config.deviceId, config.gateNumber, gateRoleName(config.role));
  eventStore.exportRiders(riderStore);
  applySensorThresholds();
  triggerDelta = config.triggerDelta;
  pinMode(SENSOR_LINE1_PIN, INPUT);
  ledcSetup(BUZZER_LEDC_CHAN, 1000, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_LEDC_CHAN);
  ledcWrite(BUZZER_LEDC_CHAN, 0);
  // Seed baseline with initial readings
  for (int i = 0; i < BASELINE_SAMPLES; i++) {
    baselineBuffer[i] = readSensorVoltage(SENSOR_LINE1_PIN);
    delay(5);
  }
  baselineFilled = true;
  GateLog::info("SENSOR", "GPIO" + String(SENSOR_LINE1_PIN) + " baseline=" + String(getBaseline(), 2) + "V delta=" + String(triggerDelta, 2) + "V");
  startWifi();
  initEspNow();
  configureWebServer();
  nfcInitAfterMs = millis() + 2000;

  GateLog::raw("========================================");
  GateLog::info("BOOT", "MTB Gate ready");
  GateLog::raw("========================================");
  printStatus();
  printWifiStatus();
  printHelp();

  // Auto-calibrate idle noise on boot (no press required).
  // Samples sensor for ~2 seconds to establish noise floor, then sets
  // triggerDelta to 3× noise range. A full calibration with press can
  // refine this later.
  GateLog::info("CAL", "Boot auto-calibration: sampling idle noise...");
  Serial.flush();
  float bootIdleMin = 9.0F, bootIdleMax = 0.0F, bootIdleSum = 0.0F;
  int bootSamples = 0;
  unsigned long bootCalStart = millis();
  while (millis() - bootCalStart < 2000) {
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    if (v > 0.02F && v < 3.28F) {
      if (v < bootIdleMin) bootIdleMin = v;
      if (v > bootIdleMax) bootIdleMax = v;
      bootIdleSum += v;
      bootSamples++;
    }
    delay(2);
  }
  if (bootSamples > 0) {
    float bootIdleAvg = bootIdleSum / bootSamples;
    float noiseRange = bootIdleMax - bootIdleMin;
    // Set delta to 3× noise range, with reasonable floor/ceiling
    float bootDelta = noiseRange * 3.0F;
    if (bootDelta < 0.10F) bootDelta = 0.10F;
    if (bootDelta > 1.5F) bootDelta = 1.5F;
    // Only apply if no prior calibration or if it improves on default
    if (config.triggerDelta <= 0.0F || config.triggerDelta >= 1.5F) {
      triggerDelta = bootDelta;
      config.triggerDelta = bootDelta;
      config = configStore.save(config);
      GateLog::info("CAL", "Boot delta set to " + String(bootDelta, 2) + "V (noise=" + String(noiseRange, 2) + "V)");
    } else {
      GateLog::info("CAL", "Boot noise=" + String(noiseRange, 2) + "V, keeping saved delta=" + String(config.triggerDelta, 2) + "V");
    }
    // Seed baseline from boot idle average
    for (int i = 0; i < BASELINE_SAMPLES; i++) {
      baselineBuffer[i] = bootIdleAvg;
    }
    baselineFilled = true;
    sensorAboveCount = 0;
    GateLog::info("CAL", "Baseline=" + String(bootIdleAvg, 2) + "V thr=" + String(bootIdleAvg + triggerDelta, 2) + "V");
    Serial.flush();
  }
}

void loop() {
  if (!nfcInitDone && config.role == GateRole::Start && millis() > nfcInitAfterMs) {
    nfcInitDone = true;
    nfcReader.begin();
    if (nfcReader.isInitialized()) {
      GateLog::info("NFC", "Reader initialized successfully");
    } else {
      GateLog::info("NFC", "Reader not detected - releasing I2C bus");
      Wire.end();  // Free I2C hardware — it corrupts ADC reads even when idle
    }
  }

  // Skip NFC I2C during calibration AND active runs — I2C transactions on
  // ESP32-C3 corrupt ADC reads (causes 0-3.3V oscillation on sensor pin).
  // Re-scan cancellation is unavailable during runs; use web UI cancel instead.
  bool nfcSafe = (cal.state == CalState::Idle || cal.state == CalState::Done)
                 && activeRunId.length() == 0;
  if (nfcSafe) {
    nfcReader.poll();

    // Continuously scan NFC on the start gate. A tag is accepted only when it
    // newly appears so holding it in place does not start and immediately cancel.
    if (config.role == GateRole::Start && nfcReader.isInitialized()) {
      String tagId;
      if (nfcReader.readTag(tagId)) {
        const bool newPresentation = !nfcTagPresent || observedNfcTag != tagId;
        nfcTagPresent = true;
        observedNfcTag = tagId;
        if (newPresentation) {
          lastScannedNfcTag = tagId;
          GateLog::info("NFC", "Tag scanned: " + tagId);
          startRunForRider(tagId);
        }
      } else {
        nfcTagPresent = false;
        observedNfcTag = "";
      }
    }

    // Also check API-triggered listen window (for registration flow)
    if (config.role == GateRole::Start) {
      String tagId;
      if (nfcReader.getScannedTag(tagId)) {
        lastScannedNfcTag = tagId;
      }
    }
  }

  if (GateLog::available()) {
    handleSerialCommand(GateLog::readLine());
  }
  server.handleClient();

  if (buzzerStopAtMs > 0 && millis() >= buzzerStopAtMs) {
    buzzerOff();
  }

  if (pendingReboot) {
    pendingReboot = false;
    GateLog::info("REBOOT", "Config changed, rebooting...");
    delay(500);
    ESP.restart();
  }

  if (pendingNetworkRestart) {
    pendingNetworkRestart = false;
    delay(100);
    restartNetworking();
  }

  if (pendingCalibration) {
    pendingCalibration = false;
    startCalibration(false);
  }

  if (pendingChannelScan) {
    pendingChannelScan = false;
    sendPingOnAllChannels();
  }

  updateCalibration();

  const unsigned long now = millis();
  // Poll at 100ms during active run or on finish gate for responsive sensor detection
  const bool fastPoll = (config.role == GateRole::Start && activeRunId.length() > 0) ||
                         config.role != GateRole::Start;
  const unsigned long intervalMs = fastPoll ? 100 : 1000;
  if (now - lastLogAt < intervalMs) {
    return;
  }

  lastLogAt = now;

  // Start gate: broadcast ping every 10s for auto-discovery
  if (config.role == GateRole::Start && now - lastPingAt >= PING_INTERVAL_MS) {
    lastPingAt = now;
    sendPing();  // broadcast to FF:FF:FF:FF:FF:FF
    // Also send directed ping to known peer — works even if channels differ
    if (espNowReady) {
      sendEspNowMsg(EspNowMsgType::Ping, peerMacBytes, millis(), (unsigned long)config.wifiChannel);
    }
    // Sync riders every 5th ping (~50s) so late-joining gates get the list
    static uint8_t pingCount = 0;
    if (++pingCount >= 5) {
      pingCount = 0;
      broadcastRiders();
    }
  }

  if (config.role == GateRole::Start) {
    handleStartGateLoop(now);
    return;
  }

  handleFinishGateLoop();
}
