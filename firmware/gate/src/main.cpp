#include <Arduino.h>
#include <HardwareSerial.h>
#include <WebServer.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include "gate_config.h"
#include "run_queue.h"
#include "sensor_gate.h"
#include "rider_store.h"
#include "nfc_reader.h"
#include "device_ui.h"

#if defined(ARDUINO_USB_CDC_ON_BOOT) && (ARDUINO_USB_CDC_ON_BOOT == 1)
#define GATE_CONSOLE Serial
#else
#define GATE_CONSOLE Serial0
#endif

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
bool nfcInitDone = false;
unsigned long nfcInitAfterMs = 0;

unsigned long lastLogAt = 0;
IPAddress apIp;
IPAddress staIp;
bool pendingNetworkRestart = false;
String lastScannedNfcTag = "";

// Sensor pin and reading
constexpr int SENSOR_LINE1_PIN = 0;
constexpr float ADC_MAX = 4095.0F;
constexpr float ADC_VREF = 3.3F;

// Countdown state
constexpr int COUNTDOWN_SECONDS = 10;
constexpr unsigned long PENALTY_MS = 5000;
String activeRunId = "";
int lastAnnouncedSecond = -1;
bool falseStartDetected = false;

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
  float voltage = readSensorVoltage(pin);
  float baseline = getBaseline();
  if (voltage > baseline + triggerDelta) {
    sensorAboveCount++;
  } else {
    sensorAboveCount = 0;
    if (!baselineFrozen) {
      updateBaseline(voltage);
    }
  }
  return sensorAboveCount >= DEBOUNCE_COUNT;
}

void runCalibration() {
  if (activeRunId.length() > 0) {
    GATE_CONSOLE.println("[CAL] Cannot calibrate during active run");
    return;
  }

  // Phase 1: Sample idle noise for 3 seconds
  GATE_CONSOLE.println("[CAL] Phase 1: Sampling idle noise for 3 seconds...");
  GATE_CONSOLE.println("[CAL] Do NOT touch the tube.");
  float idleMin = 9.0F, idleMax = 0.0F, idleSum = 0.0F;
  int idleCount = 0;
  unsigned long start = millis();
  while (millis() - start < 3000) {
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    if (v < idleMin) idleMin = v;
    if (v > idleMax) idleMax = v;
    idleSum += v;
    idleCount++;
    delay(10);
  }
  float idleAvg = idleSum / idleCount;
  float noiseRange = idleMax - idleMin;
  GATE_CONSOLE.println("[CAL] Idle: avg=" + String(idleAvg, 2) + "V min=" + String(idleMin, 2) + "V max=" + String(idleMax, 2) + "V noise=" + String(noiseRange, 2) + "V");

  // Phase 2: Wait for tube press within 5 seconds
  GATE_CONSOLE.println("[CAL] Phase 2: PRESS the tube now (5 seconds)...");
  float peakV = 0.0F;
  start = millis();
  while (millis() - start < 5000) {
    float v = readSensorVoltage(SENSOR_LINE1_PIN);
    if (v > peakV) peakV = v;
    delay(5);
  }
  GATE_CONSOLE.println("[CAL] Peak: " + String(peakV, 2) + "V");

  float peakDelta = peakV - idleAvg;
  if (peakDelta < noiseRange * 1.2F) {
    GATE_CONSOLE.println("[CAL] FAILED - peak not significantly above noise. Press harder or check tube connection.");
    return;
  }

  // Set delta just above noise ceiling (20% margin over half noise range)
  // With frozen baseline + debounce=3, this is safe
  float halfNoise = noiseRange / 2.0F;
  float newDelta = halfNoise * 1.3F;  // just above max noise deviation from average

  triggerDelta = newDelta;
  config.triggerDelta = newDelta;
  config = configStore.save(config);

  GATE_CONSOLE.println("[CAL] SUCCESS - delta set to " + String(newDelta, 2) + "V (noise=" + String(noiseRange, 2) + "V peak=" + String(peakDelta, 2) + "V above idle)");
  GATE_CONSOLE.println("[CAL] Trigger threshold = baseline + " + String(newDelta, 2) + "V");
}

bool hasStaConnection() {
  return staIp.toString() != "0.0.0.0";
}

