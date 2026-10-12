// =============================================================================================
// AquaSense-WSN  -  sink.h   [G §4.c sink communication, G §4.g performance metrics, spec §9]
// N4 only (the code compiles on every node, the buffers are sized down to nothing elsewhere):
// * per-origin PDR bookkeeping (first_seq / max_seq / rx / lost, session restart like the
//   reference gateway), end-to-end delay via network time
// * mac_log / msg_log / events ring buffers, broadcast/unicast counters per type
// * uplink JSON EXACTLY per spec §9.1 (streaming writer into a static buffer - no heap),
//   HTTP POST to UPLINK_URL with Wi-Fi reconnect, reply `commands` (dedupe by id)
// * same JSON on Serial as one line "JSON:{...}" (non-blocking, chunked), "CMD:{...}" input
// * pond status light (spec §9.3): two LEDs on LED_GREEN_PIN / LED_RED_PIN driven from the
//   freshest flag per node, from an AGG or a direct DATA (N2 turbid -> red, N1 enclosure hot ->
//   red blinking, else green; stale / off / test),
//   LIGHT_TEST command handled locally (never broadcast to the WSN), uplink `light` object
// =============================================================================================
#pragma once
#include "shared.h"
#include <HTTPClient.h>
#include <math.h>

#define SINK_LOG_N    (IS_SINK ? 60 : 1)
#define SINK_UPBUF_N  (IS_SINK ? SINK_UPLINK_BUF : 8)

// ---------------------------------------------------------------------------------------------
// Commands (dashboard -> sink -> CTRL broadcast)
// ---------------------------------------------------------------------------------------------
// v = integer argument (spec §3 CTRL `v`, only TEMP_WARN: degC x100); CMD_V_NONE = not given
#define CMD_V_NONE INT32_MIN
struct WsnCmd { char c[20]; uint8_t a, b; uint16_t dur; uint32_t at; uint32_t id; int32_t v; };
void ctrlExecute(const WsnCmd& c);          // wsn_node.ino
#define CMDQ_LEN 6
static WsnCmd   g_cmdQ[CMDQ_LEN];
static uint8_t  g_cmdN = 0;
static uint32_t g_cmdSeen[16];
static uint32_t g_cmdSeenMs[16];
static uint8_t  g_cmdSeenN = 0;
static uint32_t g_netCmdId = 0;              // network-unique CTRL id (random base per sink boot)

// ---------------------------------------------------------------------------------------------
// Per-node records at the sink
// ---------------------------------------------------------------------------------------------
struct SinkNode {
  bool everHeard; uint32_t lastHeardMs;
  bool hasValue; int32_t value; uint16_t seq; uint32_t valueTs;
  bool hasTh; uint8_t th;                // th flag of the latest DATA / AGG part (N1, N2)
  bool hasTw; int32_t tw;                // N1: TEMP_WARN threshold (degC x100) from STAT pt3 `tw`
  bool hasDelay; int32_t delayMs;
  char route[24];
  int32_t firstSeq, maxSeq; uint32_t rx;
  bool hasStat1, hasStat2;
  uint32_t mac[8];                       // tx retx ok to busy bo col def
  int8_t tdmaSlot; uint16_t tdmaVer; uint32_t awake, sleep; float duty;
  uint32_t tx, fw, oor, up; bool hasUp;
  uint8_t nh, h, alt; uint16_t c, altc;
  uint8_t near;
  bool hasAgg; uint32_t agg[4];          // cumulative in out bi bo (N3)
  char ev[4][EV_MSG_LEN]; uint8_t evN;   // last 4 events of this node
};
static SinkNode g_sn[5];

struct SinkMacLog { uint32_t t; uint8_t node; char ev[30]; };
struct SinkMsgLog { uint32_t t; uint8_t type; bool bcast; uint8_t from, to; int32_t seq; int8_t acked; char path[16]; };
struct SinkEvLog  { uint32_t t; uint8_t node; uint8_t type; char msg[EV_MSG_LEN]; };
static SinkMacLog g_sMac[SINK_LOG_N];  static uint32_t g_sMacN = 0;
static SinkMsgLog g_sMsg[SINK_LOG_N];  static uint32_t g_sMsgN = 0;
static SinkEvLog  g_sEv[SINK_LOG_N];   static uint32_t g_sEvN = 0;

static uint32_t g_cntBcast[3];         // HELLO SCHED CTRL (seen + sent by the sink)
static uint32_t g_cntStatRx = 0, g_cntAggRx = 0, g_cntDataRx = 0;

struct SinkHist { uint16_t ver; char why[40]; uint32_t t; };
static SinkHist g_hist[IS_SINK ? TDMA_HISTORY : 1];
static uint8_t  g_histN = 0;

struct LastAggPart { bool has; int32_t v; uint16_t q; uint32_t ts; uint16_t cnt; int32_t mean, mn, mx; uint8_t th; };
struct LastAgg { bool valid; uint32_t w; uint16_t in; uint32_t bi, bo; uint8_t red; LastAggPart n[3]; int32_t n3v; char path[16]; int32_t delayMs; };
static LastAgg g_lastAgg;

struct SinkCt { bool valid; uint32_t at; char lines[3][CT_LINES][34]; uint8_t n[3]; };
static SinkCt g_sCt;

static char     g_upBuf[SINK_UPBUF_N];
static size_t   g_upLen = 0, g_serPos = 0;
static bool     g_uplinkDue = false;
static uint32_t g_lastUplinkMs = 0, g_uplinkCount = 0, g_uplinkOk = 0;
static int      g_lastHttpCode = 0;

// Wi-Fi uplink state
static bool     g_wifiOk = false, g_wifiEver = false, g_wifiAttempting = false;
static bool     g_wifiChanLock = false;   // hotspot found on another channel than the WSN -> stay off it
static uint32_t g_wifiRetryAt = 0, g_wifiAttemptStart = 0, g_wifiLostMs = 0;

// ---------------------------------------------------------------------------------------------
// Logs / counters
// ---------------------------------------------------------------------------------------------
void sinkAddEvent(uint8_t node, uint8_t type, const char* msg, uint32_t t) {
  if (!IS_SINK || node < 1 || node > 4) return;
  SinkEvLog& e = g_sEv[g_sEvN % SINK_LOG_N];
  e.t = t; e.node = node; e.type = type;
  strncpy(e.msg, msg, sizeof(e.msg) - 1); e.msg[sizeof(e.msg) - 1] = 0;
  g_sEvN++;
  SinkNode& r = g_sn[node];
  strncpy(r.ev[r.evN % 4], msg, EV_MSG_LEN - 1); r.ev[r.evN % 4][EV_MSG_LEN - 1] = 0;
  r.evN++;
}
void sinkLogMacEvent(uint8_t node, uint32_t t, const char* ev) {
  if (!IS_SINK) return;
  SinkMacLog& e = g_sMac[g_sMacN % SINK_LOG_N];
  e.t = t; e.node = node;
  strncpy(e.ev, ev, sizeof(e.ev) - 1); e.ev[sizeof(e.ev) - 1] = 0;
  g_sMacN++;
}
void sinkLogMsg(uint32_t t, uint8_t type, bool bcast, uint8_t from, uint8_t to, int32_t seq, int8_t acked, const char* path) {
  if (!IS_SINK) return;
  SinkMsgLog& e = g_sMsg[g_sMsgN % SINK_LOG_N];
  e.t = t; e.type = type; e.bcast = bcast; e.from = from; e.to = to; e.seq = seq; e.acked = acked;
  strncpy(e.path, path ? path : "", sizeof(e.path) - 1); e.path[sizeof(e.path) - 1] = 0;
  g_sMsgN++;
}
void sinkCountTx(uint8_t ftype) {
  if (ftype == FT_HELLO) g_cntBcast[0]++;
  else if (ftype == FT_SCHED) g_cntBcast[1]++;
  else if (ftype == FT_CTRL) g_cntBcast[2]++;
}
void sinkHistAdd(uint16_t ver, const char* why, uint32_t t) {
  if (!IS_SINK) return;
  if (g_histN && g_hist[g_histN - 1].ver == ver) return;
  if (g_histN >= TDMA_HISTORY) { memmove(&g_hist[0], &g_hist[1], sizeof(SinkHist) * (TDMA_HISTORY - 1)); g_histN--; }
  SinkHist& h = g_hist[g_histN++];
  h.ver = ver; h.t = t;
  strncpy(h.why, why, sizeof(h.why) - 1); h.why[sizeof(h.why) - 1] = 0;
}

