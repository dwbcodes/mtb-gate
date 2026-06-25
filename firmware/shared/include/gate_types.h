#pragma once

#include <Arduino.h>

enum class GateRole {
  Start,
  Finish,
  Intermediate
};

enum class RunStatus {
  Queued,
  Countdown,
  AwaitingStart,
  OnCourse,
  Finished,
  TimedOut
};

struct RunRecord {
  String runId;
  String riderId;
  String riderName;
  RunStatus status;
  unsigned long queuedAtMs;
  unsigned long countdownStartedAtMs;
  unsigned long goAtMs;
  unsigned long startTriggeredAtMs;
  unsigned long line2TriggeredAtMs;
  unsigned long finishTriggeredAtMs;
};

