// =============================================================================================
// AquaSense-WSN  -  tdma.h   [G §4.d dynamic scheduling + sleep/wake]
// * Network time sync (offset from SCHED), superframe / slot state machine (6 x 500 ms)
// * Slot ownership -> scheduled transmission jobs (DATA/STAT, AGG, CONTROL, BEACON)
// * Awake/sleep bookkeeping: LED, BLE scan pause, esp_wifi_set_ps hint, optional light sleep
// * Scheduler (N3, backup N4) with the five dynamic update rules + (ver, why) history
// * SCHED build / parse, N2 re-broadcast (r:1)
// =============================================================================================
#pragma once
#include "shared.h"
#include <esp_sleep.h>

// hooks implemented in wsn_node.ino / aggregation.h / sink.h
uint8_t appSendData(uint32_t dl);
uint8_t appRetryData(uint32_t dl);
uint8_t appSendStat(uint8_t part, uint32_t dl);
void    appSendHello(uint32_t dl);
bool    appControlSlotWork(uint32_t dl);
uint8_t aggSendWindow(uint32_t dl);
int8_t  sinkUplinkSlot();
void    sinkOnUplinkSlot();
void    sinkHistAdd(uint16_t ver, const char* why, uint32_t t);

#define TDMA_UNUSED  255
#define TDMA_CONTROL 0

struct Schedule { bool valid; uint16_t ver; uint8_t a[TDMA_SLOTS]; char why[40]; uint8_t master; uint32_t t0; uint32_t sf; };
static Schedule g_sched;
static bool     g_isMaster = false;
static bool     g_takeOverPending = false;     // N3 adopted a backup SCHED and takes over at slot 0
static uint32_t g_lastSchedFromCHMs = 0;       // last SCHED announced by master N3 (N4 backup logic)
static uint32_t g_lastDirectSchedSf = 0xFFFFFFFFUL;
static uint32_t g_bootMs = 0;

// slot state machine
static uint32_t g_curSf = 0;
static int8_t   g_curSlot = -1;
static uint32_t g_slotStartNet = 0;
static bool     g_awake = true;
static uint32_t g_awakeMs = 0, g_sleepMs = 0, g_stateSinceMs = 0;
enum TdmaJob : uint8_t { JOB_NONE = 0, JOB_BEACON, JOB_DATA, JOB_RETX, JOB_AGG, JOB_CONTROL };
static uint8_t  g_job = JOB_NONE, g_jobStage = 0;
static uint32_t g_jobAtNet = 0, g_helloAtNet = 0;
static bool     g_helloDone = true;
static uint32_t g_schedRelayAtMs = 0;          // N2: pending SCHED re-broadcast
static uint32_t g_unsyncHelloMs = 0;
static uint32_t g_unsyncCtrlMs = 0;

// scheduler bookkeeping (members N1, N2)
static uint32_t g_lastHeardMs[5];
static int8_t   g_origSlot[5] = { -1, 1, 2, 3, -1 };
static bool     g_retxSlot[5];
static uint32_t g_statPrevTx[5], g_statPrevRetx[5], g_statPrevTo[5];
static bool     g_statPrevValid[5];
static uint32_t g_winAttempts[5], g_winTo[5];
static uint8_t  g_winSf = 0;
static bool     g_schedUpdateReq = false;
static uint8_t  g_memberNh[5];

uint16_t tdmaVersion() { return g_sched.valid ? g_sched.ver : 0; }
uint32_t tdmaCurrentSf() { return g_curSf; }
int8_t   tdmaCurrentSlot() { return g_curSlot; }
bool     tdmaIsAwake() { return g_awake && !g_killed; }
uint32_t tdmaSlotRemainingMs() {
  if (!g_sched.valid || g_curSlot < 0) return MAC_TX_DEADLINE_MS;
  int32_t r = (int32_t)(g_slotStartNet + TDMA_SLOT_MS - netNow());
  return r > 0 ? (uint32_t)r : 0;
}
void tdmaNoteHeard(uint8_t k) { if (k >= 1 && k <= 4) g_lastHeardMs[k] = millis(); }
static void tdmaNoteMemberNh(uint8_t k, uint8_t nh) { if (k == 1 || k == 2) g_memberNh[k] = nh; }

