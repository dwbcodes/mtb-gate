#include "event_store.h"
#include "rider_store.h"
#include "gate_log.h"
#include <WiFi.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <ArduinoJson.h>

static constexpr const char* kNvsNamespace = "mtb-gate";
static constexpr const char* kSeqKey = "evtSeq";
static constexpr const char* kSessionKey = "sessNum";
static constexpr uint32_t SEQ_PERSIST_INTERVAL = 10;

bool EventStore::begin(const String& deviceId, uint8_t gateNumber, const String& role) {
  deviceId_ = deviceId;

  // Extract last 4 hex of MAC for eventId prefix
  String mac = WiFi.macAddress();  // "AA:BB:CC:DD:EE:FF"
  mac.replace(":", "");
  mac4_ = mac.substring(mac.length() - 4);
  mac4_.toLowerCase();

  if (!LittleFS.begin(true)) {  // true = format on first mount
    GateLog::info("EVENTS", "LittleFS mount failed");
    return false;
  }
  mounted_ = true;
  GateLog::info("EVENTS", "LittleFS mounted");

  // Load and bump session number
  {
    Preferences prefs;
    prefs.begin(kNvsNamespace, false);
    sessionNum_ = prefs.getUShort(kSessionKey, 0) + 1;
    prefs.putUShort(kSessionKey, sessionNum_);
    prefs.end();
  }

  // Load and gap-protect sequence counter
  seq_ = loadAndBumpSeq();
  seqAtLastPersist_ = seq_;

  // Create session directory
  char dirBuf[32];
  snprintf(dirBuf, sizeof(dirBuf), "/events/session-%03d", sessionNum_);
  sessionDir_ = String(dirBuf);

  LittleFS.mkdir("/events");
  LittleFS.mkdir(sessionDir_);

  writeManifest(gateNumber, role);
  writeSyncJson();

  // Create empty JSONL files for current session so reads don't error
  for (const char* name : {"/events.jsonl", "/runs.jsonl"}) {
    File f = LittleFS.open(sessionDir_ + name, "w");
    if (f) f.close();
  }

  // Auto-prune if low on space
  size_t totalBytes = LittleFS.totalBytes();
  size_t usedBytes = LittleFS.usedBytes();
  if (totalBytes > 0 && usedBytes > totalBytes * 80 / 100) {
    GateLog::info("EVENTS", "Low space, pruning old sessions");
    pruneOldSessions(5);
  }

  GateLog::info("EVENTS", "Session " + String(sessionNum_) + " started, seq=" + String(seq_));
  return true;
}

uint32_t EventStore::loadAndBumpSeq() {
  Preferences prefs;
  prefs.begin(kNvsNamespace, false);
  uint32_t stored = prefs.getULong(kSeqKey, 0);
  // Gap safety: skip ahead by persist interval to cover any unpersisted events from crash
  uint32_t next = stored + SEQ_PERSIST_INTERVAL;
  prefs.putULong(kSeqKey, next);
  prefs.end();
  return next;
}

void EventStore::persistSeq() {
  if (seq_ - seqAtLastPersist_ >= SEQ_PERSIST_INTERVAL) {
    Preferences prefs;
    prefs.begin(kNvsNamespace, false);
    prefs.putULong(kSeqKey, seq_);
    prefs.end();
    seqAtLastPersist_ = seq_;
  }
}

String EventStore::nextEventId() {
  seq_++;
  persistSeq();
  return "gate-" + mac4_ + "-" + String(seq_);
}

void EventStore::appendJsonl(const String& path, const String& line) {
  if (!mounted_) return;
  File f = LittleFS.open(path, "a");
  if (!f) {
    GateLog::info("EVENTS", "Failed to open " + path);
    return;
  }
  f.println(line);
  f.close();
}

void EventStore::writeManifest(uint8_t gateNumber, const String& role) {
  JsonDocument doc;
  doc["deviceId"] = deviceId_;
  doc["gateNumber"] = gateNumber;
  doc["role"] = role;
  doc["sessionNum"] = sessionNum_;
  doc["startedAtMs"] = millis();
  doc["startSeq"] = seq_;

  String payload;
  serializeJson(doc, payload);

  File f = LittleFS.open(sessionDir_ + "/manifest.json", "w");
  if (f) {
    f.print(payload);
    f.close();
  }
}

void EventStore::writeSyncJson() {
  File f = LittleFS.open(sessionDir_ + "/sync.json", "w");
  if (f) {
    f.print(R"({"status":"pending"})");
    f.close();
  }
}

