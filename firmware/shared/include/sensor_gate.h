#pragma once

#include "gate_types.h"

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