static int8_t tdmaFirstOwned(uint8_t k, const uint8_t* a) {
  for (int i = 1; i < TDMA_SLOTS; i++) if (a[i] == k) return (int8_t)i;
  return -1;
}
static int8_t tdmaFirstUnused(const uint8_t* a) {
  for (int i = 1; i < TDMA_SLOTS; i++) if (a[i] == TDMA_UNUSED) return (int8_t)i;
  return -1;
}
static void tdmaFmtSlots(const uint8_t* a, char* out, size_t n) {
  int p = snprintf(out, n, "[");
  for (int i = 0; i < TDMA_SLOTS && p < (int)n; i++) p += snprintf(out + p, n - p, "%s%u", i ? "," : "", (unsigned)a[i]);
  if (p < (int)n) snprintf(out + p, n - p, "]");
}

// Default schedule version 1 (spec §5): [master, 1, 2, 3, CONTROL, UNUSED]
static void tdmaDefaultTable(uint8_t* a, uint8_t master) {
  const uint8_t def[6] = { 3, 1, 2, 3, TDMA_CONTROL, TDMA_UNUSED };
  for (int i = 0; i < TDMA_SLOTS; i++) a[i] = (i < 6) ? def[i] : TDMA_UNUSED;
  a[0] = master;
}

// superframe / slot of network time 'now' (floor arithmetic, wrap-safe)
static void tdmaCompute(uint32_t now, uint32_t& sf, uint8_t& slot, uint32_t& slotStart) {
  int64_t el = (int64_t)(int32_t)(now - g_sched.t0);
  int64_t k = (el >= 0) ? el / TDMA_SF_MS : -((-el + TDMA_SF_MS - 1) / TDMA_SF_MS);
  int64_t r = el - k * TDMA_SF_MS;
  sf = (uint32_t)((int64_t)g_sched.sf + k);
  slot = (uint8_t)(r / TDMA_SLOT_MS);
  if (slot >= TDMA_SLOTS) slot = TDMA_SLOTS - 1;
  slotStart = (uint32_t)((int64_t)g_sched.t0 + k * TDMA_SF_MS + (int64_t)slot * TDMA_SLOT_MS);
}

// network time of the start of the next slot with the given owner at or after network time 'from'
static uint32_t tdmaNextSlotStart(uint8_t owner, uint32_t from) {
  if (!g_sched.valid) return from;
  uint32_t sf, ss; uint8_t sl;
  tdmaCompute(from, sf, sl, ss);
  for (int i = 0; i < 2 * TDMA_SLOTS + 1; i++) {
    if (g_sched.a[sl] == owner && (int32_t)(ss - from) >= 0) return ss;
    sl++; ss += TDMA_SLOT_MS;
    if (sl >= TDMA_SLOTS) sl = 0;
  }
  return from;
}

static void tdmaHistLocal(uint16_t ver, const char* why, uint32_t t) { if (IS_SINK) sinkHistAdd(ver, why, t); }

// Apply a new slot table (ver++ and why) - spec §5 "whenever the slot table changes"
static void tdmaSetTable(const uint8_t* na, const char* why) {
  memcpy(g_sched.a, na, TDMA_SLOTS);
  g_sched.ver++;
  strncpy(g_sched.why, why, sizeof(g_sched.why) - 1);
  g_sched.why[sizeof(g_sched.why) - 1] = 0;
  char sl[40];
  tdmaFmtSlots(g_sched.a, sl, sizeof(sl));
  wlogf("SCHED", "UPDATE v%u slots=%s why=\"%s\"", (unsigned)g_sched.ver, sl, g_sched.why);
  nodeEvent(EV_SCHED, "SCHED v%u %s", (unsigned)g_sched.ver, g_sched.why);
  tdmaHistLocal(g_sched.ver, g_sched.why, netNow());
}

