// =============================================================================================
// AquaSense-WSN  -  routing.h   [G §4.f adaptive multi-hop routing & recovery, G §4.c HELLO]
// Neighbour table, HELLO (route-control broadcast), cost metric exactly as spec §6, next hop +
// alternate, failure detection (consecutive MAC failures / HELLO timeout), route update events,
// recovery, relay forwarding queue, LINK_FAIL blocked-pair list, NODE_KILL state.
// =============================================================================================
#pragma once
#include "shared.h"

struct Neighbor {
  uint8_t  id; uint8_t mac[6]; bool known; bool linkUp;
  int8_t   wifiRssi; int8_t bleRssi; uint16_t bleDistCm;
  uint8_t  hops;               // hops-to-sink advertised in its HELLO (255 = none)
  uint16_t ackOk, ackFail;     // sliding window counters (halved every ROUTE_ACK_WINDOW attempts)
  uint8_t  consecFail; uint32_t lastHelloMs; uint16_t cost;
  // extra state
  uint8_t  nh;                 // its advertised next hop (split horizon / "am I its parent?")
  uint16_t advCost; uint16_t ver; uint32_t up;
  uint8_t  recoverHellos;
};
static Neighbor g_nb[5];
static uint8_t  g_nextHop = 0, g_hops = 255, g_altHop = 0;
static uint16_t g_routeCost = 0xFFFF, g_altCost = 0xFFFF;
static bool     g_helloUrgent = false;      // send HELLO early in the next CONTROL slot
static uint32_t g_routeChanges = 0;

// What each HELLO sender reported about its neighbours (nb list) - used by the sink for links[]
struct NbView { int8_t ble; int8_t wifi; uint8_t ack; uint8_t up; uint32_t ms; };
static NbView g_nbView[5][5];

// ---------------------------------------------------------------------------------------------
// LINK_FAIL simulation: blocked pairs (both endpoints drop each other's frames, no ACK)
// ---------------------------------------------------------------------------------------------
struct BlockedPair { volatile uint8_t a, b; volatile uint32_t untilMs; volatile bool used; };
static BlockedPair g_blocked[4];

bool routePairBlocked(uint8_t a, uint8_t b) {
  for (int i = 0; i < 4; i++) {
    if (!g_blocked[i].used) continue;
    if ((g_blocked[i].a == a && g_blocked[i].b == b) || (g_blocked[i].a == b && g_blocked[i].b == a)) return true;
  }
  return false;
}
bool routeLinkBlocked(uint8_t other) { return routePairBlocked(NODE_ID, other); }

static void routeBlockPair(uint8_t a, uint8_t b, uint32_t durS) {
  if (durS == 0) durS = ROUTE_LINK_FAIL_DEFAULT_S;
  int slot = -1;
  for (int i = 0; i < 4; i++) {
    if (g_blocked[i].used && ((g_blocked[i].a == a && g_blocked[i].b == b) || (g_blocked[i].a == b && g_blocked[i].b == a))) { slot = i; break; }
    if (!g_blocked[i].used && slot < 0) slot = i;
  }
  if (slot < 0) slot = 0;
  g_blocked[slot].a = a; g_blocked[slot].b = b;
  g_blocked[slot].untilMs = millis() + durS * 1000UL;
  g_blocked[slot].used = true;
}
static void routeUnblockPair(uint8_t a, uint8_t b) {
  for (int i = 0; i < 4; i++)
    if (g_blocked[i].used && ((g_blocked[i].a == a && g_blocked[i].b == b) || (g_blocked[i].a == b && g_blocked[i].b == a))) g_blocked[i].used = false;
}

// ---------------------------------------------------------------------------------------------
// Link quality bookkeeping
// ---------------------------------------------------------------------------------------------
static uint8_t routeAckPct(uint8_t k) {
  uint32_t t = (uint32_t)g_nb[k].ackOk + g_nb[k].ackFail;
  return t == 0 ? 100 : (uint8_t)((g_nb[k].ackOk * 100UL) / t);
}