void EventStore::logEvent(const String& type, const String& runId,
                          const String& riderId, unsigned long localMs,
                          long clockOffsetMs) {
  if (!mounted_) return;

  JsonDocument doc;
  doc["seq"] = seq_ + 1;  // will be incremented by nextEventId
  doc["eventId"] = nextEventId();
  doc["type"] = type;
  if (runId.length() > 0) doc["runId"] = runId;
  if (riderId.length() > 0) doc["riderId"] = riderId;
  doc["localMs"] = localMs > 0 ? localMs : millis();
  if (clockOffsetMs != 0) doc["clockOffsetMs"] = clockOffsetMs;

  String line;
  serializeJson(doc, line);
  appendJsonl(sessionDir_ + "/events.jsonl", line);
}

void EventStore::logRunSummary(const RunRecord& run, bool hadFalseStart) {
  if (!mounted_) return;

  JsonDocument doc;
  doc["runId"] = run.runId;
  doc["riderId"] = run.riderId;
  doc["riderName"] = run.riderName;

  if (run.goAtMs > 0 && run.startTriggeredAtMs > 0)
    doc["reactionMs"] = (long)run.startTriggeredAtMs - (long)run.goAtMs;
  if (run.startTriggeredAtMs > 0 && run.line2TriggeredAtMs > 0)
    doc["launchMs"] = (long)(run.line2TriggeredAtMs - run.startTriggeredAtMs);
  if (run.startTriggeredAtMs > 0 && run.finishTriggeredAtMs > 0)
    doc["courseMs"] = (long)(run.finishTriggeredAtMs - run.startTriggeredAtMs);

  doc["falseStart"] = hadFalseStart;
  doc["completedAtMs"] = run.finishTriggeredAtMs;

  String line;
  serializeJson(doc, line);
  appendJsonl(sessionDir_ + "/runs.jsonl", line);
}

void EventStore::exportRiders(RiderStore& store) {
  if (!mounted_) return;

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (size_t i = 0; i < store.count(); i++) {
    RiderEntry* entry = store.at(i);
    if (entry) {
      JsonObject rider = arr.add<JsonObject>();
      rider["riderId"] = entry->riderId;
      rider["displayName"] = entry->displayName;
      rider["tagId"] = entry->tagId;
    }
  }

  String payload;
  serializeJson(doc, payload);

  File f = LittleFS.open("/riders.json", "w");
  if (f) {
    f.print(payload);
    f.close();
  }
}

String EventStore::tailJsonl(const String& path, int limit) {
  if (!mounted_) return "[]";

  File f = LittleFS.open(path, "r");
  if (!f) return "[]";

  // Read all lines into a circular buffer of limit size
  // For embedded: just read last N lines
  String lines[50];  // max 50
  if (limit > 50) limit = 50;
  int total = 0;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    lines[total % limit] = line;
    total++;
  }
  f.close();

  // Build JSON array from the circular buffer
  String result = "[";
  int start = total <= limit ? 0 : total % limit;
  int count = total < limit ? total : limit;
  for (int i = 0; i < count; i++) {
    int idx = (start + i) % limit;
    if (i > 0) result += ",";
    result += lines[idx];  // already JSON
  }
  result += "]";
  return result;
}

String EventStore::getEventsJson(int limit) {
  return tailJsonl(sessionDir_ + "/events.jsonl", limit);
}

String EventStore::getRunsJson(int limit) {
  if (!mounted_) return "[]";
  if (limit > 50) limit = 50;

  // Collect session numbers
  int sessions[100];
  int sessCount = 0;
  File eventsDir = LittleFS.open("/events");
  if (eventsDir && eventsDir.isDirectory()) {
    File entry = eventsDir.openNextFile();
    while (entry && sessCount < 100) {
      if (entry.isDirectory()) {
        String name = String(entry.name());
        int dashIdx = name.lastIndexOf('-');
        if (dashIdx >= 0) {
          sessions[sessCount++] = name.substring(dashIdx + 1).toInt();
        }
      }
      entry = eventsDir.openNextFile();
    }
  }

  // Sort descending (newest first)
  for (int i = 0; i < sessCount - 1; i++) {
    for (int j = i + 1; j < sessCount; j++) {
      if (sessions[j] > sessions[i]) {
        int tmp = sessions[i];
        sessions[i] = sessions[j];
        sessions[j] = tmp;
      }
    }
  }

  // Read runs from sessions newest-first until we have enough
  String lines[50];
  int collected = 0;

  for (int s = 0; s < sessCount && collected < limit; s++) {
    char pathBuf[64];
    snprintf(pathBuf, sizeof(pathBuf), "/events/session-%03d/runs.jsonl", sessions[s]);
    String path = String(pathBuf);
    // Open "a" first to create if missing (avoids VFS error log), then read
    { File touch = LittleFS.open(path, "a"); if (touch) touch.close(); }
    File f = LittleFS.open(path, "r");
    if (!f) continue;

    // Read all lines from this session into temp buffer
    String sessLines[50];
    int sessTotal = 0;
    while (f.available() && sessTotal < 50) {
      String line = f.readStringUntil('\n');
      line.trim();
      if (line.length() > 0) {
        sessLines[sessTotal++] = line;
      }
    }
    f.close();

    // Add from newest (end) to oldest (start)
    for (int i = sessTotal - 1; i >= 0 && collected < limit; i--) {
      lines[collected++] = sessLines[i];
    }
  }

  // Build JSON array (already newest-first)
  String result = "[";
  for (int i = 0; i < collected; i++) {
    if (i > 0) result += ",";
    result += lines[i];
  }
  result += "]";
  return result;
}