static void tdmaBecomeMaster() {
  if (!g_sched.valid) {
    tdmaDefaultTable(g_sched.a, NODE_ID);
    g_sched.ver = 1;
    strncpy(g_sched.why, "initial", sizeof(g_sched.why));
    g_sched.t0 = netNow();
    g_sched.sf = 1;
    g_sched.valid = true;
    g_timeSynced = true;
    g_sched.master = NODE_ID;
    g_isMaster = true;
    char sl[40];
    tdmaFmtSlots(g_sched.a, sl, sizeof(sl));
    wlogf("SCHED", "MASTER N%d: initial schedule v1 slots=%s (slot %d ms, superframe %d ms)", NODE_ID, sl, TDMA_SLOT_MS, TDMA_SF_MS);
    nodeEvent(EV_SCHED, "SCHED v1 initial (master N%d)", NODE_ID);
    tdmaHistLocal(1, "initial", g_sched.t0);
  } else {
    uint8_t na[TDMA_SLOTS];
    memcpy(na, g_sched.a, TDMA_SLOTS);
    na[0] = NODE_ID;
    g_sched.master = NODE_ID;
    g_isMaster = true;
    tdmaSetTable(na, IS_SINK ? "backup master N4" : "master N3 restored");
    wlogf("SCHED", "MASTER N%d takes over the schedule (%s)", NODE_ID, IS_SINK ? "no SCHED from N3 for 3 superframes" : "N3 back");
  }
  for (uint8_t k = 1; k <= 4; k++) g_lastHeardMs[k] = millis();   // grace period
  for (uint8_t k = 1; k <= 2; k++) { int8_t f = tdmaFirstOwned(k, g_sched.a); if (f > 0) g_origSlot[k] = f; }
}

