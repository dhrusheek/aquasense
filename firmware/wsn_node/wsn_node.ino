// =============================================================================================
// AquaSense-WSN  -  wsn_node.ino
// 23CSE341 Wireless Sensor Networks - Lab Evaluation 2
// Hybrid BLE + Wi-Fi (ESP-NOW) WSN on 4 x ESP32: BLE localization, CSMA/CA MAC with ACK and
// retransmission, dynamic TDMA with sleep/wake, aggregation at the cluster head, adaptive
// multi-hop routing with failure recovery, sink uplink to the dashboard.
// Sensing (spec §1.2): N1 ESP32 on-chip temperature with the TEMP_WARN over-temperature flag,
// N2 turbidity module (ADC + LM393 comparator flag), N3 ESP32 on-chip temperature, N4 three-LED
// pond status light (§9.3).
//
// ONE sketch for all four boards: set NODE_ID in config.h (1..4) and flash each board.
// Contract: docs/PROTOCOL_SPEC.md. Guideline references: [G §x].
// =============================================================================================
#include "config.h"
#include "shared.h"
#include "sensors.h"
#include "ble_loc.h"
#include "mac.h"
#include "routing.h"
#include "tdma.h"
#include "aggregation.h"
#include "sink.h"

// ---------------------------------------------------------------------------------------------
// State owned by the application layer
// ---------------------------------------------------------------------------------------------
static JSON_DOC(g_rxDoc, 1536);         // parse buffer for received frames (loop context only)
static RxItem   g_rxItem;
static bool     g_inRx = false;
static uint32_t g_rxBad = 0;

// own DATA that failed: retried in a retransmission slot (rule 3) with the same seq/ts
static bool     g_retryPending = false;
static uint16_t g_retryQ = 0;
static int32_t  g_retryV = 0;
static uint8_t  g_retryTh = 0;
static uint32_t g_retryTs = 0;

// CTRL dedupe (by id) and relay queue (N2 and N3 relay once)
static uint32_t g_ctrlSeen[12];
static uint8_t  g_ctrlSeenN = 0;
static WsnCmd   g_ctrlRelay[4];
static uint8_t  g_ctrlRelayN = 0;

static uint32_t g_tableMs = 0;

// ---------------------------------------------------------------------------------------------
// Statistics reset (CTRL RESET_STATS)
// ---------------------------------------------------------------------------------------------
static void resetAllStats() {
  macResetCounters();
  routeResetStats();
  tdmaResetStats();
  aggResetStats();
  sensorsResetDefaults();          // N1: TEMP_WARN back to TEMP_WARN_C100 (spec §1.2)
  g_txDataCount = 0;
  if (IS_SINK) sinkResetStats();
}

// ---------------------------------------------------------------------------------------------
// [G §4.c] CTRL: network-control messages (dashboard -> N4 -> broadcast, relayed by N3 / N2)
// ---------------------------------------------------------------------------------------------
static bool ctrlSeen(uint32_t id) {
  for (uint8_t i = 0; i < g_ctrlSeenN; i++) if (g_ctrlSeen[i] == id) return true;
  return false;
}
static void ctrlRemember(uint32_t id) {
  if (ctrlSeen(id)) return;
  if (g_ctrlSeenN >= 12) { memmove(&g_ctrlSeen[0], &g_ctrlSeen[1], sizeof(uint32_t) * 11); g_ctrlSeenN = 11; }
  g_ctrlSeen[g_ctrlSeenN++] = id;
}