static void sinkTouch(uint8_t k) {
  if (k < 1 || k > 4) return;
  g_sn[k].everHeard = true;
  g_sn[k].lastHeardMs = millis();
  tdmaNoteHeard(k);
}

// Path "1>2>3>4" -> one msg_log entry per hop (reconstructs the unicast chain of a delivery)
static void sinkLogPathHops(uint32_t t, uint8_t type, const char* path, int32_t seq) {
  int prev = -1;
  char sub[16]; size_t sl = 0;
  for (const char* p = path; *p; p++) {
    if (*p < '1' || *p > '4') { if (sl < sizeof(sub) - 1) sub[sl++] = *p; continue; }
    int k = *p - '0';
    if (sl < sizeof(sub) - 1) sub[sl++] = *p;
    sub[sl] = 0;
    if (prev > 0) sinkLogMsg(t, type, false, (uint8_t)prev, (uint8_t)k, seq, 1, sub);
    prev = k;
  }
}

// [G §4.g] PDR bookkeeping per origin (rx_unique / (max_seq - first_seq + 1))
static void sinkPdr(uint8_t o, uint16_t q, uint16_t cnt) {
  SinkNode& r = g_sn[o];
  if (cnt == 0) cnt = 1;
  if (r.firstSeq < 0) {
    r.firstSeq = wMax(1, (int32_t)q - cnt + 1);
    r.maxSeq = q;
    r.rx = cnt;
    return;
  }
  if ((int32_t)q > r.maxSeq) {
    uint32_t gap = (uint32_t)((int32_t)q - r.maxSeq);
    r.rx += (cnt < gap) ? cnt : gap;
    r.maxSeq = q;
    return;
  }
  // origin rebooted -> new session (reference gateway logic). FIX: also q<=2 (seqs restart at 1;
  // duplicates never get this far): an early reboot (max_seq < 21) was never detected and the
  // new frames were dropped as "late copies" until q passed the old max_seq.
  if ((int32_t)q + 20 < r.maxSeq || (q <= 2 && r.maxSeq > 4)) {
    wlogf("SINK", "N%u sequence restarted (%ld -> %u): new PDR session", (unsigned)o, (long)r.maxSeq, (unsigned)q);
    r.firstSeq = wMax(1, (int32_t)q - cnt + 1);
    r.maxSeq = q;
    r.rx = cnt;
  }                                            // else: duplicate / late copy -> ignored
}
static uint32_t sinkLost(const SinkNode& r) {
  if (r.firstSeq < 0) return 0;
  int32_t exp = r.maxSeq - r.firstSeq + 1;
  return exp > (int32_t)r.rx ? (uint32_t)(exp - (int32_t)r.rx) : 0;
}
static float sinkPdrPct(const SinkNode& r) {
  if (r.firstSeq < 0) return 100.0f;
  int32_t exp = r.maxSeq - r.firstSeq + 1;
  float p = exp > 0 ? (float)r.rx * 100.0f / (float)exp : 100.0f;
  return p > 100.0f ? 100.0f : p;
}

// ---------------------------------------------------------------------------------------------
// [spec §9.3] Pond status light (N4), two LEDs (red and green; there is no yellow LED). Priority
//   test > off (not synced / no sample yet) > stale (no AGG and no direct DATA for
//   LIGHT_STALE_SF superframes, green blinking) > red (freshest N2 flag) > hot (freshest N1
//   flag, red blinking) > green.
// The flags are the freshest ones the sink holds per node (g_sn[o].th), whichever way they
// arrived: inside an AGG from N3 or in a DATA frame that reached N4 directly. Adaptive routing
// lets N2 use the path 2>4, which bypasses N3, so the latest AGG alone is not enough.
// Evaluated after every AGG, after every direct DATA and from sinkService() (blink, stale and
// test timing).
// ---------------------------------------------------------------------------------------------
enum LightState : uint8_t { LIGHT_OFF = 0, LIGHT_GREEN, LIGHT_RED, LIGHT_HOT, LIGHT_STALE, LIGHT_TEST };
static const char* const LIGHT_NAMES[] = { "off", "green", "red", "hot", "stale", "test" };
#define LIGHT_PIN_G 1
#define LIGHT_PIN_R 2
static uint8_t  g_lightState = LIGHT_OFF;
static char     g_lightReason[40] = "waiting for first data";
static uint32_t g_lightSince = 0;           // network time of the last state change
static bool     g_lightTestOn = false;
static uint32_t g_lightTestMs = 0;          // millis() when LIGHT_TEST started
static bool     g_aggEver = false;
static uint32_t g_lastAggRxMs = 0;          // millis() of the latest AGG
static bool     g_sampleEver = false;       // an AGG or a direct DATA has reached the sink
static uint32_t g_lastSampleRxMs = 0;       // millis() of the latest AGG or direct DATA
static uint32_t g_thRxMs[3] = { 0, 0, 0 };  // millis() of the latest sample carrying N1's / N2's flag
static uint8_t  g_lightPins = 0xFF;         // LED pattern currently written (LIGHT_PIN_* bits)

static void lightWrite(uint8_t pins) {
  if (!IS_SINK || pins == g_lightPins) return;
  g_lightPins = pins;
  digitalWrite(LED_GREEN_PIN, (pins & LIGHT_PIN_G) ? HIGH : LOW);
  digitalWrite(LED_RED_PIN, (pins & LIGHT_PIN_R) ? HIGH : LOW);
}

static void lightEvaluate() {
  if (!IS_SINK) return;
  uint32_t now = millis();
  const uint32_t staleMs = (uint32_t)LIGHT_STALE_SF * TDMA_SF_MS;
  const bool blinkOn = ((now / LIGHT_BLINK_MS) & 1) == 0;
  uint8_t st;
  char why[sizeof(g_lightReason)];
  uint8_t pins = 0;
  if (g_lightTestOn && now - g_lightTestMs >= 2UL * LIGHT_TEST_MS) g_lightTestOn = false;   // test over
  if (g_lightTestOn) {
    uint32_t phase = (now - g_lightTestMs) / LIGHT_TEST_MS;                 // 0 red, 1 green
    st = LIGHT_TEST;
    snprintf(why, sizeof(why), "LIGHT_TEST");
    pins = phase == 0 ? LIGHT_PIN_R : LIGHT_PIN_G;
  } else if (!g_timeSynced || !g_sampleEver) {
    st = LIGHT_OFF;
    snprintf(why, sizeof(why), "%s", g_timeSynced ? "waiting for first data" : "not synced, waiting for first data");
  } else if (now - g_lastSampleRxMs >= staleMs) {
    st = LIGHT_STALE;
    snprintf(why, sizeof(why), "no data for %lu s", (unsigned long)((now - g_lastSampleRxMs) / 1000));
    pins = blinkOn ? LIGHT_PIN_G : 0;                                        // green blinking
  } else if (g_sn[2].hasTh && g_sn[2].th && now - g_thRxMs[2] < staleMs) {
    st = LIGHT_RED;
    snprintf(why, sizeof(why), "turbidity threshold (D)");
    pins = LIGHT_PIN_R;
  } else if (g_sn[1].hasTh && g_sn[1].th && now - g_thRxMs[1] < staleMs) {
    st = LIGHT_HOT;
    snprintf(why, sizeof(why), "N1 enclosure hot");
    pins = blinkOn ? LIGHT_PIN_R : 0;                                        // red blinking
  } else {
    st = LIGHT_GREEN;
    snprintf(why, sizeof(why), "all nominal");
    pins = LIGHT_PIN_G;
  }
  lightWrite(pins);
  strncpy(g_lightReason, why, sizeof(g_lightReason) - 1);       // reason may change within a state (stale age)
  g_lightReason[sizeof(g_lightReason) - 1] = 0;
  if (st != g_lightState) {
    g_lightState = st;
    g_lightSince = netNow();
    wlogf("LIGHT", "%s: %s", LIGHT_NAMES[st], g_lightReason);
    nodeEvent(EV_CTRL, "light -> %s", LIGHT_NAMES[st]);
  }
}

// A sample (AGG, or a DATA frame that reached the sink directly) arrived; `o` = 1 or 2 when it
// carried that node's alert flag, 0 otherwise. Keeps the light's freshness clocks.
static void lightOnSample(uint8_t o) {
  uint32_t now = millis();
  g_sampleEver = true;
  g_lastSampleRxMs = now;
  if (o == 1 || o == 2) g_thRxMs[o] = now;
}

// LIGHT_TEST (spec §9.1): red, then green, LIGHT_TEST_MS each, then back to the data state
void sinkLightTest(const char* why) {
  if (!IS_SINK) return;
  wlogf("LIGHT", "LIGHT_TEST from %s: red -> green, %d ms each (local, not broadcast)", why, LIGHT_TEST_MS);
  g_lightTestOn = true;
  g_lightTestMs = millis();
  lightEvaluate();
}