void printHelp() {
  GATE_CONSOLE.println("Commands: status | role=start | role=finish | wifi | calibrate");
  GATE_CONSOLE.println("Console API: api status | api config | api config/wifi <json> | api config/time <json> | api config/mac <json> | api riders | api riders/add <json> | api riders/delete <json> | api ping");
}

void printStatus() {
  GATE_CONSOLE.print("Device ");
  GATE_CONSOLE.print(config.deviceId);
  GATE_CONSOLE.print(" (");
  GATE_CONSOLE.print(config.deviceLabel);
  GATE_CONSOLE.print(")");
  GATE_CONSOLE.print(" running as ");
  GATE_CONSOLE.println(gateRoleName(config.role));
  GATE_CONSOLE.print("AP SSID: ");
  GATE_CONSOLE.println(config.deviceId);
  GATE_CONSOLE.print("AP Password: ");
  GATE_CONSOLE.println(config.apPassword.length() > 0 ? config.apPassword : "<open>");
  GATE_CONSOLE.print("AP IP: ");
  GATE_CONSOLE.println(apIp);
  GATE_CONSOLE.print("MAC: ");
  GATE_CONSOLE.println(WiFi.macAddress());
  GATE_CONSOLE.print("STA SSID: ");
  GATE_CONSOLE.println(config.staSsid.length() > 0 ? config.staSsid : "<not configured>");
  GATE_CONSOLE.print("STA IP: ");
  GATE_CONSOLE.println(staIp);
}