static void routeRefreshRssi(uint8_t k) {
  g_nb[k].wifiRssi = g_wifiRssi[k];
  g_nb[k].bleRssi = bleRssi(k);
  g_nb[k].bleDistCm = bleDistCm(k);
}

// [G §4.f] Route metric (lower = better), spec §6:
//   cost = 10*(hops+1) + (100-ackRatePct)/5 + max(0,-70-wifiRssi)/2 + (member && next!=3 && CH reachable ? 20 : 0)
static bool chReachable() { return NODE_ID != 3 && g_nb[3].known && g_nb[3].linkUp; }
static uint16_t routeCostVia(uint8_t k) {
  const Neighbor& n = g_nb[k];
  if (k == NODE_ID || !n.known || !n.linkUp || n.hops >= 255 || !isAllowed(NODE_ID, k)) return 0xFFFF;
  if (k != 4 && n.nh == NODE_ID) return 0xFFFF;                // split horizon: never route through own child
  if (n.hops >= 8) return 0xFFFF;                               // count-to-infinity guard
  int32_t rssi = n.wifiRssi ? n.wifiRssi : -50;                 // unknown RSSI -> no penalty
  int32_t c = 10 * (n.hops + 1)
            + (100 - routeAckPct(k)) / 5
            + wMax(0, ROUTE_RSSI_KNEE - rssi) / 2
            + ((IS_MEMBER && k != 3 && chReachable()) ? ROUTE_MEMBER_CH_PENALTY : 0);
  return (uint16_t)c;
}

uint8_t routeNextHop() { return g_nextHop; }

static void routeRecompute(bool restoreContext) {
  if (IS_SINK) { g_nextHop = 0; g_hops = 0; g_routeCost = 0; g_altHop = 0; g_altCost = 0; return; }
  uint8_t best = 0, second = 0;
  uint16_t bc = 0xFFFF, sc = 0xFFFF;
  for (uint8_t k = 1; k <= 4; k++) {
    routeRefreshRssi(k);
    uint16_t c = routeCostVia(k);
    g_nb[k].cost = c;
    if (c == 0xFFFF) continue;
    if (c < bc) { second = best; sc = bc; best = k; bc = c; }
    else if (c < sc) { second = k; sc = c; }
  }
  uint8_t old = g_nextHop;
  uint16_t oldCost = g_routeCost;
  g_nextHop = best;
  g_routeCost = best ? bc : 0xFFFF;
  g_hops = best ? (uint8_t)(g_nb[best].hops + 1) : 255;
  g_altHop = second;
  g_altCost = second ? sc : 0xFFFF;
  if (best == old) return;
  g_routeChanges++;
  g_helloUrgent = true;                                        // route-control broadcast with the new h
  if (best == 0) {
    nodeEvent(EV_ROUTE, "NO_ROUTE (was N%d)", old);
    wlogf("ROUTE", "NO_ROUTE to sink (was via N%d)", old);
  } else if (old == 0) {
    nodeEvent(EV_ROUTE, "ROUTE via N%d cost %u", best, (unsigned)bc);
    wlogf("ROUTE", "ROUTE via N%d cost %u hops %u (alt N%d %u)", best, (unsigned)bc, (unsigned)g_hops, second, second ? (unsigned)sc : 0);
  } else if (restoreContext) {
    // FIX: compared with the stale cost of the alternate (computed while the CH was unreachable,
    // i.e. without its +20 penalty), so with a degraded ACK rate on the recovered link the event
    // never said "ROUTE RESTORED" (= the dashboard's "Route Recovery" step). best is the argmin, so
    // it is never worse than the old hop's current cost, which is what we report now.
    uint16_t oc = (old <= 4 && g_nb[old].cost != 0xFFFF) ? g_nb[old].cost : oldCost;
    nodeEvent(EV_ROUTE, "ROUTE RESTORED N%d→N%d cost %u→%u", old, best, (unsigned)oc, (unsigned)bc);
    wlogf("ROUTE", "ROUTE RESTORED N%d -> N%d cost %u -> %u", old, best, (unsigned)oc, (unsigned)bc);
  } else {
    nodeEvent(EV_ROUTE, "ROUTE N%d→N%d cost %u→%u", old, best, oldCost == 0xFFFF ? 0 : (unsigned)oldCost, (unsigned)bc);
    wlogf("ROUTE", "ROUTE N%d -> N%d cost %u -> %u (alt N%d)", old, best, oldCost == 0xFFFF ? 0 : (unsigned)oldCost, (unsigned)bc, second);
  }
}

