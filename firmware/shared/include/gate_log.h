#pragma once

#include <Arduino.h>

#if defined(ARDUINO_USB_CDC_ON_BOOT) && (ARDUINO_USB_CDC_ON_BOOT == 1)
#define GATE_SERIAL Serial
#else
#define GATE_SERIAL Serial0
#endif

class GateLog {
public:
  static void begin(unsigned long baud) { GATE_SERIAL.begin(baud); }
  static void setHost(const String& host) { host_ = host; }
  static bool available() { return GATE_SERIAL.available(); }
  static String readLine() { return GATE_SERIAL.readStringUntil('\n'); }

  // Log with tag: [host] [TAG] message
  static void info(const char* tag, const String& msg) {
    GATE_SERIAL.print("[");
    GATE_SERIAL.print(host_);
    GATE_SERIAL.print("] [");
    GATE_SERIAL.print(tag);
    GATE_SERIAL.print("] ");
    GATE_SERIAL.println(msg);
  }

  // Log without tag: [host] message
  static void print(const String& msg) {
    GATE_SERIAL.print("[");
    GATE_SERIAL.print(host_);
    GATE_SERIAL.print("] ");
    GATE_SERIAL.println(msg);
  }

  // Raw print (no prefix) for banners
  static void raw(const String& msg) {
    GATE_SERIAL.println(msg);
  }

  static Stream& stream() { return GATE_SERIAL; }

private:
  static String host_;
};