// ---------------------------------------------------------------------------------------------
// [G §4.d] Scheduler: re-plan at the start of every superframe (master only)
// ---------------------------------------------------------------------------------------------
static void tdmaReplan() {
  uint8_t na[TDMA_SLOTS];
  memcpy(na, g_sched.a, TDMA_SLOTS);
  char why[40] = "";
  uint32_t now = millis();
  // Rule 4: dashboard request -> rotate member slots 1<->2
  if (g_schedUpdateReq) {
    g_schedUpdateReq = false;
    for (int i = 1; i < TDMA_SLOTS; i++) { if (na[i] == 1) na[i] = 2; else if (na[i] == 2) na[i] = 1; }
    for (uint8_t k = 1; k <= 2; k++) { int8_t f = tdmaFirstOwned(k, na); if (f > 0) g_origSlot[k] = f; }
    strncpy(why, "dashboard request", sizeof(why));
  }
  for (uint8_t k = 1; k <= 2; k++) {
    bool has = tdmaFirstOwned(k, na) > 0;
    uint32_t agoSf = (now - g_lastHeardMs[k]) / TDMA_SF_MS;
    // Rule 1: member not heard for 3 superframes loses its slot(s)
    if (has && agoSf >= TDMA_LEFT_AFTER_SF) {
      g_origSlot[k] = tdmaFirstOwned(k, na);
      for (int i = 1; i < TDMA_SLOTS; i++) if (na[i] == k) na[i] = TDMA_UNUSED;
      g_retxSlot[k] = false;
      snprintf(why, sizeof(why), "N%u left", (unsigned)k);
    }
    // Rule 2: member heard again gets its slot back (original index, else first UNUSED)
    else if (!has && agoSf < 1) {
      int8_t idx = (g_origSlot[k] > 0 && na[g_origSlot[k]] == TDMA_UNUSED) ? g_origSlot[k] : tdmaFirstUnused(na);
      if (idx > 0) { na[idx] = k; snprintf(why, sizeof(why), "N%u joined", (unsigned)k); }
    }
  }
  // Rule 3: retransmission slot when the member's ACK-timeout ratio is high
  if (++g_winSf >= TDMA_RETX_WINDOW_SF) {
    g_winSf = 0;
    for (uint8_t k = 1; k <= 2; k++) {
      if (tdmaFirstOwned(k, na) < 0 || g_winAttempts[k] < TDMA_RETX_MIN_ATTEMPTS) { g_winAttempts[k] = g_winTo[k] = 0; continue; }
      uint32_t ratio = g_winTo[k] * 100UL / g_winAttempts[k];
      if (!g_retxSlot[k] && ratio > TDMA_RETX_HIGH_PCT) {
        int8_t idx = tdmaFirstUnused(na);
        if (idx > 0) { na[idx] = k; g_retxSlot[k] = true; snprintf(why, sizeof(why), "retx slot for N%u", (unsigned)k); }
      } else if (g_retxSlot[k] && ratio < TDMA_RETX_LOW_PCT) {
        int8_t first = tdmaFirstOwned(k, na);
        for (int i = TDMA_SLOTS - 1; i > first; i--) if (na[i] == k) { na[i] = TDMA_UNUSED; break; }
        g_retxSlot[k] = false;
        strncpy(why, "retx slot released", sizeof(why));
      }
      wlogf("SCHED", "N%u timeout ratio %lu%% (%lu/%lu) over %d SF", (unsigned)k, (unsigned long)ratio,
            (unsigned long)g_winTo[k], (unsigned long)g_winAttempts[k], TDMA_RETX_WINDOW_SF);
      g_winAttempts[k] = g_winTo[k] = 0;
    }
  }
  // Rule 5: member k routes via member j -> j's slot must come after k's slot
  for (uint8_t k = 1; k <= 2; k++) {
    uint8_t j = (uint8_t)(3 - k);
    if (g_memberNh[k] != j) continue;
    int8_t sk = tdmaFirstOwned(k, na), sj = tdmaFirstOwned(j, na);
    if (sk > 0 && sj > 0 && sj < sk) {
      na[sk] = j; na[sj] = k;
      g_origSlot[k] = sj; g_origSlot[j] = sk;
      snprintf(why, sizeof(why), "route change: N%u via N%u", (unsigned)k, (unsigned)j);
    }
  }
  if (memcmp(na, g_sched.a, TDMA_SLOTS) != 0) tdmaSetTable(na, why[0] ? why : "replan");
}

// scheduler input from member STAT frames (pt1: MAC counters, pt2: route)
static void tdmaOnStat(uint8_t o, JsonDocument& doc) {
  if (o != 1 && o != 2) return;
  uint8_t pt = doc["pt"] | 1;
  if (pt == 1) {
    uint32_t tx = doc["mac"]["tx"] | 0, rx = doc["mac"]["retx"] | 0, to = doc["mac"]["to"] | 0;
    if (g_statPrevValid[o] && tx >= g_statPrevTx[o] && rx >= g_statPrevRetx[o] && to >= g_statPrevTo[o]) {
      g_winAttempts[o] += (tx - g_statPrevTx[o]) + (rx - g_statPrevRetx[o]);
      g_winTo[o] += to - g_statPrevTo[o];
    }
    g_statPrevTx[o] = tx; g_statPrevRetx[o] = rx; g_statPrevTo[o] = to; g_statPrevValid[o] = true;
  } else if (pt == 2) {
    if (!doc["rt"].isNull()) tdmaNoteMemberNh(o, doc["rt"]["nh"] | 0);
  }
}