static void lightInit() {
  if (!IS_SINK) return;
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_RED_PIN, OUTPUT);
  g_lightPins = 0xFF;
  lightWrite(0);
  g_lightState = LIGHT_OFF;
  g_lightSince = netNow();
  wlogf("LIGHT", "status light green=GPIO%d red=GPIO%d (stale after %d SF, test %d ms/colour)", LED_GREEN_PIN,
        LED_RED_PIN, LIGHT_STALE_SF, LIGHT_TEST_MS);
  wlogf("LIGHT", "%s: %s", LIGHT_NAMES[g_lightState], g_lightReason);
}

// ---------------------------------------------------------------------------------------------
// Frame handlers (called from the rx dispatcher in wsn_node.ino; unicasts already ACKed)
// ---------------------------------------------------------------------------------------------
static void sinkOnData(uint8_t s, JsonDocument& doc, uint32_t rxMs) {
  uint8_t o = doc["o"] | s;
  if (o < 1 || o > 3) return;
  uint16_t q = doc["q"] | 0;
  uint32_t ts = doc["ts"].as<uint32_t>();
  uint32_t nowNet = (uint32_t)((int32_t)rxMs + g_netOffset);
  char path[24];
  snprintf(path, sizeof(path), "%s>%d", (const char*)(doc["p"] | ""), NODE_ID);
  g_cntDataRx++;
  sinkLogPathHops(nowNet, FT_DATA, path, q);
  sinkTouch(o);
  SinkNode& r = g_sn[o];
  sinkPdr(o, q, 1);
  r.hasValue = true; r.value = doc["v"] | 0; r.seq = q; r.valueTs = ts;
  if (o == 1 || o == 2) { r.hasTh = true; r.th = (doc["th"] | 0) ? 1 : 0; }
  r.hasDelay = true; r.delayMs = (int32_t)(nowNet - ts);
  strncpy(r.route, path, sizeof(r.route) - 1); r.route[sizeof(r.route) - 1] = 0;
  wlogf("SINK", "DATA N%u q=%u v=%ld th=%u path %s delay %ld ms (raw, not aggregated)", (unsigned)o, (unsigned)q, (long)r.value,
        (unsigned)r.th, path, (long)r.delayMs);
  lightOnSample(o);
  lightEvaluate();                                                     // spec §9.3: a direct sample also drives the light
}

static void sinkOnAgg(uint8_t s, JsonDocument& doc, uint32_t rxMs) {
  (void)s;
  uint32_t nowNet = (uint32_t)((int32_t)rxMs + g_netOffset);
  uint16_t q = doc["q"] | 0;
  uint32_t ts = doc["ts"].as<uint32_t>();
  const char* ap = doc["p"] | "3";
  LastAgg& L = g_lastAgg;
  L.valid = true;
  L.w = doc["w"].as<uint32_t>(); L.in = doc["in"] | 0; L.bi = doc["bi"].as<uint32_t>(); L.bo = doc["bo"].as<uint32_t>();
  L.red = doc["red"] | 0;
  L.n3v = doc["n3"]["v"] | -1;
  snprintf(L.path, sizeof(L.path), "%s>%d", ap, NODE_ID);
  L.delayMs = (int32_t)(nowNet - ts);
  g_cntAggRx++;
  for (uint8_t o = 1; o <= 2; o++) {
    LastAggPart& P = L.n[o];
    JsonObject x = doc[o == 1 ? "n1" : "n2"].as<JsonObject>();
    P.has = !x.isNull();
    if (!P.has) continue;
    P.v = x["v"] | 0; P.q = x["q"] | 0; P.ts = x["ts"].as<uint32_t>(); P.cnt = x["cnt"] | 1;
    P.mean = x["mean"] | P.v; P.mn = x["min"] | P.v; P.mx = x["max"] | P.v;     // cnt==1 compact form
    P.th = (x["th"] | 0) ? 1 : 0;                                              // OR-fused over N3's window
    const char* np = x["p"] | "";
    char npb[8];
    if (!np[0]) { snprintf(npb, sizeof(npb), "%u>3", (unsigned)o); np = npb; }   // p omitted = direct path o>3
    char route[24];
    snprintf(route, sizeof(route), "%s%s>%d", np, ap + 1, NODE_ID);           // "1>2>3" + ">2" + ">4"
    sinkLogPathHops(P.ts, FT_DATA, np, P.q);
    sinkTouch(o);
    SinkNode& r = g_sn[o];
    sinkPdr(o, P.q, P.cnt);
    r.hasValue = true; r.value = P.v; r.seq = P.q; r.valueTs = P.ts;
    r.hasTh = true; r.th = P.th;
    lightOnSample(o);
    r.hasDelay = true; r.delayMs = (int32_t)(nowNet - P.ts);           // includes aggregation hold time
    strncpy(r.route, route, sizeof(r.route) - 1); r.route[sizeof(r.route) - 1] = 0;
  }
  sinkLogPathHops(nowNet, FT_AGG, L.path, q);
  sinkTouch(3);
  SinkNode& r3 = g_sn[3];
  sinkPdr(3, q, 1);
  r3.hasValue = true; r3.value = L.n3v; r3.seq = q; r3.valueTs = ts;
  r3.hasDelay = true; r3.delayMs = L.delayMs;
  strncpy(r3.route, L.path, sizeof(r3.route) - 1); r3.route[sizeof(r3.route) - 1] = 0;
  wlogf("SINK", "AGG q=%u w=%lu in=%u bytes %lu->%lu red=%u%% path %s | N1=%ld th%u N2=%ld th%u N3=%ld | delay %ld ms",
        (unsigned)q, (unsigned long)L.w, (unsigned)L.in, (unsigned long)L.bi, (unsigned long)L.bo, (unsigned)L.red, L.path,
        L.n[1].has ? (long)L.n[1].v : -1L, (unsigned)L.n[1].th, L.n[2].has ? (long)L.n[2].v : -1L, (unsigned)L.n[2].th,
        (long)L.n3v, (long)L.delayMs);
  g_aggEver = true;
  g_lastAggRxMs = millis();
  lightOnSample(0);
  lightEvaluate();                                                     // spec §9.3: after every AGG
}

