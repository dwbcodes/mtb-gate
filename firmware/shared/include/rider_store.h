#pragma once

#include <Arduino.h>

struct RiderEntry {
  String riderId;
  String displayName;
  String tagId;
};

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
