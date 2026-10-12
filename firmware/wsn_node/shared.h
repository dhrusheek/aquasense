// =============================================================================================
// AquaSense-WSN  -  shared.h
// Cross-module types, global state, core-version compatibility macros, logging, and forward
// declarations of every function that one header calls in another (the headers are included
// into the single .ino translation unit; Arduino only auto-prototypes functions of the .ino).
// =============================================================================================
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_idf_version.h>
#include <stdarg.h>
#if defined(__has_include)
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif
#endif
#include <ArduinoJson.h>
#include "config.h"

// ---------------------------------------------------------------------------------------------
// Core-version compatibility (arduino-esp32 2.0.x = ESP-IDF 4.4, 3.0..3.2 = IDF 5.1..5.4,
// 3.3.x = IDF 5.5). The ESP-NOW callback typedefs follow the IDF version, so we guard on it:
//   recv cb: (const esp_now_recv_info_t*, ...)  since IDF 5.0  (= core 3.0.0)
//   send cb: (const wifi_tx_info_t*, ...)       since IDF 5.5  (= core 3.3.0)
// ---------------------------------------------------------------------------------------------
#ifndef ESP_ARDUINO_VERSION_VAL
#define ESP_ARDUINO_VERSION_VAL(major, minor, patch) (((major) << 16) | ((minor) << 8) | (patch))
#endif
#ifndef ESP_ARDUINO_VERSION
#define ESP_ARDUINO_VERSION ESP_ARDUINO_VERSION_VAL(2, 0, 0)
#endif
#define WSN_CORE3            (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
#define WSN_NOW_RECV_INFO    (ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0))
#define WSN_NOW_SEND_TXINFO  (ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0))

// ArduinoJson 6 / 7 compatibility helpers
#if ARDUINOJSON_VERSION_MAJOR >= 7
#define JSON_DOC(name, size)          JsonDocument name
#define JSON_ADD_ARR(parent, key)     ((parent)[key].to<JsonArray>())
#define JSON_ADD_OBJ(parent, key)     ((parent)[key].to<JsonObject>())
#define JSON_ARR_ADD_ARR(arr)         ((arr).add<JsonArray>())
#define JSON_ARR_ADD_OBJ(arr)         ((arr).add<JsonObject>())
#else
#define JSON_DOC(name, size)          StaticJsonDocument<size> name
#define JSON_ADD_ARR(parent, key)     ((parent).createNestedArray(key))
#define JSON_ADD_OBJ(parent, key)     ((parent).createNestedObject(key))
#define JSON_ARR_ADD_ARR(arr)         ((arr).createNestedArray())
#define JSON_ARR_ADD_OBJ(arr)         ((arr).createNestedObject())
#endif

#define FRAME_MAX 250   // ESP-NOW payload limit