void ctrlExecute(const WsnCmd& c) {
  ctrlRemember(c.id);
  bool involved = (c.a == NODE_ID || c.b == NODE_ID);
  if (!strcmp(c.c, "LINK_FAIL")) {
    uint32_t dur = c.dur ? c.dur : ROUTE_LINK_FAIL_DEFAULT_S;
    routeBlockPair(c.a, c.b, dur);                      // every node remembers the pair (sink: links[].blocked)
    if (involved) {
      wlogf("CTRL", "LINK_FAIL N%u-N%u for %lu s: dropping each other's frames (no ACK) -> watch MAC timeouts",
            (unsigned)c.a, (unsigned)c.b, (unsigned long)dur);
      nodeEvent(EV_CTRL, "LINK_FAIL N%u-N%u %lus", (unsigned)c.a, (unsigned)c.b, (unsigned long)dur);
    }
  } else if (!strcmp(c.c, "LINK_RESTORE")) {
    routeUnblockPair(c.a, c.b);
    if (involved) {
      wlogf("CTRL", "LINK_RESTORE N%u-N%u: frames accepted again, waiting for HELLOs", (unsigned)c.a, (unsigned)c.b);
      nodeEvent(EV_CTRL, "LINK_RESTORE N%u-N%u", (unsigned)c.a, (unsigned)c.b);
    }
  } else if (!strcmp(c.c, "CONTENTION_TEST")) {
    if (NODE_ID == 1 || NODE_ID == 2) {
      g_ctArmedAt = c.at ? c.at : netNow() + TDMA_CT_LEAD_MS;
      g_ctAt = g_ctArmedAt;
      wlogf("CTRL", "CONTENTION_TEST armed: DATA to N3 at net time %lu (in %ld ms)", (unsigned long)g_ctArmedAt,
            (long)(int32_t)(g_ctArmedAt - netNow()));
    } else {
      wlogf("CTRL", "CONTENTION_TEST at net time %lu (N1 and N2 transmit together)", (unsigned long)c.at);
    }
    nodeEvent(EV_CTRL, "CONTENTION_TEST at %lu", (unsigned long)c.at);
  } else if (!strcmp(c.c, "SCHED_UPDATE")) {
    if (g_isMaster) {
      g_schedUpdateReq = true;
      wlogf("CTRL", "SCHED_UPDATE: member slots will rotate at the next superframe");
    }
  } else if (!strcmp(c.c, "RESET_STATS")) {
    resetAllStats();
    if (NODE_ID == 1)
      wlogf("CTRL", "RESET_STATS: counters cleared, TEMP_WARN back to %ld.%02ld C", (long)(g_tempWarn / 100), (long)(g_tempWarn % 100));
    else
      wlogf("CTRL", "RESET_STATS: counters cleared");
    nodeEvent(EV_CTRL, "RESET_STATS");
  } else if (!strcmp(c.c, "NODE_KILL")) {
    if (c.a == NODE_ID && !IS_SINK) {
      uint32_t dur = c.dur ? c.dur : NODE_KILL_DEFAULT_S;
      nodeEvent(EV_CTRL, "KILL N%d %lus", NODE_ID, (unsigned long)dur);
      g_killed = true;
      g_killUntilMs = millis() + dur * 1000UL;
      digitalWrite(LED_PIN, LOW);
      wlogf("CTRL", "NODE_KILL: this node is silent for %lu s (no TX, no ACK, no relay)", (unsigned long)dur);
    }
  } else if (!strcmp(c.c, "NODE_WAKE")) {
    if (c.a == NODE_ID && g_killed) {
      g_killed = false;
      tdmaGrace();
      wlogf("CTRL", "NODE_WAKE: transmitting again");
      nodeEvent(EV_CTRL, "WAKE N%d", NODE_ID);
    }
  } else if (!strcmp(c.c, "TEMP_WARN")) {
    // spec §9.1: N1 stores v (degC x100, 0..15000) as its over-temperature threshold and reports
    // it back in STAT pt3 `tw`; the other nodes only relay the CTRL (N2 / N3) or ignore it.
    if (NODE_ID == 1 && c.a == 1) {
      if (c.v == CMD_V_NONE) {
        wlogf("CTRL", "TEMP_WARN without v ignored (still %ld.%02ld C)", (long)(g_tempWarn / 100), (long)(g_tempWarn % 100));
      } else {
        int32_t was = g_tempWarn;
        g_tempWarn = c.v < 0 ? 0 : (c.v > TEMP_WARN_MAX_C100 ? TEMP_WARN_MAX_C100 : c.v);
        wlogf("CTRL", "TEMP_WARN %ld.%02ld C (was %ld.%02ld C)", (long)(g_tempWarn / 100), (long)(g_tempWarn % 100),
              (long)(was / 100), (long)(was % 100));
        nodeEvent(EV_CTRL, "TEMP_WARN %ld.%02ld C", (long)(g_tempWarn / 100), (long)(g_tempWarn % 100));
      }
    }
  } else if (!strcmp(c.c, "LIGHT_TEST")) {
    if (IS_SINK) sinkLightTest("CTRL");              // normally handled locally on N4, never broadcast
  } else {
    wlogf("CTRL", "unknown command '%s'", c.c);
  }
}

