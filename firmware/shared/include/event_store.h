#pragma once

#include <Arduino.h>
#include "gate_types.h"

class RiderStore;  // forward declaration

// Offline-first persistence on LittleFS. Each boot opens a new
// /events/session-NNN/ directory holding events.jsonl (append-only event
// log), runs.jsonl (one summary per completed run), manifest.json, and
// sync.json (cloud-upload status, written as "pending" until a future
// uploader marks it). Event IDs ("gate-<mac4>-<seq>") use an NVS-backed
// sequence counter persisted every SEQ_PERSIST_INTERVAL events and bumped
// by that interval on boot, so IDs stay unique across crashes at the cost
// of small gaps. Old sessions are pruned when the FS passes 80% full.
class EventStore {
public:
  bool begin(const String& deviceId, uint8_t gateNumber, const String& role);

  // Event logging
  void logEvent(const String& type, const String& runId = "",
                const String& riderId = "", unsigned long localMs = 0,
                long clockOffsetMs = 0);
  void logRunSummary(const RunRecord& run, bool hadFalseStart,
                     const String& officialTrigger = "first");
  void exportRiders(RiderStore& store);

  // API helpers — return JSON strings
  String getEventsJson(int limit = 50);
  String getRunsJson(int limit = 50);
  String getStorageJson();
  String getSessionsJson();
  String getSessionFile(int sessionNum, const String& filename);

  // Run management
  bool deleteRun(const String& runId);
  void clearAllRuns();

  // Storage management
  void pruneOldSessions(size_t keepCount = 5);

  uint16_t sessionNum() const { return sessionNum_; }

private:
  String deviceId_;
  String mac4_;           // last 4 hex chars of MAC for eventId
  uint16_t sessionNum_;
  uint32_t seq_;          // monotonic event sequence
  uint32_t seqAtLastPersist_;
  String sessionDir_;
  bool mounted_ = false;

  void appendJsonl(const String& path, const String& line);
  void writeManifest(uint8_t gateNumber, const String& role);
  void writeSyncJson();
  uint32_t loadAndBumpSeq();
  void persistSeq();
  String nextEventId();

  // Tail reading helper: returns last N lines from a JSONL file wrapped in JSON array
  String tailJsonl(const String& path, int limit);

  int cachedSessions_[100];
  int cachedSessionCount_ = -1;  // -1 = stale; rebuild on next getRunsJson() call
};
