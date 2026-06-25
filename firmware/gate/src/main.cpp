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
  0.85F,                // startThreshold
  0.85F,                // finishThreshold
  0.85F,                // line2Threshold
  1,                    // wifiChannel
  GateRole::Start,      // role
  "",                   // peerMac
  1                     // gateNumber (1-based: 1=start, 2=finish, ...)
};

RunQueue queue;
SensorGate startSensor(0.85F);
SensorGate finishSensor(0.85F);
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

RunRecord buildMockRun() {
  RunRecord run;
  run.runId = config.deviceId + "-rider-1";
  run.riderId = "rider-1";
  run.riderName = "Demo Rider";
  run.status = RunStatus::Queued;
  run.queuedAtMs = millis();
  run.countdownStartedAtMs = 0;
  run.goAtMs = 0;
  run.startTriggeredAtMs = 0;
  run.finishTriggeredAtMs = 0;
  return run;
}

bool hasStaConnection() {
  return staIp.toString() != "0.0.0.0";
}

void printHelp() {
  GATE_CONSOLE.println("Commands: status | role=start | role=finish | wifi");
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

  const IPAddress apStaticIp(192, 168, 4, config.gateNumber);
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
    next.gateNumber = (uint8_t)doc["gateNumber"].as<int>();
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
  server.send(200, "application/json", configJson());
}

void handlePutConfigWifi() {
  if (server.method() != HTTP_PUT) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  String body = server.arg("plain");
  if (body.length() == 0) {
    server.send(400, "application/json", R"({"error":"Body required"})");
    return;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    server.send(400, "application/json", R"({"error":"Invalid JSON"})");
    return;
  }

  const String payload = updateWifiConfigFromJson(body);
  if (payload.indexOf("\"error\"") >= 0) {
    server.send(400, "application/json", payload);
    return;
  }

  server.send(200, "application/json", payload);
  pendingNetworkRestart = true;
}

void handlePutConfigTime() {
  if (server.method() != HTTP_PUT) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  const String body = server.arg("plain");
  if (body.length() == 0) {
    server.send(400, "application/json", R"({"error":"Body required"})");
    return;
  }
  const String payload = updateTimeConfigFromJson(body);
  if (payload.indexOf("\"error\"") >= 0) {
    server.send(400, "application/json", payload);
    return;
  }

  server.send(200, "application/json", payload);
}

void handlePutConfigMac() {
  if (server.method() != HTTP_PUT) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  String body = server.arg("plain");
  if (body.length() == 0) {
    server.send(400, "application/json", R"({"error":"Body required"})");
    return;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  if (error) {
    server.send(400, "application/json", R"({"error":"Invalid JSON"})");
    return;
  }

  const String payload = updateMacConfigFromJson(body);
  if (payload.indexOf("\"error\"") >= 0) {
    server.send(400, "application/json", payload);
    return;
  }

  server.send(200, "application/json", payload);
}

void handleGetRiders() {
  server.send(200, "application/json", ridersJson());
}

void handlePostRiders() {
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  const String body = server.arg("plain");
  if (body.length() == 0) {
    server.send(400, "application/json", R"({"error":"Body required"})");
    return;
  }
  const String payload = addRiderFromJson(body);
  server.send(payload.indexOf("\"error\"") >= 0 ? 400 : 200, "application/json", payload);
}

void handleDeleteRiders() {
  if (server.method() != HTTP_DELETE) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  String tagId = server.arg("tagId");
  if (tagId.length() == 0) {
    String body = server.arg("plain");
    if (body.length() > 0) {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, body);
      if (error) {
        server.send(400, "application/json", R"({"error":"Invalid JSON"})");
        return;
      }
      if (doc["tagId"].is<String>()) {
        tagId = doc["tagId"].as<String>();
      }
    }
  }
  if (tagId.length() == 0) {
    server.send(400, "application/json", R"({"error":"tagId required"})");
    return;
  }

  riderStore.remove(tagId);
  server.send(200, "application/json", R"({"ok":true})");
}

void handlePostReboot() {
  server.send(200, "application/json", R"({"ok":true})");
  delay(500);
  ESP.restart();
}

void handlePostPing() {
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", R"({"error":"Method not allowed"})");
    return;
  }

  server.send(200, "application/json", R"({"ok":true,"sent":false})");
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
  
  // NFC endpoints
  server.on("/api/nfc/listen", HTTP_POST, handleNfcStartListen);
  server.on("/api/nfc/tag", HTTP_GET, handleNfcGetTag);
  server.on("/api/nfc/diagnostics", HTTP_GET, handleNfcDiagnostics);
  server.on("/api/i2c/scan", HTTP_GET, handleI2cScan);
  
  server.begin();
}

void handleSerialCommand(const String& rawCommand) {
  String command = rawCommand;
  command.trim();  // strips \r, \n, and leading/trailing spaces

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

  if (command.equalsIgnoreCase("wifi")) {
    printWifiStatus();
    printStatus();
    return;
  }

  printHelp();
}

void handleStartGateLoop(unsigned long now) {
  if (RunRecord* run = queue.find(config.deviceId + "-rider-1")) {
    if (run->status == RunStatus::Queued) {
      queue.updateStatus(run->runId, RunStatus::Countdown, now);
      GATE_CONSOLE.println("Countdown started");
    } else if (run->status == RunStatus::Countdown) {
      queue.updateStatus(run->runId, RunStatus::AwaitingStart, now);
      GATE_CONSOLE.println("GO");
    } else if (run->status == RunStatus::AwaitingStart && startSensor.isTriggered(0.91F)) {
      queue.updateStatus(run->runId, RunStatus::OnCourse, now);
      GATE_CONSOLE.println("Start trigger detected");
    }
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
  startWifi();
  configureWebServer();
  queue.enqueue(buildMockRun());
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
  const unsigned long intervalMs = config.role == GateRole::Start ? 1000 : 1500;
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
