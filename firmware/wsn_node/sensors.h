// =============================================================================================
// AquaSense-WSN  -  sensors.h   [G §2 node configuration, spec §1.2 sensor reading rules]
// N1: ESP32 on-chip temperature sensor (no external part, no wiring) = pond-edge enclosure
//     temperature, v = round(temperatureRead() * 100), -1 if NaN. th = 1 when v >= g_tempWarn
//     (degC x100). g_tempWarn starts at TEMP_WARN_C100, is changed at run time by the CTRL
//     command TEMP_WARN{a:1, v} and restored by RESET_STATS; N1 reports it in STAT pt3 `tw`.
// N2: turbidity module (LM393 board). v = mean of SENSOR_ADC_SAMPLES analogRead(GPIO34) (12 bit,
//     11 dB), th = comparator output D on GPIO27 (INPUT_PULLUP, active LOW by default).
// N3: ESP32 on-chip temperature sensor, v = round(temperatureRead() * 100), -1 if NaN, th = 0.
// N4: no sensor (drives the pond status light, see sink.h).
// Everything comes with the ESP32 core (no external library). All reads take < 1 ms, so they
// are done directly in the node's slot.
// =============================================================================================
#pragma once
#include "shared.h"
#include <math.h>

#define TEMP_WARN_MAX_C100     15000       // CTRL TEMP_WARN v is clamped to 0..150.00 C (spec §9.1)

static int32_t g_sensorValue = -1;         // value last returned by readSensor()
static int32_t g_tempWarn = TEMP_WARN_C100; // N1 over-temperature alert threshold (degC x100)

// Unit code carried in DATA.u (spec §3)
static const char* sensorUnitCode() {
  if (NODE_ID == 1 || NODE_ID == 3) return "temp";
  if (NODE_ID == 2) return "turb";
  return "none";
}

// One on-chip temperature reading in degC x100 (-1 if NaN), N1 and N3
static inline int32_t dieTempC100() {
  float t = temperatureRead();
  return isnan(t) ? -1 : (int32_t)lroundf(t * 100.0f);             // 41.27 C -> 4127
}

static void sensorsInit() {
#if NODE_ID == 1
  int32_t t = dieTempC100();
  wlogf("SENS", "ESP32 die temperature sensor (uncalibrated), now %.2f C, TEMP_WARN %ld.%02ld C",
        t < 0 ? -1.0 : t / 100.0, (long)(g_tempWarn / 100), (long)(g_tempWarn % 100));
#elif NODE_ID == 2
  pinMode(TURB_ADC_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(TURB_ADC_PIN, ADC_11db);      // 0 .. ~3.1 V full scale
  pinMode(TURB_DOUT_PIN, INPUT_PULLUP);                 // LM393 output is open collector
  wlogf("SENS", "turbidity A=GPIO%d (ADC1_CH6, 11 dB, 12 bit) D=GPIO%d (pull-up, active %s)", TURB_ADC_PIN, TURB_DOUT_PIN,
        TURB_DOUT_ACTIVE_LOW ? "LOW" : "HIGH");
#elif NODE_ID == 3
  float t = temperatureRead();
  wlogf("SENS", "ESP32 die temperature sensor (uncalibrated), now %.2f C", isnan(t) ? -1.0 : (double)t);
#else
  wlogf("SENS", "no sensor on this node (status light on GPIO%d/%d)", LED_GREEN_PIN, LED_RED_PIN);
#endif
}

// RESET_STATS: N1 restores the TEMP_WARN default (spec §1.2)
static void sensorsResetDefaults() {
  g_tempWarn = TEMP_WARN_C100;
}

// Current sensor value (int, spec §1.2). Every node samples now (each read takes < 1 ms).
static int32_t readSensor() {
#if NODE_ID == 1 || NODE_ID == 3
  g_sensorValue = dieTempC100();
#elif NODE_ID == 2
  uint32_t acc = 0;
  for (int i = 0; i < SENSOR_ADC_SAMPLES; i++) acc += analogRead(TURB_ADC_PIN);
  g_sensorValue = (int32_t)(acc / SENSOR_ADC_SAMPLES);
#endif
  return g_sensorValue;
}

// Threshold flag th (0/1) of DATA (spec §1.2, §3). N1: value last returned by readSensor()
// >= TEMP_WARN (a NaN reading, v = -1, never trips it); N2: comparator output D read now;
// N3 / N4: always 0.
static uint8_t readThreshold() {
#if NODE_ID == 1
  return g_sensorValue >= g_tempWarn ? 1 : 0;
#elif NODE_ID == 2
  int d = digitalRead(TURB_DOUT_PIN);
  return (TURB_DOUT_ACTIVE_LOW ? (d == LOW) : (d == HIGH)) ? 1 : 0;
#else
  return 0;
#endif
}

// Called once per superframe (CONTROL slot start, where no unicast is expected) and keeps the
// cached value fresh for the periodic node table. Non-blocking (< 1 ms).
static void sensorsService() {
#if NODE_ID == 1 || NODE_ID == 3
  (void)readSensor();
#endif
}