// ---------------------------------------------------------------------------------------------
// SCHED build / send / parse
// ---------------------------------------------------------------------------------------------
static size_t tdmaBuildSched(char* out, size_t cap, bool relay) {
  JSON_DOC(doc, 768);
  doc["t"] = "SCHED"; doc["s"] = NODE_ID; doc["d"] = 0; doc["q"] = ++g_seqBcast; doc["ts"] = netNow();
  doc["sf"] = g_sched.sf; doc["t0"] = g_sched.t0; doc["sl"] = TDMA_SLOT_MS; doc["n"] = TDMA_SLOTS;
  JsonArray a = JSON_ADD_ARR(doc, "a");
  for (int i = 0; i < TDMA_SLOTS; i++) a.add(g_sched.a[i]);
  doc["ver"] = g_sched.ver; doc["why"] = (const char*)g_sched.why; doc["m"] = g_sched.master;
  if (relay) doc["r"] = 1;
  return serializeJson(doc, out, cap);
}

static void tdmaSendSched(bool relay, uint32_t dl) {
  char out[FRAME_MAX + 8];
  size_t n = tdmaBuildSched(out, sizeof(out), relay);
  if (n == 0 || n > FRAME_MAX) return;
  uint8_t r = macSend(out, n, 0, false, FT_SCHED, g_seqBcast, NODE_ID, dl);
  char sl[40];
  tdmaFmtSlots(g_sched.a, sl, sizeof(sl));
  if (r == MAC_OK) {
    wlogf("TX", "SCHED%s bcast sf=%lu v%u slots=%s master=N%u", relay ? " (relay r:1)" : "", (unsigned long)g_sched.sf,
          (unsigned)g_sched.ver, sl, (unsigned)g_sched.master);
    if (IS_SINK) sinkLogMsg(netNow(), FT_SCHED, true, NODE_ID, 0, g_seqBcast, -1, "");
  }
}

static void tdmaOnSched(uint8_t s, JsonDocument& doc, uint32_t rxMs) {
  uint8_t  m   = doc["m"] | s;
  uint8_t  r   = doc["r"] | 0;
  uint16_t ver = doc["ver"] | 0;
  uint32_t sf  = doc["sf"].as<uint32_t>();
  uint32_t t0  = doc["t0"].as<uint32_t>();
  uint32_t ts  = doc["ts"].as<uint32_t>();
  JsonArray a  = doc["a"].as<JsonArray>();
  if (a.isNull() || a.size() != TDMA_SLOTS) return;
  uint8_t na[TDMA_SLOTS];
  for (int i = 0; i < TDMA_SLOTS; i++) na[i] = a[i] | TDMA_UNUSED;
  if (m == 3) g_lastSchedFromCHMs = millis();
  if (g_isMaster) {
    if (IS_SINK && m == 3) {                        // N3 is back: backup N4 yields
      g_isMaster = false;
      wlogf("SCHED", "MASTER N3 is back -> N4 yields (backup off)");
      nodeEvent(EV_SCHED, "MASTER N4 yields to N3");
    } else if (IS_CH && m == 4 && g_killed) {
      // FIX: a killed N3 used to "restore" itself as master on every backup SCHED while still
      // silent (misleading "master N3 restored" lines/events during the kill). Now it follows N4
      // like a member and takes over at the first slot 0 after it wakes (g_takeOverPending below).
      g_isMaster = false;
    } else if (IS_CH && m == 4) {                   // N3 (re)gains mastership over a backup N4
      if (ver >= g_sched.ver) {
        g_sched.ver = ver;
        na[0] = NODE_ID;
        tdmaSetTable(na, "master N3 restored");
      }
      return;
    } else {
      return;
    }
  }
  if (r == 1 && g_lastDirectSchedSf == sf) return;   // relayed copy of a SCHED we already have
  if (r == 0) g_lastDirectSchedSf = sf;
  // [G §4.d] network time sync: offset = sender's network time - local millis at reception
  int32_t newOff = (int32_t)(ts - rxMs);
  int32_t delta = newOff - g_netOffset;
  bool first = !g_timeSynced;
  g_netOffset = newOff;
  g_timeSynced = true;
  if (first || delta > 20 || delta < -20)
    wlogf("TDMA", "SYNC from N%u%s offset=%ld ms (corr %ld ms)", (unsigned)s, r ? " (relay)" : "", (long)newOff, first ? 0L : (long)delta);
  bool changed = !g_sched.valid || ver != g_sched.ver || memcmp(na, g_sched.a, TDMA_SLOTS) != 0 || m != g_sched.master;
  memcpy(g_sched.a, na, TDMA_SLOTS);
  g_sched.ver = ver;
  strncpy(g_sched.why, doc["why"] | "", sizeof(g_sched.why) - 1);
  g_sched.why[sizeof(g_sched.why) - 1] = 0;
  g_sched.master = m;
  g_sched.t0 = t0;
  g_sched.sf = sf;
  g_sched.valid = true;
  if (changed) {
    char sl[40];
    tdmaFmtSlots(na, sl, sizeof(sl));
    wlogf("SCHED", "RX v%u slots=%s master=N%u why=\"%s\"", (unsigned)ver, sl, (unsigned)m, g_sched.why);
    nodeEvent(EV_SCHED, "SCHED v%u %s", (unsigned)ver, g_sched.why);
    tdmaHistLocal(ver, g_sched.why, ts);
  }
  if (NODE_ID == 2 && r == 0) g_schedRelayAtMs = rxMs + TDMA_SCHED_RELAY_MS;   // N2 re-broadcasts once
  if (IS_CH && !g_isMaster) g_takeOverPending = true;                        // N3 heard a backup SCHED
}