static void sinkOnStat(uint8_t s, JsonDocument& doc, uint32_t rxMs) {
  uint8_t o = doc["o"] | s;
  if (o < 1 || o > 3) return;
  uint8_t pt = doc["pt"] | 1;
  uint16_t q = doc["q"] | 0;
  uint32_t ts = doc["ts"].as<uint32_t>();
  uint32_t nowNet = (uint32_t)((int32_t)rxMs + g_netOffset);
  SinkNode& r = g_sn[o];
  sinkTouch(o);
  g_cntStatRx++;
  char path[12];
  if (s == o) snprintf(path, sizeof(path), "%u>%d", (unsigned)o, NODE_ID);
  else snprintf(path, sizeof(path), "%u>%u>%d", (unsigned)o, (unsigned)s, NODE_ID);
  sinkLogMsg(nowNet, FT_STAT, false, s, NODE_ID, q, 1, path);
  if (pt == 1) {
    r.hasStat1 = true;
    JsonObject m = doc["mac"].as<JsonObject>();
    static const char* const K[8] = { "tx", "retx", "ok", "to", "busy", "bo", "col", "def" };
    for (int i = 0; i < 8; i++) r.mac[i] = m[K[i]] | 0;
    JsonObject t = doc["tdma"].as<JsonObject>();
    r.tdmaSlot = t["slot"] | -1; r.tdmaVer = t["ver"] | 0;
    r.awake = t["awake"].as<uint32_t>(); r.sleep = t["sleep"].as<uint32_t>(); r.duty = t["duty"] | 0.0f;
  } else if (pt == 2) {
    r.hasStat2 = true;
    JsonObject rt = doc["rt"].as<JsonObject>();
    r.nh = rt["nh"] | 0; r.h = rt["h"] | 255; r.c = rt["c"] | 0; r.alt = rt["alt"] | 0; r.altc = rt["altc"] | 0;
    JsonArray ble = doc["ble"].as<JsonArray>();
    for (JsonVariant v : ble) {
      JsonArray e = v.as<JsonArray>();
      locSetPair(o, e[0] | 0, (int8_t)(e[1] | 0), (uint16_t)(e[2] | 0));
    }
    r.near = doc["near"] | 0;
    g_nearestOf[o] = r.near;
    JsonObject ag = doc["agg"].as<JsonObject>();
    if (!ag.isNull()) {
      r.hasAgg = true;
      r.agg[0] = ag["in"] | 0; r.agg[1] = ag["out"] | 0; r.agg[2] = ag["bi"] | 0; r.agg[3] = ag["bo"] | 0;
    }
  } else if (pt == 3) {
    if (!doc["tx"].isNull()) r.tx = doc["tx"].as<uint32_t>();
    if (!doc["fw"].isNull()) r.fw = doc["fw"].as<uint32_t>();
    if (!doc["oor"].isNull()) r.oor = doc["oor"].as<uint32_t>();
    if (!doc["up"].isNull()) { r.up = doc["up"].as<uint32_t>(); r.hasUp = true; }
    if (o == 1 && !doc["tw"].isNull()) {                                 // N1 TEMP_WARN (spec §3 STAT tw)
      int32_t tw = doc["tw"].as<int32_t>();
      if (!r.hasTw || r.tw != tw)
        wlogf("SINK", "N1 TEMP_WARN %ld.%02ld C (STAT tw=%ld)", (long)(tw / 100), (long)(tw % 100), (long)tw);
      r.tw = tw; r.hasTw = true;
    }
    JsonArray ev = doc["ev"].as<JsonArray>();
    for (JsonVariant v : ev) { const char* m = v | ""; if (m[0]) sinkAddEvent(o, classifyEvent(m), m, ts); }
    JsonArray me = doc["me"].as<JsonArray>();
    for (JsonVariant v : me) {
      JsonArray e = v.as<JsonArray>();
      uint32_t age = e[0] | 0;
      sinkLogMacEvent(o, ts - age, e[1] | "");
    }
  } else if (pt == 4 && (o == 1 || o == 2)) {
    uint32_t at = doc["cta"].as<uint32_t>();
    if (!g_sCt.valid || g_sCt.at != at) { memset(&g_sCt, 0, sizeof(g_sCt)); g_sCt.at = at; }
    g_sCt.valid = true;
    g_sCt.n[o] = 0;
    JsonArray ev = doc["ev"].as<JsonArray>();
    for (JsonVariant v : ev) {
      if (g_sCt.n[o] >= CT_LINES) break;
      strncpy(g_sCt.lines[o][g_sCt.n[o]], v | "", 33);
      g_sCt.lines[o][g_sCt.n[o]][33] = 0;
      g_sCt.n[o]++;
    }
    wlogf("MAC", "CONTENTION_TEST timeline of N%u received (%u steps)", (unsigned)o, (unsigned)g_sCt.n[o]);
    for (uint8_t i = 0; i < g_sCt.n[o]; i++) wlogf("MAC", "  N%u %s", (unsigned)o, g_sCt.lines[o][i]);
  }
}

static void sinkOnBroadcast(uint8_t ftype, uint8_t s, uint16_t q, uint32_t rxMs, JsonDocument& doc) {
  uint32_t nowNet = (uint32_t)((int32_t)rxMs + g_netOffset);
  if (ftype == FT_HELLO) {
    g_cntBcast[0]++;
    sinkTouch(s);
    if (!g_sn[s].hasUp) g_sn[s].up = doc["up"].as<uint32_t>();
  } else if (ftype == FT_SCHED) {
    g_cntBcast[1]++;
  } else if (ftype == FT_CTRL) {
    g_cntBcast[2]++;
  }
  sinkLogMsg(nowNet, ftype, true, s, 0, q, -1, "");
}

// ---------------------------------------------------------------------------------------------
// Commands: queue (dedupe by id), CTRL broadcast in the CONTROL slot
// ---------------------------------------------------------------------------------------------
static void sinkQueueCommand(JsonObject c) {
  const char* name = c["c"] | "";
  if (!name[0]) return;
  uint32_t id = c["id"] | 0;
  // FIX: the server numbers commands from 1 again after every restart, and a typed CMD: line may
  // have no id (0). Node-side dedupe remembers executed ids, so after a server restart (or for the
  // 2nd id-less command) the CTRL was silently dropped everywhere. Now: server ids are deduped
  // here for 60 s only, and the CTRL frame carries a fresh network-unique id.
  if (id) {
    uint32_t now = millis();
    for (uint8_t i = 0; i < g_cmdSeenN; i++) if (g_cmdSeen[i] == id && now - g_cmdSeenMs[i] < 60000UL) return;
    if (g_cmdSeenN >= 16) {
      memmove(&g_cmdSeen[0], &g_cmdSeen[1], sizeof(uint32_t) * 15);
      memmove(&g_cmdSeenMs[0], &g_cmdSeenMs[1], sizeof(uint32_t) * 15);
      g_cmdSeenN = 15;
    }
    g_cmdSeen[g_cmdSeenN] = id; g_cmdSeenMs[g_cmdSeenN] = now; g_cmdSeenN++;
  }
  if (!strcmp(name, "LIGHT_TEST")) {             // spec §9.1: N4 only, executed here, NOT broadcast as CTRL
    wlogf("CMD", "LIGHT_TEST (server id %lu) -> run locally on the status light", (unsigned long)id);
    sinkLightTest("dashboard");
    return;
  }
  if (!strcmp(name, "TEMP_WARN") && c["v"].isNull()) {     // spec §9.1: TEMP_WARN{a:1, v}
    wlogf("CMD", "TEMP_WARN without v (server id %lu) dropped", (unsigned long)id);
    return;
  }
  if (g_cmdN >= CMDQ_LEN) { wlogf("CMD", "queue full, %s dropped", name); return; }
  if (!g_netCmdId) g_netCmdId = (esp_random() & 0x7FFF0000UL) | 0x1000UL;
  WsnCmd& w = g_cmdQ[g_cmdN++];
  memset(&w, 0, sizeof(w));
  strncpy(w.c, name, sizeof(w.c) - 1);
  w.a = c["a"] | 0; w.b = c["b"] | 0; w.dur = c["dur"] | 0; w.id = ++g_netCmdId;
  w.v = c["v"].isNull() ? CMD_V_NONE : c["v"].as<int32_t>();
  char vs[16] = "";
  if (w.v != CMD_V_NONE) snprintf(vs, sizeof(vs), " v=%ld", (long)w.v);
  wlogf("CMD", "queued %s a=%u b=%u dur=%u%s id=%lu (server id %lu, sent in next CONTROL slot)", w.c, (unsigned)w.a, (unsigned)w.b,
        (unsigned)w.dur, vs, (unsigned long)w.id, (unsigned long)id);
}

static size_t ctrlBuild(char* out, size_t cap, const WsnCmd& c, bool relay) {
  JSON_DOC(doc, 512);
  doc["t"] = "CTRL"; doc["s"] = NODE_ID; doc["d"] = 0; doc["q"] = ++g_seqBcast; doc["ts"] = netNow();
  doc["c"] = (const char*)c.c; doc["a"] = c.a; doc["b"] = c.b; doc["dur"] = c.dur; doc["at"] = c.at; doc["id"] = c.id;
  if (c.v != CMD_V_NONE) doc["v"] = c.v;                // spec §3 CTRL v (only TEMP_WARN)
  if (relay) doc["r"] = 1;
  return serializeJson(doc, out, cap);
}

