#pragma once

#include <Arduino.h>

struct RiderEntry {
  String riderId;
  String displayName;
  String tagId;
};

// Persistent, NVS-backed rider roster (namespace "riders"), keyed by
// tagId. Entries are stored as indexed keys ("r<i>_id"/"r<i>_name"/"r<i>_tag")
// rather than one blob so a single save()/remove() only rewrites what
// changed. On the finish/intermediate gates this store is populated purely
// by ESP-Now RiderSync broadcasts from the start gate (see onEspNowRecv()
// in main.cpp), never edited locally.
class RiderStore {
public:
  static constexpr size_t kCapacity = 32;

  void loadAll();
  RiderEntry* findByTagId(const String& tagId);
  void save(const RiderEntry& entry);
  bool remove(const String& tagId);

  void clearAll();
  size_t count() const { return count_; }
  RiderEntry* at(size_t index);

private:
  RiderEntry entries_[kCapacity];
  size_t count_ = 0;

  void persist();
};
