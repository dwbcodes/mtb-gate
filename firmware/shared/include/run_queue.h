#pragma once

#include <Arduino.h>
#include "gate_types.h"

// Fixed-capacity queue of in-progress runs. The start gate is the only
// writer; runs are appended by startRunForRider() and progressed through
// RunStatus by handleStartGateLoop() until removeTerminal() clears them.
class RunQueue {
public:
  static constexpr size_t kCapacity = 8;

  bool enqueue(const RunRecord& run);
  // Sets status and stamps the timestamp field associated with that status
  // transition (see the switch in run_queue.cpp) to eventMs.
  bool updateStatus(const String& runId, RunStatus status, unsigned long eventMs);
  // Records the line2 (launch) sensor timestamp without changing status;
  // a no-op if already stamped, since line2 fires at most once per run.
  bool stampLine2(const String& runId, unsigned long ms);
  bool remove(const String& runId);  // Remove a specific run by ID
  void removeTerminal();  // Remove Finished/TimedOut/Cancelled runs
  void clear();           // Remove all runs
  RunRecord* find(const String& runId);
  RunRecord* at(size_t index);
  size_t size() const;

private:
  RunRecord runs_[kCapacity];
  size_t count_ = 0;
};

