#pragma once

#include <Arduino.h>
#include "gate_types.h"

class RunQueue {
public:
  static constexpr size_t kCapacity = 8;

  bool enqueue(const RunRecord& run);
  bool updateStatus(const String& runId, RunStatus status, unsigned long eventMs);
  bool stampLine2(const String& runId, unsigned long ms);
  RunRecord* find(const String& runId);
  RunRecord* at(size_t index);
  size_t size() const;

private:
  RunRecord runs_[kCapacity];
  size_t count_ = 0;
};