// N4: send one queued command as CTRL broadcast (CONTROL slot). Returns true if one was sent.
static bool sinkSendCommand(uint32_t dl) {
  if (!g_cmdN) return false;
  WsnCmd c = g_cmdQ[0];
  memmove(&g_cmdQ[0], &g_cmdQ[1], sizeof(WsnCmd) * (CMDQ_LEN - 1));
  g_cmdN--;
  if (!strcmp(c.c, "LIGHT_TEST")) { sinkLightTest("queue"); return false; }   // never broadcast (normally not queued)
  if (!strcmp(c.c, "CONTENTION_TEST")) c.at = tdmaNextSlotStart(TDMA_CONTROL, netNow() + TDMA_CT_LEAD_MS) + TDMA_CT_OFFSET_MS;
  char out[FRAME_MAX + 8];
  size_t n = ctrlBuild(out, sizeof(out), c, false);
  uint8_t r = macSend(out, n, 0, false, FT_CTRL, g_seqBcast, NODE_ID, dl);
  char vs[16] = "";
  if (c.v != CMD_V_NONE) snprintf(vs, sizeof(vs), " v=%ld", (long)c.v);
  wlogf("CTRL", "bcast %s a=%u b=%u dur=%u%s at=%lu id=%lu %s", c.c, (unsigned)c.a, (unsigned)c.b, (unsigned)c.dur, vs,
        (unsigned long)c.at, (unsigned long)c.id, r == MAC_OK ? "" : "(TX failed)");
  sinkLogMsg(netNow(), FT_CTRL, true, NODE_ID, 0, g_seqBcast, -1, "");
  ctrlExecute(c);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Uplink JSON writer (bounded, no heap)
// ---------------------------------------------------------------------------------------------
struct JW {
  char* b; size_t cap; size_t n; bool ovf; uint8_t d; bool first[12]; bool afterKey;
  void begin(char* buf, size_t c) { b = buf; cap = c; n = 0; ovf = false; d = 0; first[0] = true; afterKey = false; }
  void ch(char c) { if (n + 2 < cap) b[n++] = c; else ovf = true; }
  void raw(const char* s) { while (*s) ch(*s++); }
  void sep() { if (afterKey) { afterKey = false; return; } if (!first[d]) ch(','); first[d] = false; }
  void qstr(const char* s) {
    ch('"');
    for (; s && *s; s++) {
      char c = *s;
      if (c == '"' || c == '\\') { ch('\\'); ch(c); }
      else if ((uint8_t)c < 0x20) { char e[8]; snprintf(e, sizeof(e), "\\u%04x", (unsigned)(uint8_t)c); raw(e); }
      else ch(c);
    }
    ch('"');
  }
  void key(const char* k) { sep(); qstr(k); ch(':'); afterKey = true; }
  void obj() { sep(); ch('{'); if (d < 11) d++; first[d] = true; }
  void objEnd() { ch('}'); if (d) d--; }
  void arr() { sep(); ch('['); if (d < 11) d++; first[d] = true; }
  void arrEnd() { ch(']'); if (d) d--; }
  void s(const char* v) { sep(); qstr(v ? v : ""); }
  void i(long v) { sep(); char t[16]; snprintf(t, sizeof(t), "%ld", v); raw(t); }
  void u(unsigned long v) { sep(); char t[16]; snprintf(t, sizeof(t), "%lu", v); raw(t); }
  void f(float v, int dec) { sep(); if (isnan(v) || isinf(v)) { raw("null"); return; } char t[24]; snprintf(t, sizeof(t), "%.*f", dec, (double)v); raw(t); }
  void nul() { sep(); raw("null"); }
  void bl(bool v) { sep(); raw(v ? "true" : "false"); }
  void ki(const char* k, long v) { key(k); i(v); }
  void ku(const char* k, unsigned long v) { key(k); u(v); }
  void kf(const char* k, float v, int dec) { key(k); f(v, dec); }
  void ks(const char* k, const char* v) { key(k); s(v); }
  void kn(const char* k) { key(k); nul(); }
  void kb(const char* k, bool v) { key(k); bl(v); }
  void ko(const char* k) { key(k); obj(); }
  void ka(const char* k) { key(k); arr(); }
  void end() { if (n < cap) b[n] = 0; }
};

static void nodeName(uint8_t k, char* out) { out[0] = 'N'; out[1] = (char)('0' + (k % 10)); out[2] = 0; }

static void jwMacCounters(JW& j, const uint32_t* m) {
  static const char* const K[8] = { "tx", "retx", "ok", "to", "busy", "bo", "col", "def" };
  j.ko("mac");
  for (int i = 0; i < 8; i++) j.ku(K[i], m[i]);
  j.objEnd();
}

// indices of the newest 'maxN' ring entries, ordered by timestamp
static uint8_t ringNewest(uint32_t count, uint8_t maxN, const uint32_t* (*getT)(uint32_t), uint16_t* idx) {
  uint32_t avail = count < (uint32_t)SINK_LOG_N ? count : (uint32_t)SINK_LOG_N;
  uint8_t n = (uint8_t)(avail < maxN ? avail : maxN);
  for (uint8_t i = 0; i < n; i++) idx[i] = (uint16_t)((count - n + i) % SINK_LOG_N);
  for (uint8_t i = 1; i < n; i++) {                 // insertion sort by t (wrap-safe)
    uint16_t v = idx[i];
    int jx = i - 1;
    while (jx >= 0 && (int32_t)(*getT(idx[jx]) - *getT(v)) > 0) { idx[jx + 1] = idx[jx]; jx--; }
    idx[jx + 1] = v;
  }
  return n;
}
static const uint32_t* tMac(uint32_t i) { return &g_sMac[i].t; }
static const uint32_t* tMsg(uint32_t i) { return &g_sMsg[i].t; }
static const uint32_t* tEv(uint32_t i) { return &g_sEv[i].t; }

static void jwNodes(JW& j) {
  char nm[4], ms[18];
  uint32_t now = millis();
  j.ka("nodes");
  for (uint8_t k = 1; k <= 4; k++) {
    SinkNode& r = g_sn[k];
    bool self = (k == NODE_ID);
    nodeName(k, nm);
    j.obj();
    j.ks("id", nm); j.ki("num", k); j.ks("role", NODE_ROLE[k]); j.ks("sensor", NODE_SENSOR[k]); j.ks("unit", NODE_UNIT[k]);
    bool active = self || (r.everHeard && now - r.lastHeardMs <= 3UL * TDMA_SF_MS);
    j.ks("status", active ? "active" : "inactive");
    if (self) j.ki("last_seen_s", 0); else if (r.everHeard) j.ku("last_seen_s", (now - r.lastHeardMs) / 1000); else j.kn("last_seen_s");
    if (self) { macFmt(g_myMac, ms, sizeof(ms)); j.ks("mac_addr", ms); }
    else if (g_nodeMacKnown[k]) { uint8_t m[6]; nodeMacCopy(k, m); macFmt(m, ms, sizeof(ms)); j.ks("mac_addr", ms); }
    else j.kn("mac_addr");
    if (self) j.ku("uptime_s", now / 1000); else if (r.everHeard) j.ku("uptime_s", r.up); else j.kn("uptime_s");
    if (r.hasValue && !self) { j.ki("value", r.value); j.ku("seq", r.seq); j.ku("value_ts", r.valueTs); }
    else { j.kn("value"); j.kn("seq"); j.kn("value_ts"); }
    if ((k == 1 || k == 2) && r.hasTh) j.kb("threshold", r.th != 0); else j.kn("threshold");   // N3 / N4: null
    if (k == 1) { if (r.hasTw) j.ki("temp_warn", r.tw); else j.kn("temp_warn"); }           // N1 only (STAT tw)
    j.ks("route", self ? "4" : r.route);
    if (self) { j.ki("next_hop", 0); j.ki("hops", 0); j.ki("alt_next_hop", 0); j.ki("route_cost", 0); j.ki("alt_cost", 0); }
    else if (r.hasStat2) {
      j.ki("next_hop", r.nh); j.ki("hops", r.h); j.ki("alt_next_hop", r.alt);
      j.ki("route_cost", r.c); j.ki("alt_cost", r.altc == 0xFFFF ? 0 : r.altc);
    } else { j.ki("next_hop", 0); j.ki("hops", 255); j.ki("alt_next_hop", 0); j.ki("route_cost", 0); j.ki("alt_cost", 0); }
    if (r.hasDelay && !self) j.ki("delay_ms", r.delayMs); else j.kn("delay_ms");
    if (!self && g_wifiRssi[k]) j.ki("wifi_rssi", g_wifiRssi[k]); else j.kn("wifi_rssi");
    if (!self && bleValid(k)) j.ki("ble_rssi", bleRssi(k)); else j.kn("ble_rssi");
    j.ku("rx_count", r.rx); j.ki("first_seq", r.firstSeq < 0 ? 0 : r.firstSeq); j.ki("max_seq", r.firstSeq < 0 ? 0 : r.maxSeq);
    j.ku("lost", sinkLost(r));
    if (self) { j.ku("tx_count", 0); j.ku("fwd_count", g_fwdCount); j.ku("oor", g_oorCount); }
    else { j.ku("tx_count", r.tx); j.ku("fwd_count", r.fw); j.ku("oor", r.oor); }
    if (self) {
      uint32_t m[8] = { g_mac.tx, g_mac.retx, g_mac.ok, g_mac.to, g_mac.busy, g_mac.bo, g_mac.col, g_mac.def };
      jwMacCounters(j, m);
    } else jwMacCounters(j, r.mac);
    j.ko("tdma");
    if (self) {
      if (g_isMaster) j.ki("slot", 0); else j.kn("slot");
      j.ku("ver", tdmaVersion()); j.ku("awake_ms", g_awakeMs); j.ku("sleep_ms", g_sleepMs); j.kf("duty", tdmaDuty(), 1);
    } else {
      if (r.hasStat1 && r.tdmaSlot >= 0) j.ki("slot", r.tdmaSlot); else j.kn("slot");
      j.ku("ver", r.tdmaVer); j.ku("awake_ms", r.awake); j.ku("sleep_ms", r.sleep); j.kf("duty", r.duty, 1);
    }
    j.objEnd();
    j.ka("ble");
    for (uint8_t t = 1; t <= 4; t++) {
      if (t == k || !locFresh(k, t)) continue;
      nodeName(t, nm);
      j.obj(); j.ks("id", nm); j.ki("rssi", g_bleMatRssi[k][t]); j.ku("dist_cm", g_bleMatDist[k][t]); j.objEnd();
    }
    j.arrEnd();
    if (g_nearestOf[k]) { nodeName(g_nearestOf[k], nm); j.ks("nearest", nm); } else j.kn("nearest");
    j.ka("events");
    uint8_t ne = r.evN < 4 ? r.evN : 4;
    for (uint8_t e = 0; e < ne; e++) j.s(r.ev[(r.evN - ne + e) % 4]);
    j.arrEnd();
    if (k == 3) {
      j.ko("agg"); j.ku("in", r.agg[0]); j.ku("out", r.agg[1]); j.ku("bi", r.agg[2]); j.ku("bo", r.agg[3]); j.objEnd();
    }
    j.objEnd();
  }
  j.arrEnd();
}

static void jwAggPart(JW& j, const char* key, const LastAggPart& P) {
  if (!P.has) { j.kn(key); return; }
  j.ko(key);
  j.ki("v", P.v); j.ku("q", P.q); j.ku("ts", P.ts); j.ku("cnt", P.cnt); j.ki("mean", P.mean); j.ki("min", P.mn); j.ki("max", P.mx);
  j.ki("th", P.th);
  j.objEnd();
}

static void jwAggregation(JW& j) {
  const LastAgg& L = g_lastAgg;
  j.ko("aggregation");
  if (L.valid) {
    j.ku("window", L.w); j.ku("in", L.in); j.ku("bytes_in", L.bi); j.ku("bytes_out", L.bo); j.kf("reduction_pct", (float)L.red, 1);
    jwAggPart(j, "n1", L.n[1]); jwAggPart(j, "n2", L.n[2]);
    j.ko("n3"); j.ki("v", L.n3v); j.objEnd();
    j.ks("path", L.path); j.ki("delay_ms", L.delayMs);
  } else {
    j.ku("window", g_curSf); j.ki("in", 0); j.ki("bytes_in", 0); j.ki("bytes_out", 0); j.kf("reduction_pct", 0.0f, 1);
    j.kn("n1"); j.kn("n2"); j.kn("n3"); j.ks("path", ""); j.kn("delay_ms");
  }
  const uint32_t* c = g_sn[3].agg;
  j.ko("cum");
  j.ku("in", c[0]); j.ku("out", c[1]); j.ku("bytes_in", c[2]); j.ku("bytes_out", c[3]);
  j.kf("reduction_packets_pct", c[0] ? (float)((int32_t)c[0] - (int32_t)c[1]) * 100.0f / (float)c[0] : 0.0f, 1);
  j.kf("reduction_bytes_pct", c[2] ? (float)((int32_t)c[2] - (int32_t)c[3]) * 100.0f / (float)c[2] : 0.0f, 1);
  j.objEnd();
  j.objEnd();
}

static void jwLocalization(JW& j) {
  char nm[4];
  j.ko("localization");
  j.ko("params"); j.ki("rssi_1m", RSSI_1M); j.kf("n", PATH_LOSS_N, 2); j.objEnd();
  j.ko("positions_true");
  for (uint8_t k = 1; k <= 4; k++) { nodeName(k, nm); j.ka(nm); j.i(NODE_POS[k][0]); j.i(NODE_POS[k][1]); j.arrEnd(); }
  j.objEnd();
  j.ka("matrix");
  for (uint8_t a = 1; a <= 4; a++) for (uint8_t b = 1; b <= 4; b++) {
    if (a == b || !locFresh(a, b)) continue;
    j.obj();
    nodeName(a, nm); j.ks("from", nm); nodeName(b, nm); j.ks("to", nm);
    j.ki("rssi", g_bleMatRssi[a][b]); j.ku("dist_cm", g_bleMatDist[a][b]);
    j.objEnd();
  }
  j.arrEnd();
  j.ka("targets");
  for (uint8_t k = 1; k <= 4; k++) {
    const LocTarget& L = g_loc[k];
    if (!L.valid) continue;
    j.obj();
    nodeName(k, nm); j.ks("id", nm);
    j.ka("est"); j.f(L.ex, 1); j.f(L.ey, 1); j.arrEnd();
    j.ka("true"); j.i(NODE_POS[k][0]); j.i(NODE_POS[k][1]); j.arrEnd();
    j.kf("err_cm", L.err, 1);
    j.ka("anchors");
    for (uint8_t i = 0; i < L.nAnch; i++) { j.obj(); nodeName(L.anch[i], nm); j.ks("id", nm); j.ku("dist_cm", L.anchDist[i]); j.objEnd(); }
    j.arrEnd();
    j.objEnd();
  }
  j.arrEnd();
  j.ko("nearest");
  for (uint8_t k = 1; k <= 4; k++) {
    nodeName(k, nm);
    if (g_nearestOf[k]) { char v[4]; nodeName(g_nearestOf[k], v); j.ks(nm, v); } else j.kn(nm);
  }
  j.objEnd();
  j.objEnd();
}

static void jwLinks(JW& j) {
  char nm[4];
  uint32_t now = millis();
  j.ka("links");
  for (uint8_t a = 1; a <= 4; a++) for (uint8_t b = a + 1; b <= 4; b++) {
    if (!isAllowed(a, b)) continue;
    bool up; int wifi = 0; int ack = 100;
    if (a == NODE_ID || b == NODE_ID) {             // sink's own link: own neighbour table
      uint8_t o = (a == NODE_ID) ? b : a;
      up = g_nb[o].known && g_nb[o].linkUp;
      wifi = g_wifiRssi[o];
      ack = routeAckPct(o);
    } else {                                          // reported by the endpoints' HELLO nb lists
      const NbView& va = g_nbView[a][b];
      const NbView& vb = g_nbView[b][a];
      bool fa = va.ms && now - va.ms <= ROUTE_HELLO_TIMEOUT_MS, fb = vb.ms && now - vb.ms <= ROUTE_HELLO_TIMEOUT_MS;
      up = (fa || fb) && (!fa || va.up) && (!fb || vb.up);
      if (fa && fb) { wifi = (va.wifi + vb.wifi) / 2; ack = (va.ack + vb.ack) / 2; }
      else if (fa) { wifi = va.wifi; ack = va.ack; }
      else if (fb) { wifi = vb.wifi; ack = vb.ack; }
    }
    bool blocked = routePairBlocked(a, b);
    if (blocked) up = false;
    int bleN = 0, bleS = 0;
    if (locFresh(a, b)) { bleS += g_bleMatRssi[a][b]; bleN++; }
    if (locFresh(b, a)) { bleS += g_bleMatRssi[b][a]; bleN++; }
    j.obj();
    nodeName(a, nm); j.ks("a", nm); nodeName(b, nm); j.ks("b", nm);
    j.kb("up", up);
    if (wifi) j.ki("wifi_rssi", wifi); else j.kn("wifi_rssi");
    if (bleN) j.ki("ble_rssi", bleS / bleN); else j.kn("ble_rssi");
    j.kf("ack_pct", (float)ack, 1);
    j.kb("blocked", blocked);
    j.objEnd();
  }
  j.arrEnd();
}

static void jwLogs(JW& j, uint8_t maxN) {
  char nm[4], nm2[4];
  uint16_t idx[60];
  if (maxN > 60) maxN = 60;
  uint8_t n = ringNewest(g_sMacN, maxN, tMac, idx);
  j.ka("mac_log");
  for (uint8_t i = 0; i < n; i++) {
    const SinkMacLog& e = g_sMac[idx[i]];
    nodeName(e.node, nm);
    j.obj(); j.ku("t", e.t); j.ks("node", nm); j.ks("ev", e.ev); j.objEnd();
  }
  j.arrEnd();
  n = ringNewest(g_sMsgN, maxN, tMsg, idx);
  j.ka("msg_log");
  for (uint8_t i = 0; i < n; i++) {
    const SinkMsgLog& e = g_sMsg[idx[i]];
    nodeName(e.from, nm);
    j.obj();
    j.ku("t", e.t); j.ks("type", ftName(e.type)); j.ks("cast", e.bcast ? "broadcast" : "unicast");
    j.ks("from", nm);
    if (e.bcast || e.to == 0) j.ks("to", "all"); else { nodeName(e.to, nm2); j.ks("to", nm2); }
    j.ki("seq", e.seq);
    if (e.acked < 0) j.kn("acked"); else j.kb("acked", e.acked > 0);
    j.ks("path", e.path);
    j.objEnd();
  }
  j.arrEnd();
  n = ringNewest(g_sEvN, maxN, tEv, idx);
  j.ka("events");
  for (uint8_t i = 0; i < n; i++) {
    const SinkEvLog& e = g_sEv[idx[i]];
    nodeName(e.node, nm);
    j.obj(); j.ku("t", e.t); j.ks("node", nm); j.ks("type", EV_NAMES[e.type > (uint8_t)EV_INFO ? (uint8_t)EV_INFO : e.type]); j.ks("msg", e.msg); j.objEnd();
  }
  j.arrEnd();
}

static void jwCounters(JW& j) {
  // bcast: frames seen or sent by the sink; DATA: DATA frames originated by N1+N2 (their STAT.tx);
  // AGG: AGG frames sent by N3 (STAT.agg.out, at least those received); STAT: STAT frames received;
  // ACK: ACKs sent by the sink + ACKs received by every node (STAT.mac.ok).
  uint32_t data = g_sn[1].tx + g_sn[2].tx;
  uint32_t agg = g_sn[3].agg[1] > g_cntAggRx ? g_sn[3].agg[1] : g_cntAggRx;
  uint32_t ack = g_ackTxCount + g_mac.ok + g_sn[1].mac[2] + g_sn[2].mac[2] + g_sn[3].mac[2];
  j.ko("counters");
  j.ko("bcast"); j.ku("HELLO", g_cntBcast[0]); j.ku("SCHED", g_cntBcast[1]); j.ku("CTRL", g_cntBcast[2]); j.objEnd();
  j.ko("ucast"); j.ku("DATA", data); j.ku("AGG", agg); j.ku("STAT", g_cntStatRx); j.ku("ACK", ack); j.objEnd();
  j.objEnd();
}

static void jwContention(JW& j) {
  if (!g_sCt.valid) { j.kn("contention_test"); return; }
  j.ko("contention_test");
  j.ku("at", g_sCt.at);
  for (uint8_t o = 1; o <= 2; o++) {
    char nm[4]; nodeName(o, nm);
    j.ka(nm);
    for (uint8_t i = 0; i < g_sCt.n[o]; i++) j.s(g_sCt.lines[o][i]);
    j.arrEnd();
  }
  j.objEnd();
}

static void jwLight(JW& j) {
  j.ko("light");
  j.ks("state", LIGHT_NAMES[g_lightState]); j.ks("reason", g_lightReason); j.ku("since", g_lightSince);
  j.ko("pins"); j.ki("green", LED_GREEN_PIN); j.ki("red", LED_RED_PIN); j.objEnd();
  j.objEnd();
}

// Build the §9.1 uplink object into g_upBuf. Returns length (0 = overflow).
static size_t sinkBuildUplink(uint8_t logMax) {
  JW j;
  j.begin(g_upBuf, sizeof(g_upBuf));
  char ms[18], ip[16];
  j.obj();
  j.ks("source", "hardware"); j.ks("sink", "N4");
  j.ku("net_time", netNow()); j.ku("sf", g_curSf); j.ku("uptime_s", millis() / 1000);
  j.ki("sched_master", g_sched.valid ? g_sched.master : 0);
  IPAddress a = WiFi.localIP();
  snprintf(ip, sizeof(ip), "%u.%u.%u.%u", a[0], a[1], a[2], a[3]);
  j.ks("sink_ip", ip);
  macFmt(g_myMac, ms, sizeof(ms));
  j.ks("sink_mac", ms);
  j.ki("channel", g_channel);
  jwNodes(j);
  j.ko("schedule");
  j.ku("ver", tdmaVersion()); j.ku("sf", g_curSf); j.ki("slot_ms", TDMA_SLOT_MS);
  j.ka("slots"); for (int i = 0; i < TDMA_SLOTS; i++) j.u(g_sched.a[i]); j.arrEnd();
  j.ku("t0", g_sched.t0); j.ki("master", g_sched.valid ? g_sched.master : 0); j.ks("why", g_sched.why);
  j.ka("history");
  for (uint8_t i = 0; i < g_histN; i++) { j.obj(); j.ku("ver", g_hist[i].ver); j.ks("why", g_hist[i].why); j.ku("t", g_hist[i].t); j.objEnd(); }
  j.arrEnd();
  j.objEnd();
  jwAggregation(j);
  jwLocalization(j);
  jwLight(j);
  jwLinks(j);
  jwLogs(j, logMax);
  jwCounters(j);
  jwContention(j);
  j.objEnd();
  j.end();
  return j.ovf ? 0 : j.n;
}

// ---------------------------------------------------------------------------------------------
// Wi-Fi STA to the laptop hotspot
// ---------------------------------------------------------------------------------------------
void sinkWifiBoot() {
#if !SINK_WIFI_UPLINK
  WiFi.disconnect();
  g_channel = macPickChannel();
  esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
  g_wifiChanLock = true;               // never try the hotspot
  wlogf("WIFI", "SINK_WIFI_UPLINK 0: hotspot not used -> ESP-NOW on channel %d, serial JSON only (serial_bridge.py)", g_channel);
#else
  wlogf("WIFI", "connecting to hotspot '%s' ...", UPLINK_SSID);
  WiFi.setAutoReconnect(true);         // core retries the first (often failing) association during the boot wait
  WiFi.begin(UPLINK_SSID, UPLINK_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < UPLINK_BOOT_WAIT_MS) delay(100);
  // FIX: the core's auto-reconnect re-scans ALL channels forever after a loss, which takes N4's
  // radio off the ESP-NOW channel (N4 goes deaf: no ACKs, no AGG). Reconnects are now done by
  // sinkWifiService() in bounded attempts on the known channel.
  WiFi.setAutoReconnect(false);
  if (WiFi.status() == WL_CONNECTED) {
    g_wifiOk = g_wifiEver = true;
    IPAddress a = WiFi.localIP();
    wlogf("WIFI", "hotspot connected, IP %u.%u.%u.%u, channel %d -> uplink %s", a[0], a[1], a[2], a[3], (int)WiFi.channel(), UPLINK_URL);
  } else {
    WiFi.disconnect();
    g_channel = macPickChannel();
    esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
    g_wifiRetryAt = millis() + UPLINK_RETRY_MS;
    wlogf("WIFI", "hotspot NOT reached -> ESP-NOW on channel %d, serial JSON only, retry every %d s", g_channel, UPLINK_RETRY_MS / 1000);
  }
#endif
#if !SINK_BLE_ENABLE
  esp_wifi_set_ps(WIFI_PS_NONE);       // allowed only because BLE is off on the sink
#endif
}

static void sinkWifiService() {
  if (g_wifiChanLock) return;
  uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    if (!g_wifiOk) {
      uint8_t pch = 0; wifi_second_chan_t sc;
      esp_wifi_get_channel(&pch, &sc);
      WiFi.setAutoReconnect(false);
      g_wifiAttempting = false;
      if (pch && pch != g_channel) {
        // FIX: joining an AP on another channel moves the radio away from N1..N3 (sink isolated)
        WiFi.disconnect();
        esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
        g_wifiChanLock = true;
        wlogf("WIFI", "hotspot is on channel %d but the WSN runs on channel %d -> NOT joining (serial JSON only). "
              "Fix: hotspot on, then reboot all 4 nodes", (int)pch, (int)g_channel);
        return;
      }
      g_wifiOk = g_wifiEver = true;
      IPAddress a = WiFi.localIP();
      wlogf("WIFI", "hotspot (re)connected, IP %u.%u.%u.%u, channel %d", a[0], a[1], a[2], a[3], g_channel);
    }
    return;
  }
  if (g_wifiOk) {
    g_wifiOk = false; g_wifiLostMs = now;
    g_wifiRetryAt = now + 3000;                // FIX: bounded manual reconnect instead of endless core scans
    wlogf("WIFI", "hotspot connection lost -> retry in 3 s (ESP-NOW stays on channel %d)", g_channel);
  }
  if (!g_wifiAttempting && (int32_t)(now - g_wifiRetryAt) >= 0) {
    wlogf("WIFI", "retrying hotspot '%s' (max %d s)", UPLINK_SSID, UPLINK_ATTEMPT_MS / 1000);
    WiFi.setAutoReconnect(true);
    WiFi.begin(UPLINK_SSID, UPLINK_PASS, g_channel);   // scan starts on the WSN channel
    g_wifiAttempting = true;
    g_wifiAttemptStart = now;
  } else if (g_wifiAttempting && now - g_wifiAttemptStart > UPLINK_ATTEMPT_MS) {
    WiFi.setAutoReconnect(false);
    WiFi.disconnect();
    esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
    g_wifiAttempting = false;
    g_wifiRetryAt = now + UPLINK_RETRY_MS;
  }
}