static void ctrlOnFrame(uint8_t s, JsonDocument& doc) {
  uint32_t id = doc["id"] | 0;
  if (ctrlSeen(id)) return;
  WsnCmd c;
  memset(&c, 0, sizeof(c));
  strncpy(c.c, doc["c"] | "", sizeof(c.c) - 1);
  c.a = doc["a"] | 0; c.b = doc["b"] | 0; c.dur = doc["dur"] | 0; c.at = doc["at"].as<uint32_t>(); c.id = id;
  c.v = doc["v"].isNull() ? CMD_V_NONE : doc["v"].as<int32_t>();     // spec §3 CTRL v (only TEMP_WARN)
  uint8_t r = doc["r"] | 0;
  char vs[16] = "";
  if (c.v != CMD_V_NONE) snprintf(vs, sizeof(vs), " v=%ld", (long)c.v);
  wlogf("CTRL", "RX %s a=%u b=%u dur=%u%s id=%lu from N%u%s", c.c, (unsigned)c.a, (unsigned)c.b, (unsigned)c.dur, vs,
        (unsigned long)id, (unsigned)s, r ? " (relayed)" : "");
  if ((NODE_ID == 2 || NODE_ID == 3) && !g_killed && g_ctrlRelayN < 4) g_ctrlRelay[g_ctrlRelayN++] = c;
  ctrlExecute(c);
}