// [G §4.f] failure detection -> alternate route selection
static void routeLinkDown(uint8_t k, const char* why) {
  if (!g_nb[k].linkUp) return;
  g_nb[k].linkUp = false;
  g_nb[k].consecFail = 0;
  g_nb[k].recoverHellos = 0;
  nodeEvent(EV_ROUTE, "LINK_DOWN N%d", k);
  uint8_t before = g_nextHop;
  routeRecompute(false);
  if (IS_SINK) wlogf("ROUTE", "LINK_DOWN N%d (%s)", k, why);
  else if (g_nextHop) wlogf("ROUTE", "LINK_DOWN N%d (%s) -> next hop N%d (cost %u)%s", k, why, g_nextHop, (unsigned)g_routeCost,
                            before == g_nextHop ? " [unchanged]" : " [ALTERNATE ROUTE]");
  else wlogf("ROUTE", "LINK_DOWN N%d (%s) -> no route", k, why);
}

// [G §4.f] recovery
static void routeLinkUp(uint8_t k, const char* why) {
  if (g_nb[k].linkUp) return;
  g_nb[k].linkUp = true;
  g_nb[k].consecFail = 0;
  nodeEvent(EV_ROUTE, "LINK_UP N%d", k);
  wlogf("ROUTE", "LINK_UP N%d (%s)", k, why);
  routeRecompute(true);
}

void routeOnTxAttempt(uint8_t k, bool acked) {
  if (k < 1 || k > 4) return;
  if (acked) g_nb[k].ackOk++; else g_nb[k].ackFail++;
  if ((uint32_t)g_nb[k].ackOk + g_nb[k].ackFail >= ROUTE_ACK_WINDOW) { g_nb[k].ackOk /= 2; g_nb[k].ackFail /= 2; }
}

void routeOnTxResult(uint8_t k, bool ok) {
  if (k < 1 || k > 4) return;
  if (ok) {
    g_nb[k].consecFail = 0;
    if (!g_nb[k].linkUp && g_nb[k].known) routeLinkUp(k, "unicast ACKed");
    return;
  }
  g_nb[k].consecFail++;
  if (g_nb[k].consecFail >= ROUTE_FAIL_CONSEC) routeLinkDown(k, "2 frames unACKed");
  else routeRecompute(false);   // ack rate dropped -> cost may change
}

// ---------------------------------------------------------------------------------------------
// HELLO build / parse  [G §4.c broadcast: neighbour discovery, route control, network status]
// ---------------------------------------------------------------------------------------------
static size_t routeBuildHello(char* out, size_t cap) {
  JSON_DOC(doc, 768);
  doc["t"] = "HELLO"; doc["s"] = NODE_ID; doc["d"] = 0; doc["q"] = ++g_seqBcast; doc["ts"] = netNow();
  doc["h"] = g_hops; doc["nh"] = g_nextHop; doc["c"] = (g_routeCost == 0xFFFF) ? 0 : g_routeCost;
  doc["ver"] = tdmaVersion(); doc["up"] = millis() / 1000;
  JsonArray nb = JSON_ADD_ARR(doc, "nb");
  for (uint8_t k = 1; k <= 4; k++) {
    if (k == NODE_ID || !g_nb[k].known) continue;
    routeRefreshRssi(k);
    JsonArray r = JSON_ARR_ADD_ARR(nb);
    r.add(k); r.add((int)g_nb[k].bleRssi); r.add((int)g_nb[k].wifiRssi); r.add(routeAckPct(k)); r.add(g_nb[k].linkUp ? 1 : 0);
    if (measureJson(doc) > FRAME_MAX) { nb.remove(nb.size() - 1); break; }
  }
  return serializeJson(doc, out, cap);
}