String EventStore::getStorageJson() {
  JsonDocument doc;
  if (mounted_) {
    doc["totalBytes"] = LittleFS.totalBytes();
    doc["usedBytes"] = LittleFS.usedBytes();
    doc["freeBytes"] = LittleFS.totalBytes() - LittleFS.usedBytes();
    doc["currentSession"] = sessionNum_;
  } else {
    doc["error"] = "LittleFS not mounted";
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

String EventStore::getSessionsJson() {
  if (!mounted_) return "[]";

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();

  File eventsDir = LittleFS.open("/events");
  if (!eventsDir || !eventsDir.isDirectory()) {
    String payload;
    serializeJson(doc, payload);
    return payload;
  }

  File entry = eventsDir.openNextFile();
  while (entry) {
    if (entry.isDirectory()) {
      String name = String(entry.name());
      // Parse session number from directory name "session-NNN"
      int dashIdx = name.lastIndexOf('-');
      if (dashIdx >= 0) {
        int num = name.substring(dashIdx + 1).toInt();
        JsonObject sess = arr.add<JsonObject>();
        sess["sessionNum"] = num;
        sess["dir"] = "/events/" + name;

        // Read manifest if exists
        String manifestPath = "/events/" + name + "/manifest.json";
        File mf = LittleFS.open(manifestPath, "r");
        if (mf) {
          JsonDocument mdoc;
          deserializeJson(mdoc, mf);
          mf.close();
          sess["manifest"] = mdoc;
        }

        // Read sync status if exists
        String syncPath = "/events/" + name + "/sync.json";
        File sf = LittleFS.open(syncPath, "r");
        if (sf) {
          JsonDocument sdoc;
          deserializeJson(sdoc, sf);
          sf.close();
          sess["sync"] = sdoc;
        }
      }
    }
    entry = eventsDir.openNextFile();
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

String EventStore::getSessionFile(int sessionNum, const String& filename) {
  if (!mounted_) return "";

  char pathBuf[64];
  snprintf(pathBuf, sizeof(pathBuf), "/events/session-%03d/%s", sessionNum, filename.c_str());

  File f = LittleFS.open(String(pathBuf), "r");
  if (!f) return "";

  String content = f.readString();
  f.close();
  return content;
}

void EventStore::pruneOldSessions(size_t keepCount) {
  if (!mounted_) return;

  File eventsDir = LittleFS.open("/events");
  if (!eventsDir || !eventsDir.isDirectory()) return;

  // Collect session numbers
  int sessions[100];
  int count = 0;

  File entry = eventsDir.openNextFile();
  while (entry && count < 100) {
    if (entry.isDirectory()) {
      String name = String(entry.name());
      int dashIdx = name.lastIndexOf('-');
      if (dashIdx >= 0) {
        sessions[count++] = name.substring(dashIdx + 1).toInt();
      }
    }
    entry = eventsDir.openNextFile();
  }

  if ((size_t)count <= keepCount) return;

  // Sort ascending
  for (int i = 0; i < count - 1; i++) {
    for (int j = i + 1; j < count; j++) {
      if (sessions[j] < sessions[i]) {
        int tmp = sessions[i];
        sessions[i] = sessions[j];
        sessions[j] = tmp;
      }
    }
  }

  // Delete oldest sessions (keep last keepCount)
  int toDelete = count - (int)keepCount;
  for (int i = 0; i < toDelete; i++) {
    // Don't prune current session
    if (sessions[i] == (int)sessionNum_) continue;

    char dirBuf[32];
    snprintf(dirBuf, sizeof(dirBuf), "/events/session-%03d", sessions[i]);
    String dir = String(dirBuf);

    // Delete files in session directory
    File sessDir = LittleFS.open(dir);
    if (sessDir && sessDir.isDirectory()) {
      File f = sessDir.openNextFile();
      while (f) {
        String fpath = dir + "/" + String(f.name());
        f.close();
        LittleFS.remove(fpath);
        f = sessDir.openNextFile();
      }
    }
    LittleFS.rmdir(dir);
    GateLog::info("EVENTS", "Pruned session " + String(sessions[i]));
  }
}
