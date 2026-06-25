#include "run_queue.h"

bool RunQueue::enqueue(const RunRecord& run) {
  if (count_ >= kCapacity) {
    return false;
  }

  runs_[count_] = run;
  count_++;
  return true;
}

RunRecord* RunQueue::find(const String& runId) {
  for (size_t index = 0; index < count_; index++) {
    if (runs_[index].runId == runId) {
      return &runs_[index];
    }
  }
  return nullptr;
}

bool RunQueue::updateStatus(const String& runId, RunStatus status, unsigned long eventMs) {
  RunRecord* run = find(runId);
  if (!run) {
    return false;
  }

  run->status = status;
  switch (status) {
    case RunStatus::Countdown:
      run->countdownStartedAtMs = eventMs;
      break;
    case RunStatus::AwaitingStart:
      run->goAtMs = eventMs;
      break;
    case RunStatus::OnCourse:
      run->startTriggeredAtMs = eventMs;
      break;
    case RunStatus::Finished:
      run->finishTriggeredAtMs = eventMs;
      break;
    default:
      break;
  }

  return true;
}

bool RunQueue::stampLine2(const String& runId, unsigned long ms) {
  RunRecord* run = find(runId);
  if (!run || run->line2TriggeredAtMs != 0) {
    return false;
  }
  run->line2TriggeredAtMs = ms;
  return true;
}

RunRecord* RunQueue::at(size_t index) {
  if (index >= count_) {
    return nullptr;
  }
  return &runs_[index];
}

size_t RunQueue::size() const {
  return count_;
}