void printWifiStatus() {
  GATE_CONSOLE.print("AP network ");
  GATE_CONSOLE.print(config.deviceId);
  GATE_CONSOLE.print(" available at http://");
  GATE_CONSOLE.println(apIp);
  GATE_CONSOLE.print("AP SSID: ");
  GATE_CONSOLE.println(config.deviceId);
  GATE_CONSOLE.print("AP Password: ");
  GATE_CONSOLE.println(config.apPassword.length() > 0 ? config.apPassword : "<open>");
  GATE_CONSOLE.print("AP IP: ");
  GATE_CONSOLE.println(apIp);
  if (config.staSsid.length() > 0 && hasStaConnection()) {
    GATE_CONSOLE.print("Station network ");
    GATE_CONSOLE.print(config.staSsid);
    GATE_CONSOLE.print(" available at http://");
    GATE_CONSOLE.println(staIp);
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
  JsonObject espNow = doc["espNow"].to<JsonObject>();
  espNow["connected"] = config.peerMac.length() > 0;
  espNow["peerMac"] = config.peerMac;

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
      metrics["reactionMs"] = (long)(run->startTriggeredAtMs - run->goAtMs);
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
  GATE_CONSOLE.print("API ");
  GATE_CONSOLE.println(payload);
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

  if (next.startThreshold < 0.0F || next.startThreshold > 2.0F ||
      next.finishThreshold < 0.0F || next.finishThreshold > 2.0F ||
      next.line2Threshold < 0.0F || next.line2Threshold > 2.0F) {
    return R"({"error":"Thresholds must be 0.00-2.00"})";
  }

  config = configStore.save(next);
  applySensorThresholds();
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
  if (doc["role"].is<String>()) next.role = parseGateRole(doc["role"].as<String>());
  if (doc["deviceLabel"].is<String>()) next.deviceLabel = doc["deviceLabel"].as<String>();
  if (doc["gateNumber"].is<int>()) {
    const int gn = doc["gateNumber"].as<int>();
    if (gn < 1 || gn > 254) {
      return R"({"error":"gateNumber must be 1-254"})";
    }
    next.gateNumber = (uint8_t)gn;
    next.deviceId = GateConfigStore::buildDeviceId(next.gateNumber);
  }

  if (next.peerMac.length() > 0 && next.peerMac.length() != 17) {
    return R"({"error":"peerMac must be AA:BB:CC:DD:EE:FF format"})";
  }

  config = configStore.save(next);
  return R"({"ok":true})";
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

  riderStore.remove(doc["tagId"].as<String>());
  return R"({"ok":true})";
}

String pingJson() {
  return R"({"ok":true,"sent":false})";
}

void handleRoot() {
  server.send_P(200, "text/html; charset=utf-8", (const char*)index_html_data, sizeof(index_html_data));
}

void handleStylesCss() {
  server.send_P(200, "text/css", (const char*)styles_css_data, sizeof(styles_css_data));
}

void handleMainJs() {
  server.send_P(200, "application/javascript", (const char*)main_js_data, sizeof(main_js_data));
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
  sendJson(200, R"({"ok":true})");
}

void handlePostReboot() {
  sendJson(200, R"({"ok":true})");
  delay(500);
  ESP.restart();
}

void handlePostCalibrate() {
  if (server.method() != HTTP_POST) {
    sendJsonError(405, "Method not allowed");
    return;
  }
  sendJson(200, R"({"ok":true,"message":"Calibration started - watch serial output"})");
  delay(100);
  runCalibration();
}

void handlePostPing() {
  sendEmptyBodyOperation(HTTP_POST, pingJson);
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


void configureWebServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/styles.css", HTTP_GET, handleStylesCss);
  server.on("/main.js", HTTP_GET, handleMainJs);

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
  server.on("/api/reboot", HTTP_POST, handlePostReboot);
  server.on("/api/calibrate", HTTP_POST, handlePostCalibrate);
  
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

  if (command.equalsIgnoreCase("status")) {
    printStatus();
    return;
  }

  if (command.equalsIgnoreCase("role=start")) {
    config.role = GateRole::Start;
    config = configStore.save(config);
    GATE_CONSOLE.println("Saved role=start.");
    printStatus();
    return;
  }

  if (command.equalsIgnoreCase("role=finish")) {
    config.role = GateRole::Finish;
    config = configStore.save(config);
    GATE_CONSOLE.println("Saved role=finish.");
    printStatus();
    return;
  }

  if (command.equalsIgnoreCase("calibrate")) {
    runCalibration();
    return;
  }

  if (command.startsWith("scan=")) {
    String tagId = command.substring(5);
    tagId.trim();
    if (tagId.length() > 0) {
      GATE_CONSOLE.println("[SERIAL] Simulated NFC scan: " + tagId);
      startRunForRider(tagId);
    } else {
      GATE_CONSOLE.println("Usage: scan=<tagId>");
    }
    return;
  }

  if (command.equalsIgnoreCase("wifi")) {
    printWifiStatus();
    printStatus();
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
    GATE_CONSOLE.println("[RUN] Unknown tag " + tagId + " - register rider first");
    return;
  }
  if (activeRunId.length() > 0) {
    GATE_CONSOLE.println("[RUN] Run already active, ignoring scan");
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
    GATE_CONSOLE.println("[RUN] Queue full");
    return;
  }

  activeRunId = run.runId;
  lastAnnouncedSecond = -1;
  falseStartDetected = false;
  sensorAboveCount = 0;
  GATE_CONSOLE.println("[RUN] Rider " + rider->displayName + " scanned - starting countdown");
}

void handleStartGateLoop(unsigned long now) {
  if (activeRunId.length() == 0) return;

  RunRecord* run = queue.find(activeRunId);
  if (!run) { activeRunId = ""; unfreezeBaseline(); return; }

  // Queued → start countdown
  if (run->status == RunStatus::Queued) {
    queue.updateStatus(run->runId, RunStatus::Countdown, now);
    freezeBaseline();
    lastAnnouncedSecond = COUNTDOWN_SECONDS;
    GATE_CONSOLE.println("[RUN] Countdown: " + String(COUNTDOWN_SECONDS));
    return;
  }

  // Countdown → tick each second, check for false start
  if (run->status == RunStatus::Countdown) {
    unsigned long elapsed = now - run->countdownStartedAtMs;
    int secondsLeft = COUNTDOWN_SECONDS - (int)(elapsed / 1000);

    if (secondsLeft >= 0 && secondsLeft != lastAnnouncedSecond) {
      lastAnnouncedSecond = secondsLeft;
      if (secondsLeft > 0) {
        GATE_CONSOLE.println("[RUN] Countdown: " + String(secondsLeft));
      }
    }

    // Only check false start in final 3 seconds (rider should be in position)
    if (!falseStartDetected && secondsLeft <= 3 && sensorTriggered(SENSOR_LINE1_PIN)) {
      falseStartDetected = true;
      GATE_CONSOLE.println("[RUN] FALSE START! 5 second penalty");
    }

    // Countdown complete
    if (elapsed >= (unsigned long)COUNTDOWN_SECONDS * 1000UL) {
      queue.updateStatus(run->runId, RunStatus::AwaitingStart, now);
      if (falseStartDetected) {
        GATE_CONSOLE.println("[RUN] GO! (5s penalty will be added)");
      } else {
        GATE_CONSOLE.println("[RUN] GO!");
      }
    }
    return;
  }

  // AwaitingStart → wait for sensor trigger
  if (run->status == RunStatus::AwaitingStart) {
    if (sensorTriggered(SENSOR_LINE1_PIN)) {
      queue.updateStatus(run->runId, RunStatus::OnCourse, now);
      unsigned long reactionMs = run->startTriggeredAtMs - run->goAtMs;
      if (falseStartDetected) {
        reactionMs += PENALTY_MS;
        GATE_CONSOLE.println("[RUN] TRIGGERED - Reaction: " + String(reactionMs) + "ms (includes 5000ms penalty)");
      } else {
        GATE_CONSOLE.println("[RUN] TRIGGERED - Reaction: " + String(reactionMs) + "ms");
      }
      activeRunId = "";
      unfreezeBaseline();
    }
    return;
  }
}

void handleFinishGateLoop() {
  if (finishSensor.isTriggered(0.93F)) {
    GATE_CONSOLE.println("Finish trigger sample accepted");
  }
}

void setup() {
  GATE_CONSOLE.begin(115200);
  delay(250);

  config = configStore.load();

  riderStore.loadAll();
  applySensorThresholds();
  triggerDelta = config.triggerDelta;
  pinMode(SENSOR_LINE1_PIN, INPUT);
  // Seed baseline with initial readings
  for (int i = 0; i < BASELINE_SAMPLES; i++) {
    baselineBuffer[i] = readSensorVoltage(SENSOR_LINE1_PIN);
    delay(5);
  }
  baselineFilled = true;
  GATE_CONSOLE.println("[SENSOR] GPIO" + String(SENSOR_LINE1_PIN) + " baseline=" + String(getBaseline(), 2) + "V delta=" + String(triggerDelta, 2) + "V");
  startWifi();
  configureWebServer();
  nfcInitAfterMs = millis() + 2000;

  GATE_CONSOLE.println("Unified gate firmware ready");
  printStatus();
  printWifiStatus();
  printHelp();
}

void loop() {
  if (!nfcInitDone && config.role == GateRole::Start && millis() > nfcInitAfterMs) {
    nfcInitDone = true;
    nfcReader.begin();
    if (nfcReader.isInitialized()) {
      GATE_CONSOLE.println("[NFC] Reader initialized successfully");
    } else {
      GATE_CONSOLE.println("[NFC] Reader not detected - check wiring SDA=GPIO8 SCL=GPIO10");
    }
  }

  nfcReader.poll();

  // Continuously scan NFC when idle (no active run) on start gate
  if (config.role == GateRole::Start && nfcReader.isInitialized() && activeRunId.length() == 0) {
    String tagId;
    if (nfcReader.readTag(tagId)) {
      lastScannedNfcTag = tagId;
      GATE_CONSOLE.println("[NFC] Tag scanned: " + tagId);
      startRunForRider(tagId);
    }
  }

  // Also check API-triggered listen window (for registration flow)
  if (config.role == GateRole::Start) {
    String tagId;
    if (nfcReader.getScannedTag(tagId)) {
      lastScannedNfcTag = tagId;
    }
  }

  if (GATE_CONSOLE.available() > 0) {
    handleSerialCommand(GATE_CONSOLE.readStringUntil('\n'));
  }
  server.handleClient();

  if (pendingNetworkRestart) {
    pendingNetworkRestart = false;
    delay(100);
    restartNetworking();
  }

  const unsigned long now = millis();
  // Poll at 100ms during active run for responsive sensor detection, 1s otherwise
  const unsigned long intervalMs = (config.role == GateRole::Start && activeRunId.length() > 0) ? 100 : 1000;
  if (now - lastLogAt < intervalMs) {
    return;
  }

  lastLogAt = now;
  if (config.role == GateRole::Start) {
    handleStartGateLoop(now);
    return;
  }

  handleFinishGateLoop();
}