// CONTROL slot work: N4 sends queued commands, N2/N3 relay CTRL once. One frame per call.
bool appControlSlotWork(uint32_t dl) {
  if (g_killed) return false;
  if (IS_SINK && sinkSendCommand(dl)) return true;
  if (g_ctrlRelayN) {
    WsnCmd c = g_ctrlRelay[0];
    memmove(&g_ctrlRelay[0], &g_ctrlRelay[1], sizeof(WsnCmd) * 3);
    g_ctrlRelayN--;
    char out[FRAME_MAX + 8];
    size_t n = ctrlBuild(out, sizeof(out), c, true);
    if (macSend(out, n, 0, false, FT_CTRL, g_seqBcast, NODE_ID, dl) == MAC_OK)
      wlogf("TX", "CTRL %s id=%lu relayed (bcast r:1)", c.c, (unsigned long)c.id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// [G §4.c] HELLO broadcast (CONTROL slot, contention)
// ---------------------------------------------------------------------------------------------
void appSendHello(uint32_t dl) {
  if (g_killed) return;
  char out[FRAME_MAX + 8];
  size_t n = routeBuildHello(out, sizeof(out));
  if (n == 0 || n > FRAME_MAX) return;
  uint16_t q = g_seqBcast;
  uint8_t r = macSend(out, n, 0, false, FT_HELLO, q, NODE_ID, dl);
  if (r == MAC_OK) {
    wlogf("TX", "HELLO bcast h=%u nh=N%u c=%u ver=%u", (unsigned)g_hops, (unsigned)g_nextHop,
          g_routeCost == 0xFFFF ? 0 : (unsigned)g_routeCost, (unsigned)tdmaVersion());
    if (IS_SINK) sinkLogMsg(netNow(), FT_HELLO, true, NODE_ID, 0, q, -1, "");
  }
}

// ---------------------------------------------------------------------------------------------
// [G §4.c unicast / §4.d scheduled transmission] DATA in the node's own slot
// ---------------------------------------------------------------------------------------------
static size_t buildData(char* out, size_t cap, uint8_t nh, uint16_t q, int32_t v, uint8_t th, uint32_t ts, const char* u, uint8_t ttl) {
  JSON_DOC(doc, 512);
  char p[4];
  snprintf(p, sizeof(p), "%d", NODE_ID);
  doc["t"] = "DATA"; doc["s"] = NODE_ID; doc["d"] = nh; doc["q"] = q; doc["ts"] = ts;
  doc["o"] = NODE_ID; doc["v"] = v; doc["u"] = u; doc["th"] = th; doc["p"] = p; doc["hop"] = 1; doc["ttl"] = ttl;
  return serializeJson(doc, out, cap);
}

uint8_t appSendData(uint32_t dl) {
  if (!IS_MEMBER) return 255;
  uint8_t nh = routeNextHop();
  int32_t v = readSensor();
  uint8_t th = readThreshold();                       // N1: v >= TEMP_WARN, N2: comparator D (spec §1.2)
  uint16_t q = ++g_seqData;
  uint32_t ts = netNow();
  if (!nh) {
    wlogf("TX", "DATA seq=%u v=%ld th=%u NOT sent: no route to sink", (unsigned)q, (long)v, (unsigned)th);
    return MAC_ABORT;
  }
  char out[FRAME_MAX + 8];
  size_t n = buildData(out, sizeof(out), nh, q, v, th, ts, sensorUnitCode(), ROUTE_DATA_TTL);
  uint8_t r = macSend(out, n, nh, true, FT_DATA, q, NODE_ID, dl);
  if (r != MAC_ABORT) g_txDataCount++;
  if (r == MAC_OK) {
    g_retryPending = false;
    wlogf("TX", "DATA seq=%u v=%ld %s th=%u -> N%u (ACK ok, %u retx) %u B", (unsigned)q, (long)v, sensorUnitCode(), (unsigned)th,
          (unsigned)nh, (unsigned)g_macLastRetries, (unsigned)n);
  } else {
    wlogf("TX", "DATA seq=%u v=%ld th=%u -> N%u FAILED (%s)", (unsigned)q, (long)v, (unsigned)th, (unsigned)nh,
          r == MAC_FAIL ? "no ACK after retries" : "aborted");
    g_retryPending = true; g_retryQ = q; g_retryV = v; g_retryTh = th; g_retryTs = ts;
  }
  return r;
}

// retransmission slot (rule 3): resend the DATA that failed in the primary slot
uint8_t appRetryData(uint32_t dl) {
  if (!g_retryPending || !IS_MEMBER) return 255;
  uint8_t nh = routeNextHop();
  if (!nh) return MAC_ABORT;
  char out[FRAME_MAX + 8];
  size_t n = buildData(out, sizeof(out), nh, g_retryQ, g_retryV, g_retryTh, g_retryTs, sensorUnitCode(), ROUTE_DATA_TTL);
  uint8_t r = macSend(out, n, nh, true, FT_DATA, g_retryQ, NODE_ID, dl);
  wlogf("TX", "DATA seq=%u RETX-SLOT -> N%u %s", (unsigned)g_retryQ, (unsigned)nh, r == MAC_OK ? "(ACK ok)" : "FAILED");
  g_retryPending = false;
  return r;
}

// ---------------------------------------------------------------------------------------------
// STAT (per-node counters for the dashboard), split in parts to respect the 250-byte limit:
//   pt1 mac + tdma                    pt2 rt + ble + near (+agg on N3)
//   pt3 tx/fw/oor/up (+tw on N1) + ev + me (recent MAC events, filler)   pt4 contention timeline (cta + ev)
// ---------------------------------------------------------------------------------------------
uint8_t appSendStat(uint8_t part, uint32_t dl) {
  uint8_t nh = routeNextHop();
  if (!nh || !g_timeSynced) return 255;
  if (part == 4 && !g_ctReady) return 255;
  uint32_t evAvail = g_nodeEvCount - g_nodeEvShipped;
  if (g_macEvtCount - g_macEvtShipped > MAC_EVT_RING) g_macEvtShipped = g_macEvtCount - MAC_EVT_RING;
  uint32_t meAvail = g_macEvtCount - g_macEvtShipped;
  (void)evAvail; (void)meAvail;
  JSON_DOC(doc, 1024);
  uint16_t q = (uint16_t)(g_seqStat + 1);
  doc["t"] = "STAT"; doc["s"] = NODE_ID; doc["d"] = nh; doc["q"] = q; doc["ts"] = netNow();
  doc["o"] = NODE_ID; doc["pt"] = part;
  uint32_t evShip = 0, meShipTo = g_macEvtShipped;
  if (part == 1) {
    JsonObject m = JSON_ADD_OBJ(doc, "mac");
    m["tx"] = g_mac.tx; m["retx"] = g_mac.retx; m["ok"] = g_mac.ok; m["to"] = g_mac.to;
    m["busy"] = g_mac.busy; m["bo"] = g_mac.bo; m["col"] = g_mac.col; m["def"] = g_mac.def;
    JsonObject t = JSON_ADD_OBJ(doc, "tdma");
    tdmaAccount(millis());
    t["slot"] = tdmaFirstOwned(NODE_ID, g_sched.a); t["ver"] = tdmaVersion();
    t["awake"] = g_awakeMs; t["sleep"] = g_sleepMs; t["duty"] = roundf(tdmaDuty() * 10.0f) / 10.0f;
  } else if (part == 2) {
    JsonObject rt = JSON_ADD_OBJ(doc, "rt");
    rt["nh"] = g_nextHop; rt["h"] = g_hops; rt["c"] = g_routeCost == 0xFFFF ? 0 : g_routeCost;
    rt["alt"] = g_altHop; rt["altc"] = g_altCost == 0xFFFF ? 0 : g_altCost;
    JsonArray b = JSON_ADD_ARR(doc, "ble");
    for (uint8_t k = 1; k <= 4; k++) {
      if (!bleValid(k)) continue;
      JsonArray e = JSON_ARR_ADD_ARR(b);
      e.add(k); e.add((int)bleRssi(k)); e.add((unsigned)bleDistCm(k));
    }
    doc["near"] = bleNearest();
    if (IS_CH) {
      JsonObject a = JSON_ADD_OBJ(doc, "agg");
      a["in"] = g_aggCumIn; a["out"] = g_aggCumOut; a["bi"] = g_aggCumBi; a["bo"] = g_aggCumBo;
    }
  } else if (part == 3) {
    doc["tx"] = g_txDataCount; doc["fw"] = g_fwdCount; doc["oor"] = g_oorCount; doc["up"] = millis() / 1000;
    if (NODE_ID == 1) doc["tw"] = g_tempWarn;            // current TEMP_WARN (degC x100, spec §3 STAT tw)
    JsonArray ev = JSON_ADD_ARR(doc, "ev");
    for (uint32_t i = g_nodeEvShipped; i < g_nodeEvCount && evShip < 4; i++) {
      ev.add((const char*)g_nodeEv[i % NODE_EV_RING].msg);
      if (measureJson(doc) > FRAME_MAX) { ev.remove(ev.size() - 1); break; }
      evShip++;
    }
    JsonArray me = JSON_ADD_ARR(doc, "me");
    uint32_t from = g_macEvtCount > g_macEvtShipped + 4 ? g_macEvtCount - 4 : g_macEvtShipped;   // newest <= 4
    uint32_t nowNet = netNow();
    for (uint32_t i = from; i < g_macEvtCount; i++) {
      const MacEvt& e = g_macEvt[i % MAC_EVT_RING];
      JsonArray r = JSON_ARR_ADD_ARR(me);
      r.add((uint32_t)(nowNet - e.net)); r.add((const char*)e.ev);
      if (measureJson(doc) > FRAME_MAX) { me.remove(me.size() - 1); break; }
      meShipTo = i + 1;
    }
  } else if (part == 4) {
    doc["cta"] = g_ctAt;
    JsonArray ev = JSON_ADD_ARR(doc, "ev");
    for (uint8_t i = 0; i < g_ctN; i++) {
      ev.add((const char*)g_ctLines[i]);
      if (measureJson(doc) > FRAME_MAX) { ev.remove(ev.size() - 1); break; }
    }
  } else {
    return 255;
  }
  char out[FRAME_MAX + 8];
  size_t n = serializeJson(doc, out, sizeof(out));
  if (n == 0 || n > FRAME_MAX) { wlogf("TX", "STAT pt%u too large (%u B)", (unsigned)part, (unsigned)n); return MAC_ABORT; }
  g_seqStat = q;
  uint8_t r = macSend(out, n, nh, true, FT_STAT, q, NODE_ID, dl);
  if (r == MAC_OK) {
    if (part == 3) { g_nodeEvShipped += evShip; g_macEvtShipped = meShipTo; }
    if (part == 4) g_ctReady = false;
    wlogf("TX", "STAT pt%u q=%u -> N%u (ACK ok, %u retx) %u B", (unsigned)part, (unsigned)q, (unsigned)nh, (unsigned)g_macLastRetries, (unsigned)n);
  } else {
    wlogf("TX", "STAT pt%u q=%u -> N%u FAILED", (unsigned)part, (unsigned)q, (unsigned)nh);
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// [G §4.b] CONTENTION_TEST: N1 and N2 both macSend a DATA (u:"test") to N3 at network time T
// ---------------------------------------------------------------------------------------------
static void ctService() {
  if (!g_ctArmedAt || (int32_t)(netNow() - g_ctArmedAt) < 0) return;
  g_ctArmedAt = 0;
  if (g_killed) return;
  uint8_t dest = (g_nb[3].known && g_nb[3].linkUp && !routeLinkBlocked(3)) ? 3 : routeNextHop();
  if (!dest) { wlogf("MAC", "CONTENTION_TEST: no neighbour to send to"); return; }
  g_ctN = 0;
  g_ctReady = false;
  g_ctStartUs = micros();
  g_ctActive = true;
  char out[FRAME_MAX + 8];
  uint16_t q = ++g_seqTest;
  size_t n = buildData(out, sizeof(out), dest, q, 0, 0, netNow(), "test", 1);
  uint32_t dl = tdmaSlotRemainingMs();
  dl = dl > MAC_SLOT_END_MARGIN_MS + 20 ? dl - MAC_SLOT_END_MARGIN_MS : MAC_TX_DEADLINE_MS;
  uint8_t r = macSend(out, n, dest, true, FT_DATA, q, NODE_ID, dl);
  g_ctActive = false;
  g_ctReady = true;
  macFlushLog();
  wlogf("MAC", "CONTENTION_TEST T=%lu -> N%u %s, timeline:", (unsigned long)g_ctAt, (unsigned)dest, r == MAC_OK ? "ACK_OK" : "FAILED");
  for (uint8_t i = 0; i < g_ctN; i++) wlogf("MAC", "  %s", g_ctLines[i]);
  nodeEvent(EV_MAC, "CONTENTION_TEST %s (%u steps)", r == MAC_OK ? "ACK_OK" : "FAIL", (unsigned)g_ctN);
}

// ---------------------------------------------------------------------------------------------
// Receive dispatcher (loop context; also called from macSend's ACK wait, never re-entrant)
// ---------------------------------------------------------------------------------------------
static void rxRelay(const RxItem& it, uint8_t ft, uint8_t o, uint16_t q, uint8_t s) {
  routeEnqueueForward(it.data, it.len, ft, o, q);
  wlogf("RX", "%s q=%u origin N%u from N%u -> queued for forwarding in own slot (%u queued)", ftName(ft), (unsigned)q,
        (unsigned)o, (unsigned)s, (unsigned)g_fwdN);
}

static void rxHandle(const RxItem& it) {
  DeserializationError err = deserializeJson(g_rxDoc, (const char*)it.data, (size_t)it.len);
  if (err) { g_rxBad++; return; }
  JsonDocument& doc = g_rxDoc;
  uint8_t ft = ftFromStr(doc["t"] | "");
  uint8_t s = doc["s"] | 0;
  uint8_t d = doc["d"] | 0;
  if (ft == FT_UNKNOWN || s < 1 || s > 4 || s == NODE_ID) return;
  nodeLearnMac(s, it.mac);
  if (it.rssi && !g_promiscOk) g_wifiRssi[s] = it.rssi;
  if (!isAllowed(NODE_ID, s)) { g_oorCount++; return; }           // [G §4.f] simulated radio range
  if (routeLinkBlocked(s)) { g_blockedDrop++; return; }            // LINK_FAIL simulation
  macCheckNearCollision(s, it.us);   // FIX: after the range/blocked filter (N1 counted "collisions" with out-of-range N4)
  if (ft == FT_ACK) return;                                        // matched in the receive callback
  if (g_killed && ft != FT_CTRL && ft != FT_SCHED) return;         // killed: only listens for NODE_WAKE / time
  uint16_t q = doc["q"] | 0;
  uint8_t o = doc["o"] | s;
  bool unicast = (ft == FT_DATA || ft == FT_AGG || ft == FT_STAT);
  if (unicast) {
    if (d != NODE_ID) return;
    macSendAck(it.mac, s, ft, q, o);                               // [G §4.b] ACK immediately
    if (macIsDuplicate(s, ft, o, q)) {
      wlogf("RX", "DUP %s q=%u from N%u (ACK lost earlier -> re-ACKed, not processed)", ftName(ft), (unsigned)q, (unsigned)s);
      return;
    }
    tdmaNoteHeard(s);
    tdmaNoteHeard(o);
  }
  switch (ft) {
    case FT_HELLO: {
      routeOnHello(s, doc);
      tdmaNoteHeard(s);
      tdmaNoteMemberNh(s, doc["nh"] | 0);
      if (IS_SINK) sinkOnBroadcast(ft, s, q, it.ms, doc);
#if SERIAL_VERBOSE_RX
      wlogf("RX", "HELLO from N%u h=%u nh=N%u c=%u", (unsigned)s, (unsigned)(doc["h"] | 255), (unsigned)(doc["nh"] | 0), (unsigned)(doc["c"] | 0));
#endif
      break;
    }
    case FT_SCHED:
      tdmaOnSched(s, doc, it.ms);
      if (IS_SINK) sinkOnBroadcast(ft, s, q, it.ms, doc);
      break;
    case FT_CTRL:
      if (IS_SINK) sinkOnBroadcast(ft, s, q, it.ms, doc);
      ctrlOnFrame(s, doc);
      break;
    case FT_DATA: {
      const char* u = doc["u"] | "";
      if (!strcmp(u, "test")) {
        wlogf("RX", "DATA(test) q=%u from N%u -> ACK sent (contention test)", (unsigned)q, (unsigned)s);
        break;
      }
      if (IS_SINK) sinkOnData(s, doc, it.ms);
      else if (IS_CH) {
        uint8_t th = (doc["th"] | 0) ? 1 : 0;
        wlogf("RX", "DATA q=%u origin N%u from N%u v=%ld th=%u path %s -> ACK sent", (unsigned)q, (unsigned)o, (unsigned)s,
              (long)(doc["v"] | 0), (unsigned)th, (const char*)(doc["p"] | ""));
        aggOnData(o, doc["v"] | 0, th, q, doc["ts"].as<uint32_t>(), doc["p"] | "", it.len);
      } else {
        rxRelay(it, ft, o, q, s);                                  // N2 relays N1's data (alternate route)
      }
      break;
    }
    case FT_AGG:
      if (IS_SINK) sinkOnAgg(s, doc, it.ms);
      else rxRelay(it, ft, o, q, s);
      break;
    case FT_STAT:
      if (g_isMaster) tdmaOnStat(o, doc);                          // scheduler inputs (rules 3 and 5)
      if (IS_SINK) sinkOnStat(s, doc, it.ms);
      else rxRelay(it, ft, o, q, s);
      break;
    default:
      break;
  }
}

void rxProcessQueue(uint8_t maxFrames) {
  if (g_inRx) return;
  g_inRx = true;
  while (maxFrames-- && rxPop(g_rxItem)) rxHandle(g_rxItem);
  g_inRx = false;
}

// ---------------------------------------------------------------------------------------------
// Periodic node table (like the reference gateway code)
// ---------------------------------------------------------------------------------------------
static void printNodeTable() {
  char sl[40];
  tdmaFmtSlots(g_sched.a, sl, sizeof(sl));
  wlogf("TABLE", "==== N%d %s | sf=%lu slot=%d v%u %s master=N%u %s | heap %lu B", NODE_ID, NODE_ROLE[NODE_ID],
        (unsigned long)g_curSf, (int)g_curSlot, (unsigned)tdmaVersion(), sl, (unsigned)g_sched.master,
        g_timeSynced ? "synced" : "NOT synced", (unsigned long)ESP.getFreeHeap());
  if (!IS_SINK)
    wlogf("TABLE", "route: next hop N%u hops %u cost %u | alt N%u cost %u | duty %.1f%% (awake %lus sleep %lus)%s",
          (unsigned)g_nextHop, (unsigned)g_hops, g_routeCost == 0xFFFF ? 0 : (unsigned)g_routeCost, (unsigned)g_altHop,
          g_altCost == 0xFFFF ? 0 : (unsigned)g_altCost, (double)tdmaDuty(), (unsigned long)(g_awakeMs / 1000),
          (unsigned long)(g_sleepMs / 1000), g_killed ? " | KILLED" : "");
  wlogf("TABLE", "Nbr Known Link Allowed WiFi  BLE  Dist  Hops NH  Ack%%  Cost  HelloAge");
  uint32_t now = millis();
  for (uint8_t k = 1; k <= 4; k++) {
    if (k == NODE_ID) continue;
    const Neighbor& n = g_nb[k];
    wlogf("TABLE", "N%u  %-5s %-4s %-7s %4d %4d %5u %4u  N%u %4u %5u %6lus%s", (unsigned)k, n.known ? "yes" : "no",
          n.linkUp ? "UP" : "DOWN", isAllowed(NODE_ID, k) ? "yes" : "oor", (int)g_wifiRssi[k], (int)bleRssi(k),
          (unsigned)bleDistCm(k), (unsigned)n.hops, (unsigned)n.nh, (unsigned)routeAckPct(k),
          n.cost == 0xFFFF ? 0 : (unsigned)n.cost, n.known ? (unsigned long)((now - n.lastHelloMs) / 1000) : 0UL,
          routeLinkBlocked(k) ? " BLOCKED" : "");
  }
  wlogf("TABLE", "MAC tx=%lu retx=%lu ok=%lu to=%lu busy=%lu bo=%lums col=%lu def=%lu | data tx=%lu fw=%lu oor=%lu blk=%lu rxq-drop=%lu bad=%lu",
        (unsigned long)g_mac.tx, (unsigned long)g_mac.retx, (unsigned long)g_mac.ok, (unsigned long)g_mac.to,
        (unsigned long)g_mac.busy, (unsigned long)g_mac.bo, (unsigned long)g_mac.col, (unsigned long)g_mac.def,
        (unsigned long)g_txDataCount, (unsigned long)g_fwdCount, (unsigned long)g_oorCount, (unsigned long)g_blockedDrop,
        (unsigned long)g_rxDropFull, (unsigned long)g_rxBad);
  if (!IS_SINK) {
    int32_t sv = readSensor();
    if (NODE_ID == 1)
      wlogf("TABLE", "sensor %s: v=%ld %s th=%u (TEMP_WARN %ld.%02ld C)", NODE_SENSOR[NODE_ID], (long)sv, sensorUnitCode(),
            (unsigned)readThreshold(), (long)(g_tempWarn / 100), (long)(g_tempWarn % 100));
    else
      wlogf("TABLE", "sensor %s: v=%ld %s th=%u", NODE_SENSOR[NODE_ID], (long)sv, sensorUnitCode(), (unsigned)readThreshold());
  }
  if (IS_CH)
    wlogf("TABLE", "AGG cumulative in=%lu out=%lu bytes %lu->%lu", (unsigned long)g_aggCumIn, (unsigned long)g_aggCumOut,
          (unsigned long)g_aggCumBi, (unsigned long)g_aggCumBo);
  if (IS_SINK) sinkPrintTable();
}

static void tableService() {
  if (millis() - g_tableMs < SERIAL_TABLE_PERIOD_MS) return;
  // FIX: the ~1-2 KB table used to be printed at any moment; with a full UART buffer println()
  // blocks the loop for 100+ ms, so frames arriving meanwhile were ACKed too late (spurious
  // ACK_TIMEOUT/RETX, even LINK_DOWN). Print only with enough free TX buffer, outside the JSON
  // line, and (non-sink) in slot 0 / an UNUSED slot where no unicast is expected.
  if (Serial.availableForWrite() < 2048 || g_serialJsonBusy || g_holdLen) return;
  if (!IS_SINK && g_sched.valid && g_curSlot > 0 && g_sched.a[g_curSlot] != TDMA_UNUSED) return;
  g_tableMs = millis();
  printNodeTable();
}

// ---------------------------------------------------------------------------------------------
// setup / loop
// ---------------------------------------------------------------------------------------------
void setup() {
  Serial.setRxBufferSize(1024);                       // CMD:{...} lines from serial_bridge.py
  Serial.setTxBufferSize(4096);                       // FIX: was 1 KB on N1..N3 (a slot's MAC log alone fills it -> println blocks)
  Serial.begin(SERIAL_BAUD);
  delay(300);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);
  Serial.println();
#ifdef ESP_ARDUINO_VERSION_MAJOR
  wlogf("BOOT", "AquaSense-WSN node N%d - %s | core %d.%d.%d, IDF %s, ArduinoJson %d", NODE_ID, NODE_ROLE[NODE_ID],
        ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH, ESP.getSdkVersion(), ARDUINOJSON_VERSION_MAJOR);
#else
  wlogf("BOOT", "AquaSense-WSN node N%d - %s | IDF %s, ArduinoJson %d", NODE_ID, NODE_ROLE[NODE_ID], ESP.getSdkVersion(), ARDUINOJSON_VERSION_MAJOR);
#endif
  sensorsInit();
  routeInit();
  sinkInit();
  bleInit();            // [G §3] BLE first ...
  macInit();            // ... then Wi-Fi STA (+ hotspot on N4), ESP-NOW, promiscuous sniffer
  tdmaInit();
  g_tableMs = millis();
  wlogf("BOOT", "ready, free heap %lu B", (unsigned long)ESP.getFreeHeap());
}

void loop() {
  rxProcessQueue(RXQ_LEN);       // parse received frames, ACK unicasts
  macFlushLog();
  tdmaService();                 // slot state machine + scheduled transmissions
  macFlushLog();
  ctService();                   // contention test at network time T
  macFlushLog();
  routeService();                // HELLO timeouts, LINK_FAIL / NODE_KILL expiry
  bleService(tdmaIsAwake());     // BLE scan maintenance (paused while asleep)
  bleLogService();
  if (IS_SINK) sinkService();    // uplink, serial JSON streaming, CMD input, Wi-Fi reconnect
  tableService();
  delay(1);
}