static void routeOnHello(uint8_t s, JsonDocument& doc) {
  Neighbor& n = g_nb[s];
  bool wasKnown = n.known;
  uint8_t oldHops = n.hops, oldNh = n.nh;
  n.id = s;
  nodeMacCopy(s, n.mac);
  n.known = true;
  n.lastHelloMs = millis();
  n.hops = doc["h"] | 255;
  n.nh = doc["nh"] | 0;
  n.advCost = doc["c"] | 0;
  n.ver = doc["ver"] | 0;
  n.up = doc["up"] | 0;
  JsonArray nb = doc["nb"].as<JsonArray>();
  if (!nb.isNull()) {
    for (JsonVariant v : nb) {
      JsonArray r = v.as<JsonArray>();
      uint8_t to = r[0] | 0;
      if (to < 1 || to > 4) continue;
      NbView& w = g_nbView[s][to];
      w.ble = r[1] | 0; w.wifi = r[2] | 0; w.ack = r[3] | 100; w.up = r[4] | 0; w.ms = millis();
    }
  }
  if (!wasKnown) {
    n.linkUp = true;
    n.ackOk = n.ackFail = 0;
    wlogf("ROUTE", "NEIGHBOUR N%d discovered via HELLO (h=%u nh=N%u)", s, (unsigned)n.hops, (unsigned)n.nh);
    nodeEvent(EV_ROUTE, "NEIGHBOUR N%d", s);
    routeRecompute(false);   // FIX: was 'true' -> a boot-time switch N2->N3 was logged as "ROUTE RESTORED"
    return;
  }
  if (!n.linkUp) {
    if (++n.recoverHellos >= ROUTE_RECOVER_HELLOS) routeLinkUp(s, "HELLOs resumed");
    return;
  }
  if (oldHops != n.hops || oldNh != n.nh) {
#if SERIAL_VERBOSE_RX == 0
    wlogf("ROUTE", "N%d now advertises h=%u nh=N%u", s, (unsigned)n.hops, (unsigned)n.nh);
#endif
    routeRecompute(false);
  }
}

// ---------------------------------------------------------------------------------------------
// Relay forwarding queue (N2 forwards N1's DATA/STAT, N3 forwards STAT, any node can relay AGG)
// ---------------------------------------------------------------------------------------------
struct FwdItem { char data[FRAME_MAX + 1]; uint8_t len; uint8_t type; uint8_t origin; uint16_t q; uint8_t attempts; };
static FwdItem g_fwd[FWD_QUEUE_LEN];
static uint8_t g_fwdN = 0;
static uint32_t g_fwdDropped = 0;

static void routeEnqueueForward(const char* data, uint8_t len, uint8_t type, uint8_t origin, uint16_t q) {
  if (g_fwdN >= FWD_QUEUE_LEN) {                        // drop the oldest
    memmove(&g_fwd[0], &g_fwd[1], sizeof(FwdItem) * (FWD_QUEUE_LEN - 1));
    g_fwdN--;
    g_fwdDropped++;
  }
  FwdItem& f = g_fwd[g_fwdN++];
  memcpy(f.data, data, len);
  f.data[len] = 0;
  f.len = len; f.type = type; f.origin = origin; f.q = q; f.attempts = 0;
}