// ---------------------------------------------------------------------------------------------
// Uplink: build -> HTTP POST -> parse reply commands -> stream "JSON:" line on Serial
// ---------------------------------------------------------------------------------------------
static void sinkParseReply(const String& body) {
  JSON_DOC(rd, 2048);
  if (deserializeJson(rd, body)) return;
  JsonArray cmds = rd["commands"].as<JsonArray>();
  for (JsonVariant c : cmds) { JsonObject o = c.as<JsonObject>(); if (!o.isNull()) sinkQueueCommand(o); }
}

static void sinkUplink() {
  if (g_serialJsonBusy) {                     // previous serial line still streaming: terminate it
    Serial.write('\n');
    g_serialJsonBusy = false;                  // held lines drain after the next JSON line (order kept)
  }
  locCompute();
  size_t len = 0;
  for (uint8_t lm = SINK_UPLINK_LOG_MAX; lm >= 5 && !len; lm /= 2) len = sinkBuildUplink(lm);
  g_lastUplinkMs = millis();
  g_uplinkCount++;
  if (!len) { wlogf("SINK", "uplink JSON overflow (buffer %u B)", (unsigned)sizeof(g_upBuf)); return; }
  g_upLen = len;
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    if (http.begin(UPLINK_URL)) {
      http.setConnectTimeout(UPLINK_CONNECT_TIMEOUT_MS);
      http.setTimeout(UPLINK_HTTP_TIMEOUT_MS);
      http.addHeader("Content-Type", "application/json");
      uint32_t t0 = millis();
      int code = http.POST((uint8_t*)g_upBuf, len);
      g_lastHttpCode = code;
      if (code == 200) {
        g_uplinkOk++;
        String body = http.getString();
        sinkParseReply(body);
      }
      http.end();
      wlogf("SINK", "POST %s -> %d (%u B, %lu ms)", UPLINK_URL, code, (unsigned)len, (unsigned long)(millis() - t0));
    }
  } else {
    wlogf("SINK", "uplink %u B (hotspot offline -> serial JSON only)", (unsigned)len);
  }
  locPrint(false);
