#pragma once

#include "gate_types.h"

// Absolute-threshold sensor comparator. NOTE: the live trigger path in
// main.cpp uses baseline-relative detection (sensorTriggered() with
// config.triggerDelta) instead; instances of this class are still
// constructed from the legacy start/finish thresholds but no longer
// drive run timing. Kept for mockability and old test clients.
class SensorGate {
public:
  explicit SensorGate(float threshold) : threshold_(threshold) {}

  bool isTriggered(float sample) const {
    return sample >= threshold_;
  }

  float threshold() const {
    return threshold_;
  }

private:
  float threshold_;
};