// Forward the oldest queued frame to the current next hop. Returns true if something was sent.
static bool routeForwardOne(uint32_t deadlineMs) {
  if (!g_fwdN) return false;
  FwdItem& f = g_fwd[0];
  bool drop = false;
  if (!g_nextHop) return false;
  JSON_DOC(doc, 1536);
  if (deserializeJson(doc, (const char*)f.data, f.len)) drop = true;
  char out[FRAME_MAX + 8];
  size_t n = 0;
  if (!drop) {
    doc["s"] = NODE_ID;
    doc["d"] = g_nextHop;
    if (f.type == FT_DATA || f.type == FT_AGG) {
      int ttl = doc["ttl"] | ROUTE_DATA_TTL;
      if (ttl <= 1) { drop = true; wlogf("FWD", "%s q=%u from N%u ttl expired -> dropped", ftName(f.type), (unsigned)f.q, (unsigned)f.origin); }
      doc["ttl"] = ttl - 1;
      doc["hop"] = (int)(doc["hop"] | 1) + 1;
      char p[24];
      snprintf(p, sizeof(p), "%s>%d", (const char*)(doc["p"] | ""), NODE_ID);
      doc["p"] = p;                                       // copied by ArduinoJson (char*)
      if (!drop) n = serializeJson(doc, out, sizeof(out));
    } else {
      n = serializeJson(doc, out, sizeof(out));
    }
    if (n == 0 || n > FRAME_MAX) drop = true;
  }
  if (drop) {
    memmove(&g_fwd[0], &g_fwd[1], sizeof(FwdItem) * (g_fwdN - 1));
    g_fwdN--;
    return false;
  }
  uint8_t nh = g_nextHop;
  uint8_t r = macSend(out, n, nh, true, f.type, f.q, f.origin, deadlineMs);
  if (r == MAC_ABORT) return false;                         // keep it for the next chance
  if (r == MAC_OK) {
    g_fwdCount++;
    wlogf("FWD", "%s q=%u origin N%u -> N%d (ACK ok, %u retx)%s%s", ftName(f.type), (unsigned)f.q, (unsigned)f.origin, nh,
          (unsigned)g_macLastRetries, (f.type == FT_DATA || f.type == FT_AGG) ? " path " : "",
          (f.type == FT_DATA || f.type == FT_AGG) ? (const char*)(doc["p"] | "") : "");
  } else {
    wlogf("FWD", "%s q=%u origin N%u -> N%d FAILED", ftName(f.type), (unsigned)f.q, (unsigned)f.origin, nh);
    if (++f.attempts < FWD_MAX_ATTEMPTS) return true;       // retry later (front of queue)
    g_fwdDropped++;
  }
  memmove(&g_fwd[0], &g_fwd[1], sizeof(FwdItem) * (g_fwdN - 1));
  g_fwdN--;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Periodic maintenance: HELLO timeouts, LINK_FAIL expiry, NODE_KILL expiry
// ---------------------------------------------------------------------------------------------
static uint32_t g_routeSvcMs = 0;
static void routeService() {
  uint32_t now = millis();
  if (now - g_routeSvcMs < 200) return;
  g_routeSvcMs = now;
  for (uint8_t k = 1; k <= 4; k++) {
    if (k == NODE_ID || !g_nb[k].known || !g_nb[k].linkUp) continue;
    if (now - g_nb[k].lastHelloMs > ROUTE_HELLO_TIMEOUT_MS) routeLinkDown(k, "HELLO timeout 9 s");
  }
  for (int i = 0; i < 4; i++) {
    if (g_blocked[i].used && (int32_t)(now - g_blocked[i].untilMs) >= 0) {
      g_blocked[i].used = false;
      wlogf("ROUTE", "LINK_FAIL N%u-N%u expired", (unsigned)g_blocked[i].a, (unsigned)g_blocked[i].b);
      nodeEvent(EV_ROUTE, "LINK_FAIL N%u-N%u expired", (unsigned)g_blocked[i].a, (unsigned)g_blocked[i].b);
    }
  }
  if (g_killed && g_killUntilMs && (int32_t)(now - g_killUntilMs) >= 0) {
    g_killed = false;
    tdmaGrace();
    wlogf("CTRL", "NODE_KILL expired -> transmitting again");
    nodeEvent(EV_CTRL, "WAKE N%d (kill expired)", NODE_ID);
  }
}

void routeResetStats() {
  for (uint8_t k = 1; k <= 4; k++) { g_nb[k].ackOk = 0; g_nb[k].ackFail = 0; }
  g_fwdCount = 0; g_oorCount = 0; g_blockedDrop = 0; g_fwdDropped = 0;
}

static void routeInit() {
  memset(g_nb, 0, sizeof(g_nb));
  for (uint8_t k = 1; k <= 4; k++) { g_nb[k].id = k; g_nb[k].hops = 255; g_nb[k].cost = 0xFFFF; }
  if (IS_SINK) { g_hops = 0; g_routeCost = 0; }
}