#if SINK_SERIAL_JSON
  Serial.print("JSON:");
  g_serPos = 0;
  g_serialJsonBusy = true;
#endif
}

static void sinkSerialStream() {
  if (!g_serialJsonBusy) { if (g_holdLen) wlogHoldDrain(); return; }   // FIX: non-blocking drain
  int avail = Serial.availableForWrite() - 256;   // FIX: keep headroom so no write ever blocks
  if (avail <= 0) return;
  size_t rem = g_upLen - g_serPos;
  size_t n = rem < (size_t)avail ? rem : (size_t)avail;
  Serial.write((const uint8_t*)g_upBuf + g_serPos, n);
  g_serPos += n;
  if (g_serPos >= g_upLen) {
    Serial.write('\n');
    g_serialJsonBusy = false;                  // held lines: wlogHoldDrain() on the next calls
  }
}

// "CMD:{...}" lines from serial_bridge.py (or typed into the Serial Monitor)
static char     g_cmdLine[320];
static uint16_t g_cmdLineLen = 0;
static void sinkSerialInput() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (g_cmdLineLen) {
        g_cmdLine[g_cmdLineLen] = 0;
        if (!strncmp(g_cmdLine, "CMD:", 4)) {
          JSON_DOC(cd, 512);
          if (!deserializeJson(cd, (const char*)(g_cmdLine + 4))) sinkQueueCommand(cd.as<JsonObject>());
          else wlogf("CMD", "bad CMD line");
        }
        g_cmdLineLen = 0;
      }
    } else if (g_cmdLineLen < sizeof(g_cmdLine) - 1) {
      g_cmdLine[g_cmdLineLen++] = c;
    }
  }
}