// ---------------------------------------------------------------------------------------------
// Sleep / wake
// ---------------------------------------------------------------------------------------------
static bool tdmaShouldBeAwake(uint8_t slot) {
  if (g_killed) return false;
  uint8_t owner = g_sched.a[slot];
  if (owner == TDMA_UNUSED) return false;                     // UNUSED -> everyone sleeps
  if (IS_CH || IS_SINK) return true;                          // mains/USB powered
  if (slot == 0 || owner == TDMA_CONTROL || owner == NODE_ID) return true;
  if (owner >= 1 && owner <= 4 && g_nb[owner].known && g_nb[owner].nh == NODE_ID) return true;   // listen for a child
  return false;
}

static void tdmaAccount(uint32_t nowMs) {
  uint32_t d = nowMs - g_stateSinceMs;
  if (g_awake) g_awakeMs += d; else g_sleepMs += d;
  g_stateSinceMs = nowMs;
}

static void tdmaApplyPower(bool awake) {
  digitalWrite(LED_PIN, awake ? HIGH : LOW);
  // modem-sleep hint (MIN when awake: WIFI_PS_NONE is not allowed while BLE is enabled)
  if (!IS_SINK) esp_wifi_set_ps(awake ? WIFI_PS_MIN_MODEM : WIFI_PS_MAX_MODEM);
}

static float tdmaDuty() {
  uint32_t a = g_awakeMs, s = g_sleepMs;
  return (a + s) ? (float)a * 100.0f / (float)(a + s) : 100.0f;
}

void tdmaGrace() { for (uint8_t k = 1; k <= 4; k++) g_lastHeardMs[k] = millis(); }

void tdmaResetStats() {
  g_awakeMs = g_sleepMs = 0;
  g_stateSinceMs = millis();
  for (uint8_t k = 0; k < 5; k++) { g_statPrevValid[k] = false; g_winAttempts[k] = g_winTo[k] = 0; }
}

