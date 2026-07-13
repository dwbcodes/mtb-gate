#pragma once

#include <Arduino.h>

enum class GateRole {
  Start,
  Finish,
  Intermediate
};

// Linear happy-path progression is Queued -> Countdown -> AwaitingStart ->
// OnCourse -> Finished. TimedOut and Cancelled are terminal exits reachable
// from AwaitingStart/OnCourse (see handleStartGateLoop() in main.cpp).
// FinishedAwaitingWheel2 is a transient state after finish receipt when
// dual-trigger is enabled — waiting for the rear-wheel ESP-Now message or
// the wheelTrackTimeoutMs deadline before finalising the run summary.
enum class RunStatus {
  Queued,                  // rider scanned, waiting for the loop to start the countdown
  Countdown,               // COUNTDOWN_SECONDS tick in progress; false start is still detectable
  AwaitingStart,           // GO announced, waiting for the line1 sensor trigger
  OnCourse,                // line1 triggered, waiting for the finish gate's ESP-Now event
  Finished,                // finish event received and metrics recorded
  TimedOut,                // no finish event within the OnCourse timeout window
  Cancelled,               // rider re-scanned or run was cancelled via the API
  FinishedAwaitingWheel2,  // finish received; dual-trigger on — awaiting rear-wheel ESP-Now
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
  unsigned long finishWheel2TriggeredAtMs;  // second wheel at finish (0 = not arrived / wheel lift)
};

