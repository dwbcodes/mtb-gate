#include "rider_store.h"
#include <Preferences.h>

void RiderStore::loadAll() {
  Preferences prefs;
  prefs.begin("riders", true);

  count_ = prefs.getUChar("count", 0);
  for (size_t i = 0; i < count_ && i < kCapacity; i++) {
    char keyId[32];
    char keyName[32];
    char keyTag[32];
    snprintf(keyId, sizeof(keyId), "r%u_id", (unsigned)i);
    snprintf(keyName, sizeof(keyName), "r%u_name", (unsigned)i);
    snprintf(keyTag, sizeof(keyTag), "r%u_tag", (unsigned)i);

    entries_[i].riderId = prefs.getString(keyId, "");
    entries_[i].displayName = prefs.getString(keyName, "");
    entries_[i].tagId = prefs.getString(keyTag, "");
  }

  prefs.end();
}

RiderEntry* RiderStore::findByTagId(const String& tagId) {
  for (size_t i = 0; i < count_; i++) {
    if (entries_[i].tagId == tagId) {
      return &entries_[i];
    }
  }
  return nullptr;
}

void RiderStore::save(const RiderEntry& entry) {
  // Try to find and update existing
  for (size_t i = 0; i < count_; i++) {
    if (entries_[i].tagId == entry.tagId) {
      entries_[i] = entry;
      persist();
      return;
    }
  }

  // Add new entry if capacity allows
  if (count_ < kCapacity) {
    entries_[count_] = entry;
    count_++;
    persist();
  }
}

RiderEntry* RiderStore::at(size_t index) {
  if (index >= count_) {
    return nullptr;
  }
  return &entries_[index];
}

void RiderStore::clearAll() {
  count_ = 0;
  persist();
}

bool RiderStore::remove(const String& tagId) {
  for (size_t i = 0; i < count_; i++) {
    if (entries_[i].tagId == tagId) {
      for (size_t j = i; j < count_ - 1; j++) entries_[j] = entries_[j+1];
      count_--;
      persist();
      return true;
    }
  }
  return false;
}

void RiderStore::persist() {
  Preferences prefs;
  prefs.begin("riders", false);
  prefs.clear();  // remove orphaned keys from deleted riders
  prefs.putUChar("count", count_);

  for (size_t i = 0; i < count_; i++) {
    char keyId[32];
    char keyName[32];
    char keyTag[32];
    snprintf(keyId, sizeof(keyId), "r%u_id", (unsigned)i);
    snprintf(keyName, sizeof(keyName), "r%u_name", (unsigned)i);
    snprintf(keyTag, sizeof(keyTag), "r%u_tag", (unsigned)i);

    prefs.putString(keyId, entries_[i].riderId);
    prefs.putString(keyName, entries_[i].displayName);
    prefs.putString(keyTag, entries_[i].tagId);
  }

  prefs.end();
}