// ---------------------------------------------------------------------------------------------
// Slot start: accounting, awake/sleep decision, job for this slot
// ---------------------------------------------------------------------------------------------
static void tdmaOnSlotStart(uint32_t sf, uint8_t slot, uint32_t slotStart) {
  tdmaAccount(millis());
  g_curSf = sf;
  g_curSlot = (int8_t)slot;
  g_slotStartNet = slotStart;
  if (slot == 0) {
    if (IS_CH && !g_isMaster && g_takeOverPending && !g_killed) { g_takeOverPending = false; tdmaBecomeMaster(); }   // FIX: not while killed
    if (g_isMaster) { g_sched.t0 = slotStart; g_sched.sf = sf; if (!g_killed) tdmaReplan(); }
  }
  uint8_t owner = g_sched.a[slot];
  bool awake = tdmaShouldBeAwake(slot);
  if (awake != g_awake) {
    g_awake = awake;
    tdmaApplyPower(awake);
    if (!IS_SINK && !IS_CH) wlogf("TDMA", "sf=%lu slot %u -> %s", (unsigned long)sf, (unsigned)slot, awake ? "WAKE (radio+BLE on, LED on)" : "SLEEP (no TX, BLE paused, LED off)");
  }
  g_job = JOB_NONE;
  g_jobStage = 0;
  uint32_t guard = (uint32_t)random(0, TDMA_GUARD_MS + 1);
  if (slot == 0) {
    if (g_isMaster && !g_killed) { g_job = JOB_BEACON; g_jobAtNet = slotStart + guard; }
  } else if (owner == TDMA_CONTROL) {
    g_job = JOB_CONTROL;
    g_jobAtNet = slotStart + TDMA_CTRL_OFFSET_MS;
    g_helloDone = false;
    g_helloAtNet = slotStart + (g_helloUrgent ? (uint32_t)TDMA_HELLO_URGENT_MS + guard
                                              : (uint32_t)random(TDMA_HELLO_MIN_MS, TDMA_HELLO_MAX_MS + 1));
    sensorsService();                          // sensor housekeeping, < 1 ms (no unicast expected now)
  } else if (owner == NODE_ID && !g_killed) {
    int8_t first = tdmaFirstOwned(NODE_ID, g_sched.a);
    if (IS_CH) g_job = ((int8_t)slot == first) ? JOB_AGG : JOB_RETX;
    else if (IS_MEMBER) g_job = ((int8_t)slot == first) ? JOB_DATA : JOB_RETX;
    g_jobAtNet = slotStart + guard;
    wlogf("TDMA", "sf=%lu slot %u OWN (v%u) -> %s at +%lums", (unsigned long)sf, (unsigned)slot, (unsigned)g_sched.ver,
          g_job == JOB_AGG ? "AGG+STAT" : g_job == JOB_DATA ? "DATA+STAT" : "RETX/forward", (unsigned long)guard);
  }
  if (IS_SINK && (int8_t)slot == sinkUplinkSlot()) sinkOnUplinkSlot();
#if USE_LIGHT_SLEEP
  if (!awake && IS_MEMBER) {
    int32_t remain = (int32_t)(slotStart + TDMA_SLOT_MS - netNow()) - 5;
    if (remain > 20) {
      esp_sleep_enable_timer_wakeup((uint64_t)remain * 1000ULL);
      esp_light_sleep_start();
    }
  }
#endif
}

// Execute (one step of) the job of the current slot. Called from loop().
static void tdmaRunJob() {
  if (g_job == JOB_NONE || g_killed) return;
  uint32_t now = netNow();
  int32_t rem = (int32_t)(g_slotStartNet + TDMA_SLOT_MS - now);
  if (rem <= (int32_t)(MAC_SLOT_END_MARGIN_MS + 10)) { g_job = JOB_NONE; return; }
  uint32_t dl = wMinU(MAC_TX_DEADLINE_MS, (uint32_t)(rem - MAC_SLOT_END_MARGIN_MS));
  if ((int32_t)(now - g_jobAtNet) < 0 && g_job != JOB_CONTROL) return;
  switch (g_job) {
    case JOB_BEACON:
      tdmaSendSched(false, dl);
      g_job = JOB_NONE;
      break;
    case JOB_CONTROL:
      if ((int32_t)(now - g_jobAtNet) >= 0) appControlSlotWork(dl);
      if (!g_helloDone && (int32_t)(now - g_helloAtNet) >= 0) {
        appSendHello(dl);
        g_helloDone = true;
        g_helloUrgent = false;
      }
      break;
    case JOB_DATA:
    case JOB_AGG:
    case JOB_RETX:
      if (g_jobStage == 0) {
        if (g_job == JOB_DATA) appSendData(dl);
        else if (g_job == JOB_AGG) aggSendWindow(dl);
        else appRetryData(dl);
        g_jobStage = (g_job == JOB_RETX) ? 5 : 1;
      } else if (g_jobStage <= 4) {
        appSendStat(g_jobStage, dl);           // STAT parts 1..4 (part 3/4 only when pending)
        g_jobStage++;
      } else if (!routeForwardOne(dl)) {
        g_job = JOB_NONE;                      // forwarding queue empty
      }
      break;
    default:
      g_job = JOB_NONE;
  }
}