// ---------------------------------------------------------------------------------------------
// Small helpers (std::min/max are templates in core 2.x/3.x and reject mixed types)
// ---------------------------------------------------------------------------------------------
static inline int32_t wMin(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t wMax(int32_t a, int32_t b) { return a > b ? a : b; }
static inline uint32_t wMinU(uint32_t a, uint32_t b) { return a < b ? a : b; }

// ---------------------------------------------------------------------------------------------
// Frame types (spec §3)
// ---------------------------------------------------------------------------------------------
enum FrameType : uint8_t { FT_HELLO = 0, FT_SCHED, FT_DATA, FT_AGG, FT_STAT, FT_ACK, FT_CTRL, FT_UNKNOWN };
static const char* const FT_NAMES[] = { "HELLO", "SCHED", "DATA", "AGG", "STAT", "ACK", "CTRL", "?" };
static inline const char* ftName(uint8_t t) { return FT_NAMES[t > (uint8_t)FT_UNKNOWN ? (uint8_t)FT_UNKNOWN : t]; }
static inline uint8_t ftFromStr(const char* s) {
  if (!s) return FT_UNKNOWN;
  for (uint8_t i = 0; i < FT_UNKNOWN; i++) if (strcmp(s, FT_NAMES[i]) == 0) return i;
  return FT_UNKNOWN;
}

// Node meta = uplink nodes[].role / sensor / unit (spec §1, §1.2; same strings as server/config.py NODE_META)
static const char* const NODE_ROLE[5]   = { "", "Sensor node", "Sensor / Relay node",
                                            "Cluster head / Aggregator / Router / Scheduler", "Sink / Gateway" };
static const char* const NODE_SENSOR[5] = { "", "ESP32 die temperature", "Turbidity (LM393 module)",
                                            "ESP32 die temperature", "Pond status light (2 LEDs)" };
static const char* const NODE_UNIT[5]   = { "", "degC x100", "raw ADC", "degC x100", "" };

// Ground truth positions (cm) and allowed links (spec §2, §8)
static const int16_t NODE_POS[5][2] = NODE_POS_TABLE;
static const uint8_t ALLOWED[5][5]  = ALLOWED_TABLE;
static inline bool isAllowed(uint8_t a, uint8_t b) { return a >= 1 && a <= 4 && b >= 1 && b <= 4 && ALLOWED[a][b]; }

// ---------------------------------------------------------------------------------------------
// Global node state
// ---------------------------------------------------------------------------------------------
static int32_t  g_netOffset = 0;          // netNow() = millis() + g_netOffset  (spec §5)
static bool     g_timeSynced = false;
static uint8_t  g_myMac[6];
static uint8_t  g_channel = WIFI_CHANNEL;
static volatile uint8_t g_nodeMac[5][6];  // learned from received frames (never hard-coded)
static volatile bool    g_nodeMacKnown[5];
static volatile int8_t  g_wifiRssi[5];    // per-source Wi-Fi RSSI (sniffer / recv info)
static volatile uint32_t g_lastAirUs = 0; // last time an ESP-NOW/DATA frame was on the air (channel sensing)
static bool     g_promiscOk = false;      // false -> CS_FALLBACK (virtual carrier sense)

static bool     g_killed = false;         // NODE_KILL: node silent
static uint32_t g_killUntilMs = 0;

static uint16_t g_seqData = 0, g_seqAgg = 0, g_seqStat = 0, g_seqBcast = 0, g_seqTest = 50000;
static uint32_t g_txDataCount = 0;        // DATA (N1/N2) or AGG (N3) frames originated
static uint32_t g_fwdCount = 0;           // frames forwarded as relay
static uint32_t g_oorCount = 0;           // frames dropped: sender not in ALLOWED (out of range)
static uint32_t g_blockedDrop = 0;        // frames dropped: LINK_FAIL blocked pair

static inline uint32_t netNow() { return (uint32_t)((int32_t)millis() + g_netOffset); }

// ---------------------------------------------------------------------------------------------
// Logging: every serial line goes through wlogf(). While the sink streams its JSON line the
// event lines are held back so that "JSON:{...}" stays one intact line for serial_bridge.py.
// ---------------------------------------------------------------------------------------------
#define HOLD_BUF 3072
static bool     g_serialJsonBusy = false;
static char     g_holdBuf[HOLD_BUF];
static uint16_t g_holdLen = 0;
static uint16_t g_holdPos = 0;            // FIX: drain position (held lines are written out non-blocking)
static uint32_t g_holdDropped = 0;

static void wlogRaw(const char* line) {
  // FIX: keep holding while the held lines are still draining, so that line order is kept and
  // println() never blocks the loop on a full UART buffer right after the JSON line
  if (g_serialJsonBusy || g_holdLen) {
    size_t n = strlen(line);
    if (g_holdLen + n + 2 < HOLD_BUF) {
      memcpy(g_holdBuf + g_holdLen, line, n);
      g_holdLen += n;
      g_holdBuf[g_holdLen++] = '\n';
    } else {
      g_holdDropped++;
    }
    return;
  }
  Serial.println(line);
}

static void wlogf(const char* mod, const char* fmt, ...) {
  char b[256];
  int n = snprintf(b, sizeof(b), "[N%d %s] ", NODE_ID, mod);
  if (n < 0) return;
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(b + n, sizeof(b) - n, fmt, ap);
  va_end(ap);
  wlogRaw(b);
}

// FIX: was one blocking Serial.write of up to 3 KB into a UART buffer that the JSON line had just
// filled (~0.3 s stall of N4's loop -> late ACKs -> N3's AGG timed out). Now drained in chunks
// that fit the free TX buffer; called from loop() until it returns true.
static bool wlogHoldDrain() {
  if (g_holdPos < g_holdLen) {
    int avail = Serial.availableForWrite() - 256;
    if (avail <= 0) return false;
    size_t n = g_holdLen - g_holdPos;
    if (n > (size_t)avail) n = (size_t)avail;
    Serial.write((const uint8_t*)g_holdBuf + g_holdPos, n);
    g_holdPos += n;
    if (g_holdPos < g_holdLen) return false;
  }
  g_holdLen = 0; g_holdPos = 0;
  if (g_holdDropped) { Serial.printf("[N%d LOG] %lu lines dropped while JSON was streaming\n", NODE_ID, (unsigned long)g_holdDropped); g_holdDropped = 0; }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Node event ring (route / sched / agg / ctrl / ble events). Shipped to the sink in STAT.ev.
// ---------------------------------------------------------------------------------------------
enum EvType : uint8_t { EV_ROUTE = 0, EV_SCHED, EV_MAC, EV_AGG, EV_CTRL, EV_BLE, EV_INFO };
static const char* const EV_NAMES[] = { "route", "sched", "mac", "agg", "ctrl", "ble", "info" };
#define NODE_EV_RING 16
#define EV_MSG_LEN 48
struct NodeEvent { uint32_t t; uint8_t type; char msg[EV_MSG_LEN]; };
static NodeEvent g_nodeEv[NODE_EV_RING];
static uint32_t  g_nodeEvCount = 0;      // total events written
static uint32_t  g_nodeEvShipped = 0;    // events delivered to the sink (STAT ACKed)

void sinkAddEvent(uint8_t node, uint8_t type, const char* msg, uint32_t t);   // sink.h

static void nodeEvent(uint8_t type, const char* fmt, ...) {
  NodeEvent& e = g_nodeEv[g_nodeEvCount % NODE_EV_RING];
  e.t = netNow();
  e.type = type;
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(e.msg, sizeof(e.msg), fmt, ap);
  va_end(ap);
  g_nodeEvCount++;
  if (g_nodeEvCount - g_nodeEvShipped > NODE_EV_RING) g_nodeEvShipped = g_nodeEvCount - NODE_EV_RING;
  if (IS_SINK) { sinkAddEvent(NODE_ID, type, e.msg, e.t); g_nodeEvShipped = g_nodeEvCount; }
}

static uint8_t classifyEvent(const char* m) {
  if (!m) return EV_INFO;
  if (!strncmp(m, "LINK", 4) || !strncmp(m, "ROUTE", 5) || !strncmp(m, "NO_ROUTE", 8) || !strncmp(m, "FWD", 3)) return EV_ROUTE;
  if (!strncmp(m, "SCHED", 5) || !strncmp(m, "MASTER", 6) || !strncmp(m, "SYNC", 4)) return EV_SCHED;
  if (!strncmp(m, "AGG", 3)) return EV_AGG;
  if (!strncmp(m, "CTRL", 4) || !strncmp(m, "KILL", 4) || !strncmp(m, "WAKE", 4) || !strncmp(m, "CONTENTION", 10) || !strncmp(m, "RESET", 5) ||
      !strncmp(m, "TEMP_WARN", 9)) return EV_CTRL;
  if (!strncmp(m, "BLE", 3)) return EV_BLE;
  if (!strncmp(m, "CS_", 3) || !strncmp(m, "BACKOFF", 7) || !strncmp(m, "ACK", 3) || !strncmp(m, "TX", 2) || !strncmp(m, "NEAR", 4) || !strncmp(m, "DEFER", 5)) return EV_MAC;
  return EV_INFO;
}

// ---------------------------------------------------------------------------------------------
// Forward declarations (cross-module)
// ---------------------------------------------------------------------------------------------
// mac.h
enum MacResult : uint8_t { MAC_OK = 0, MAC_FAIL = 1, MAC_ABORT = 2 };
uint8_t macSend(const char* frame, size_t len, uint8_t dest, bool needAck, uint8_t ftype, uint16_t q, uint8_t origin, uint32_t deadlineMs);
void macEvent(const char* fmt, ...);
void macResetCounters();
// routing.h
bool routeLinkBlocked(uint8_t other);
bool routePairBlocked(uint8_t a, uint8_t b);
void routeOnTxAttempt(uint8_t nb, bool acked);
void routeOnTxResult(uint8_t nb, bool ok);
uint8_t routeNextHop();
void routeResetStats();
// tdma.h
bool tdmaIsAwake();
uint32_t tdmaSlotRemainingMs();
uint32_t tdmaCurrentSf();
int8_t tdmaCurrentSlot();
uint16_t tdmaVersion();
void tdmaNoteHeard(uint8_t k);
void tdmaResetStats();
void tdmaGrace();
// aggregation.h
void aggResetStats();
// sink.h
void sinkResetStats();
void sinkLightTest(const char* why);
void sinkLogMacEvent(uint8_t node, uint32_t t, const char* ev);
void sinkLogMsg(uint32_t t, uint8_t type, bool bcast, uint8_t from, uint8_t to, int32_t seq, int8_t acked, const char* path);
void sinkCountTx(uint8_t ftype);
// wsn_node.ino
void rxProcessQueue(uint8_t maxFrames);