// Quiet slot for the HTTP POST: first slot after N3's AGG slot in which N4 is not needed
int8_t sinkUplinkSlot() {
  if (!g_sched.valid) return -1;
  int8_t agg = tdmaFirstOwned(3, g_sched.a);
  int8_t start = agg > 0 ? agg : 3;
  for (int i = 1; i < TDMA_SLOTS; i++) {
    int8_t s = (int8_t)((start + i) % TDMA_SLOTS);
    if (s == 0) continue;
    uint8_t o = g_sched.a[s];
    if (o == TDMA_UNUSED) return s;
    if (o == TDMA_CONTROL || o == NODE_ID || o == 3) continue;
    if (o <= 4 && g_nb[o].nh == NODE_ID) continue;
    return s;
  }
  return (int8_t)((start + 1) % TDMA_SLOTS);
}
void sinkOnUplinkSlot() { g_uplinkDue = true; }

static void sinkService() {
  lightEvaluate();                               // blink / stale / LIGHT_TEST timing (spec §9.3)
  sinkWifiService();
  if (!g_sched.valid && millis() - g_lastUplinkMs >= TDMA_SF_MS) g_uplinkDue = true;
  if (g_uplinkDue) { g_uplinkDue = false; sinkUplink(); }
  sinkSerialStream();
  sinkSerialInput();
}

void sinkResetStats() {
  for (uint8_t k = 1; k <= 4; k++) { g_sn[k].firstSeq = -1; g_sn[k].maxSeq = 0; g_sn[k].rx = 0; g_sn[k].evN = 0; }
  g_sMacN = g_sMsgN = g_sEvN = 0;
  memset(g_cntBcast, 0, sizeof(g_cntBcast));
  g_cntStatRx = g_cntAggRx = g_cntDataRx = 0;
  memset(&g_sCt, 0, sizeof(g_sCt));
  locReset();
}

static void sinkInit() {
  memset(g_sn, 0, sizeof(g_sn));
  for (uint8_t k = 0; k <= 4; k++) { g_sn[k].firstSeq = -1; g_sn[k].h = 255; g_sn[k].tdmaSlot = -1; }
  memset(&g_lastAgg, 0, sizeof(g_lastAgg));
  memset(&g_sCt, 0, sizeof(g_sCt));
  lightInit();
}

// Periodic sink table (same idea as the reference gateway's node table)
static void sinkPrintTable() {
  wlogf("TABLE", "Node Status    Value  Seq   Rx  Lost  PDR%%   Delay  Route        NH Cost  WiFi  BLE");
  uint32_t now = millis();
  for (uint8_t k = 1; k <= 4; k++) {
    const SinkNode& r = g_sn[k];
    bool self = k == NODE_ID;
    bool active = self || (r.everHeard && now - r.lastHeardMs <= 3UL * TDMA_SF_MS);
    wlogf("TABLE", "N%u   %-8s %6ld %5u %4lu %5lu %6.1f %6ld  %-12s %2u %4u %5d %4d", (unsigned)k, active ? "active" : "inactive",
          r.hasValue ? (long)r.value : -1L, (unsigned)r.seq, (unsigned long)r.rx, (unsigned long)sinkLost(r), (double)sinkPdrPct(r),
          r.hasDelay ? (long)r.delayMs : -1L, self ? "4 (sink)" : r.route, (unsigned)r.nh, (unsigned)r.c,
          self ? 0 : (int)g_wifiRssi[k], self ? 0 : (int)bleRssi(k));
  }
  if (g_lastAgg.valid) {
    const uint32_t* c = g_sn[3].agg;
    wlogf("TABLE", "AGG cum in=%lu out=%lu bytes %lu->%lu | uplinks %lu ok %lu (HTTP %d) | Wi-Fi %s ch %d",
          (unsigned long)c[0], (unsigned long)c[1], (unsigned long)c[2], (unsigned long)c[3], (unsigned long)g_uplinkCount,
          (unsigned long)g_uplinkOk, g_lastHttpCode, g_wifiOk ? "up" : "down", g_channel);
  }
  char tw[16] = "?";
  if (g_sn[1].hasTw) snprintf(tw, sizeof(tw), "%ld.%02ld C", (long)(g_sn[1].tw / 100), (long)(g_sn[1].tw % 100));
  wlogf("TABLE", "status light %s: %s (since net %lu) | N1 hot th=%u (TEMP_WARN %s) N2 turbid th=%u", LIGHT_NAMES[g_lightState],
        g_lightReason, (unsigned long)g_lightSince, (unsigned)g_sn[1].th, tw, (unsigned)g_sn[2].th);
  locPrint(true);
}