// Main TDMA service from loop()
static void tdmaService() {
  uint32_t nowMs = millis();
  if (!g_sched.valid) {
    // not synchronised yet: stay awake, announce ourselves with HELLO once per superframe
    if (IS_CH && nowMs - g_bootMs >= TDMA_BOOT_LISTEN_MS) tdmaBecomeMaster();
    if (IS_SINK && nowMs - g_bootMs >= (uint32_t)TDMA_BACKUP_AFTER_SF * TDMA_SF_MS) tdmaBecomeMaster();
    if (!g_sched.valid) {
      if (!g_awake) { g_awake = true; tdmaApplyPower(true); }
      if ((int32_t)(nowMs - g_unsyncHelloMs) >= 0 && !g_killed) {
        appSendHello(MAC_TX_DEADLINE_MS);
        g_unsyncHelloMs = nowMs + TDMA_SF_MS + (uint32_t)random(0, 500);
      }
      if (IS_SINK && (int32_t)(nowMs - g_unsyncCtrlMs) >= 0) { appControlSlotWork(MAC_TX_DEADLINE_MS); g_unsyncCtrlMs = nowMs + 200; }
      return;
    }
  }
  // [G §4.d] backup scheduler: N4 takes over when N3's SCHED is missing for 3 superframes
  if (IS_SINK && !g_isMaster && nowMs - g_lastSchedFromCHMs > (uint32_t)TDMA_BACKUP_AFTER_SF * TDMA_SF_MS &&
      nowMs - g_bootMs > (uint32_t)TDMA_BACKUP_AFTER_SF * TDMA_SF_MS) {
    tdmaBecomeMaster();
  }
  uint32_t sf, ss;
  uint8_t slot;
  tdmaCompute(netNow(), sf, slot, ss);
  if (sf != g_curSf || (int8_t)slot != g_curSlot) tdmaOnSlotStart(sf, slot, ss);
  tdmaRunJob();
  // N2: re-broadcast the SCHED once at +60 ms (r:1) so N1 hears a backup N4 too
  if (NODE_ID == 2 && g_schedRelayAtMs && (int32_t)(nowMs - g_schedRelayAtMs) >= 0) {
    g_schedRelayAtMs = 0;
    if (!g_killed) tdmaSendSched(true, wMinU(MAC_TX_DEADLINE_MS, tdmaSlotRemainingMs() > MAC_SLOT_END_MARGIN_MS ? tdmaSlotRemainingMs() - MAC_SLOT_END_MARGIN_MS : 30));
  }
}

static void tdmaInit() {
  memset(&g_sched, 0, sizeof(g_sched));
  g_bootMs = millis();
  g_stateSinceMs = millis();
  g_lastSchedFromCHMs = millis();
  g_unsyncHelloMs = millis() + (uint32_t)random(300, 1200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  wlogf("TDMA", "superframe %d x %d ms; %s", TDMA_SLOTS, TDMA_SLOT_MS,
        IS_CH ? "scheduler (listening for an existing SCHED first)" : IS_SINK ? "backup scheduler, waiting for SCHED" : "waiting for SCHED");
}
