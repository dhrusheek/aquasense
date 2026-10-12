// =============================================================================================
// AquaSense-WSN  -  mac.h   [G §3 Wi-Fi, G §4.b Wi-Fi MAC protocol, G §4.c broadcast/unicast]
// * ESP-NOW init on one fixed channel, dynamic peers (MACs learned from received frames)
// * Promiscuous sniffer = physical channel sensing + per-neighbour Wi-Fi RSSI
// * macSend(): CSMA/CA  sense -> DIFS -> random backoff (frozen while busy) -> TX -> ACK wait
//              -> timeout -> binary exponential backoff retransmission -> FAIL  (spec §4)
// * ACK generation, duplicate suppression, MAC counters, MAC event ring (us timestamps),
//   near-collision detection, CONTENTION_TEST timeline recording.
// =============================================================================================
#pragma once
#include "shared.h"

void sinkWifiBoot();          // sink.h (N4 joins the hotspot before ESP-NOW starts)

static const uint8_t BCAST_MAC[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// ---------------------------------------------------------------------------------------------
// MAC counters reported in STAT.mac (spec §4)
// ---------------------------------------------------------------------------------------------
struct MacCounters { uint32_t tx, retx, ok, to, busy, bo, col, def; };
static MacCounters g_mac;
static uint32_t g_macBoUs = 0;           // accumulated backoff (us) -> g_mac.bo in ms
static uint8_t  g_macLastRetries = 0;    // retransmissions of the last macSend
static uint32_t g_ackTxCount = 0;        // ACK frames sent by this node
static volatile uint32_t g_hwSendFail = 0;   // ESP-NOW send callback reported failure

// ---------------------------------------------------------------------------------------------
// MAC event ring buffer (us timestamps). Printed from loop() after macSend (never inside the
// timing-critical procedure) and shipped to the sink in STAT.me.
// ---------------------------------------------------------------------------------------------
struct MacEvt { uint32_t us; uint32_t net; char ev[30]; };
static MacEvt   g_macEvt[MAC_EVT_RING];
static uint32_t g_macEvtCount = 0, g_macEvtPrinted = 0, g_macEvtShipped = 0;

// CONTENTION_TEST timeline (spec §4): us offsets from the start instant T
#define CT_LINES 10
static char     g_ctLines[CT_LINES][34];
static uint8_t  g_ctN = 0;
static bool     g_ctActive = false;      // recording
static bool     g_ctReady = false;       // finished, waiting to be shipped in STAT
static uint32_t g_ctAt = 0;              // network time T of the test
static uint32_t g_ctArmedAt = 0;         // != 0 -> test scheduled at this network time
static uint32_t g_ctStartUs = 0;

void macEvent(const char* fmt, ...) {
  MacEvt& e = g_macEvt[g_macEvtCount % MAC_EVT_RING];
  e.us = micros();
  e.net = netNow();
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(e.ev, sizeof(e.ev), fmt, ap);
  va_end(ap);
  g_macEvtCount++;
  if (g_ctActive && g_ctN < CT_LINES)
    snprintf(g_ctLines[g_ctN++], sizeof(g_ctLines[0]), "+%luus %s", (unsigned long)(e.us - g_ctStartUs), e.ev);
  if (IS_SINK) sinkLogMacEvent(NODE_ID, e.net, e.ev);
}

static void macFlushLog() {
  if (g_macEvtCount - g_macEvtPrinted > MAC_EVT_RING) g_macEvtPrinted = g_macEvtCount - MAC_EVT_RING;
  while (g_macEvtPrinted < g_macEvtCount) {
    const MacEvt& e = g_macEvt[g_macEvtPrinted % MAC_EVT_RING];
#if MAC_LOG_VERBOSE
    wlogf("MAC", "%s", e.ev);
#else
    if (strncmp(e.ev, "CS_IDLE", 7) && strncmp(e.ev, "ACK_OK", 6) && strncmp(e.ev, "TX ", 3)) wlogf("MAC", "%s", e.ev);
#endif
    g_macEvtPrinted++;
  }
}

void macResetCounters() {
  memset(&g_mac, 0, sizeof(g_mac));
  g_macBoUs = 0;
  g_ackTxCount = 0;
}

// ---------------------------------------------------------------------------------------------
// Receive queue: the ESP-NOW callback only copies the frame; parsing happens in loop()
// ---------------------------------------------------------------------------------------------
struct RxItem { uint8_t mac[6]; uint8_t len; int8_t rssi; uint32_t ms; uint32_t us; char data[FRAME_MAX + 1]; };
#define RXQ_LEN 10
static RxItem g_rxq[RXQ_LEN];
static volatile uint8_t  g_rxHead = 0, g_rxTail = 0;
static volatile uint32_t g_rxDropFull = 0;
static portMUX_TYPE g_rxMux = portMUX_INITIALIZER_UNLOCKED;

static bool rxPop(RxItem& out) {
  if (g_rxTail == g_rxHead) return false;
  out = g_rxq[g_rxTail];
  portENTER_CRITICAL(&g_rxMux);
  g_rxTail = (uint8_t)((g_rxTail + 1) % RXQ_LEN);
  portEXIT_CRITICAL(&g_rxMux);
  return true;
}

// ACK expected by the running macSend (set by the callback for minimum latency)
struct AckWait { volatile bool active; volatile bool got; volatile uint8_t from; volatile uint8_t type; volatile uint16_t q; volatile uint8_t o; };
static AckWait g_ackWait;

static long cbFindInt(const char* s, const char* key, long def) {
  const char* p = strstr(s, key);
  if (!p) return def;
  return strtol(p + strlen(key), nullptr, 10);
}

// Minimal ACK parser for the callback context (no JSON library, fixed small buffer)
static void cbAckFastPath(const uint8_t* data, int len) {
  if (!g_ackWait.active) return;
  char b[112];
  int n = len < (int)sizeof(b) - 1 ? len : (int)sizeof(b) - 1;
  memcpy(b, data, n);
  b[n] = 0;
  long s = cbFindInt(b, "\"s\":", 0), d = cbFindInt(b, "\"d\":", 0);
  long q = cbFindInt(b, "\"q\":", -1), o = cbFindInt(b, "\"o\":", 0);
  const char* at = strstr(b, "\"at\":\"");
  if (!at || d != NODE_ID || s < 1 || s > 4) return;
  if (!isAllowed(NODE_ID, (uint8_t)s) || g_killed || routeLinkBlocked((uint8_t)s)) return;
  at += 6;
  const char* tn = ftName(g_ackWait.type);
  size_t tl = strlen(tn);
  if (strncmp(at, tn, tl) != 0 || at[tl] != '"') return;
  if ((uint8_t)s != g_ackWait.from || q != (long)g_ackWait.q || (uint8_t)o != g_ackWait.o) return;
  g_ackWait.got = true;
}

static void wsnRxCommon(const uint8_t* mac, const uint8_t* data, int len, int8_t rssi) {
  uint32_t us = micros();
  g_lastAirUs = us;                       // virtual carrier sense (sole input in CS_FALLBACK mode)
  if (!mac || !data || len <= 0 || len > FRAME_MAX) return;
  if (len > 10 && memcmp(data, "{\"t\":\"ACK\"", 10) == 0) cbAckFastPath(data, len);
  uint8_t h = g_rxHead;
  uint8_t nx = (uint8_t)((h + 1) % RXQ_LEN);
  if (nx == g_rxTail) { g_rxDropFull = g_rxDropFull + 1; return; }
  RxItem& it = g_rxq[h];
  memcpy(it.mac, mac, 6);
  memcpy(it.data, data, len);
  it.data[len] = 0;
  it.len = (uint8_t)len;
  it.rssi = rssi;
  it.ms = millis();
  it.us = us;
  portENTER_CRITICAL(&g_rxMux);
  g_rxHead = nx;
  portEXIT_CRITICAL(&g_rxMux);
}

#if WSN_NOW_RECV_INFO
// core 3.x (ESP-IDF >= 5.0)
static void onNowRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
  int8_t rssi = (info && info->rx_ctrl) ? (int8_t)info->rx_ctrl->rssi : 0;
  wsnRxCommon(info ? info->src_addr : nullptr, data, len, rssi);
}
#else
// core 2.0.x (ESP-IDF 4.4)
static void onNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  wsnRxCommon(mac, data, len, 0);
}
#endif

#if WSN_NOW_SEND_TXINFO
// core >= 3.3 (ESP-IDF >= 5.5): esp_now_send_cb_t takes const wifi_tx_info_t*
static void onNowSent(const wifi_tx_info_t* info, esp_now_send_status_t status) {
  (void)info;
  if (status != ESP_NOW_SEND_SUCCESS) g_hwSendFail = g_hwSendFail + 1;
}
#else
static void onNowSent(const uint8_t* mac, esp_now_send_status_t status) {
  (void)mac;
  if (status != ESP_NOW_SEND_SUCCESS) g_hwSendFail = g_hwSendFail + 1;
}
#endif

// ---------------------------------------------------------------------------------------------
// [G §4.b] Channel sensing: promiscuous sniffer (tiny callback, volatile globals only)
// Counts ESP-NOW frames (MGMT / ACTION 0xD, category 127, Espressif OUI 18:FE:34) from anyone
// and DATA frames from known WSN nodes. Beacons/probes and foreign data traffic are ignored so
// the lab's access points do not keep the channel "busy" (spec §2).
// ---------------------------------------------------------------------------------------------
static void promiscCb(void* buf, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT && type != WIFI_PKT_DATA) return;
  const wifi_promiscuous_pkt_t* pkt = (const wifi_promiscuous_pkt_t*)buf;
  const uint8_t* pl = pkt->payload;
  uint16_t len = pkt->rx_ctrl.sig_len;
  if (len < 24) return;
  uint8_t ftype = (pl[0] >> 2) & 3, sub = (pl[0] >> 4) & 0xF;
  const uint8_t* sa = pl + 10;
  int k = 0;
  for (int i = 1; i <= 4; i++) {
    if (g_nodeMacKnown[i] && memcmp((const void*)g_nodeMac[i], sa, 6) == 0) { k = i; break; }
  }
  bool espnow = (ftype == 0 && sub == 0xD && len > 28 && pl[24] == 127 && pl[25] == 0x18 && pl[26] == 0xFE && pl[27] == 0x34);
  bool data = (ftype == 2 && k != 0);
  if (!espnow && !data) return;
  g_lastAirUs = micros();
  if (k) g_wifiRssi[k] = (int8_t)pkt->rx_ctrl.rssi;
}

static inline bool macChannelBusy() { return (uint32_t)(micros() - g_lastAirUs) < MAC_CS_BUSY_US; }

// ---------------------------------------------------------------------------------------------
// Peers / addressing (no hard-coded MACs: learned from every received frame)
// ---------------------------------------------------------------------------------------------
static void macFmt(const uint8_t* m, char* out, size_t n) {
  snprintf(out, n, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
}
static void nodeMacCopy(uint8_t k, uint8_t* out) { for (int i = 0; i < 6; i++) out[i] = g_nodeMac[k][i]; }

static bool macEnsurePeer(const uint8_t* mac) {
  if (esp_now_is_peer_exist(mac)) return true;
  esp_now_peer_info_t p;
  memset(&p, 0, sizeof(p));
  memcpy(p.peer_addr, mac, 6);
  p.channel = 0;                 // 0 = current channel
  p.ifidx = WIFI_IF_STA;
  p.encrypt = false;
  return esp_now_add_peer(&p) == ESP_OK;
}

static void nodeLearnMac(uint8_t k, const uint8_t* mac) {
  if (k < 1 || k > 4 || k == NODE_ID) return;
  bool same = g_nodeMacKnown[k];
  for (int i = 0; same && i < 6; i++) if (g_nodeMac[k][i] != mac[i]) same = false;
  if (same) return;
  for (int i = 0; i < 6; i++) g_nodeMac[k][i] = mac[i];
  g_nodeMacKnown[k] = true;
  char ms[18];
  macFmt(mac, ms, sizeof(ms));
  if (isAllowed(NODE_ID, k)) {
    bool ok = macEnsurePeer(mac);
    wlogf("MAC", "learned N%d = %s (ESP-NOW peer %s)", k, ms, ok ? "added" : "ADD FAILED");
  } else {
    wlogf("MAC", "heard N%d = %s (not an allowed neighbour -> out of range)", k, ms);
  }
}

// ---------------------------------------------------------------------------------------------
// Duplicate suppression: last q per (sender, type, origin). Duplicates are re-ACKed, not processed.
// ---------------------------------------------------------------------------------------------
static uint16_t g_dupQ[5][3][5];
static bool     g_dupValid[5][3][5];
static bool macIsDuplicate(uint8_t s, uint8_t ftype, uint8_t o, uint16_t q) {
  int ti = (ftype == FT_DATA) ? 0 : (ftype == FT_AGG) ? 1 : 2;
  if (s > 4 || o > 4) return false;
  if (g_dupValid[s][ti][o] && g_dupQ[s][ti][o] == q) return true;
  g_dupValid[s][ti][o] = true;
  g_dupQ[s][ti][o] = q;
  return false;
}

// [G §4.b] receiver side of a collision: two frames from different senders < 5 ms apart
static uint32_t g_lastRxUs = 0;
static uint8_t  g_lastRxFrom = 0;
static void macCheckNearCollision(uint8_t s, uint32_t us) {
  if (g_lastRxFrom != 0 && s != g_lastRxFrom && (uint32_t)(us - g_lastRxUs) < MAC_NEAR_COLL_US) {
    g_mac.col++;
    macEvent("NEAR_COLLISION N%d/N%d %luus", g_lastRxFrom, s, (unsigned long)(us - g_lastRxUs));
  }
  g_lastRxUs = us;
  g_lastRxFrom = s;
}

// [G §4.b] ACK generation: sent immediately (SIFS-like, no backoff) when a unicast arrives
static void macSendAck(const uint8_t* mac, uint8_t to, uint8_t ftype, uint16_t q, uint8_t o) {
  if (g_killed) return;
  char b[110];
  int n = snprintf(b, sizeof(b), "{\"t\":\"ACK\",\"s\":%d,\"d\":%d,\"q\":%u,\"ts\":%lu,\"at\":\"%s\",\"o\":%d}",
                   NODE_ID, to, (unsigned)q, (unsigned long)netNow(), ftName(ftype), o);
  macEnsurePeer(mac);
  esp_now_send(mac, (const uint8_t*)b, n);
  g_ackTxCount++;
  if (IS_SINK) sinkCountTx(FT_ACK);
}

// ---------------------------------------------------------------------------------------------
// [G §4.b] CSMA/CA procedure
// ---------------------------------------------------------------------------------------------
// Step 1: wait until the channel has been idle for DIFS. Returns false on deadline.
static bool macWaitIdleDifs(uint32_t t0, uint32_t deadlineMs, bool logIdle) {
  bool busyLogged = false;
  uint32_t idleStart = micros();
  for (;;) {
    if (macChannelBusy()) {
      if (!busyLogged) { g_mac.busy++; macEvent("CS_BUSY"); busyLogged = true; }
      idleStart = micros();
    } else if ((uint32_t)(micros() - idleStart) >= MAC_DIFS_US) {
      break;
    }
    if (millis() - t0 >= deadlineMs) return false;
    delayMicroseconds(50);
  }
  if (logIdle && !busyLogged) macEvent("CS_IDLE");
  return true;
}

// Send one frame through the MAC. dest = node number (0 = broadcast). Returns MAC_OK / MAC_FAIL /
// MAC_ABORT (nothing sent: no peer, killed, or deadline before the first attempt).
uint8_t macSend(const char* frame, size_t len, uint8_t dest, bool needAck, uint8_t ftype, uint16_t q,
                uint8_t origin, uint32_t deadlineMs) {
  g_macLastRetries = 0;
  if (g_killed || len == 0 || len > FRAME_MAX) return MAC_ABORT;
  uint8_t dmac[6];
  if (dest == 0) { memcpy(dmac, BCAST_MAC, 6); needAck = false; }
  else {
    if (dest > 4 || !g_nodeMacKnown[dest]) return MAC_ABORT;
    nodeMacCopy(dest, dmac);
  }
  if (!macEnsurePeer(dmac)) return MAC_ABORT;
  if (deadlineMs == 0 || deadlineMs > MAC_TX_DEADLINE_MS) deadlineMs = MAC_TX_DEADLINE_MS;
  uint32_t t0 = millis();
  uint8_t retries = 0;
  uint16_t cw = MAC_CW_MIN;
  bool attempted = false;
  for (;;) {
    // 1. CHANNEL SENSING (DIFS)
    if (!macWaitIdleDifs(t0, deadlineMs, true)) {
      macEvent("DEADLINE (%lums)", (unsigned long)deadlineMs);
      if (attempted && needAck) { routeOnTxResult(dest, false); return MAC_FAIL; }
      return attempted ? MAC_FAIL : MAC_ABORT;
    }
    // 2. RANDOM BACKOFF, frozen while the channel is busy (802.11 style)
    uint16_t n = (uint16_t)random(0, cw);
    macEvent("BACKOFF %u slots", (unsigned)n);
    g_macBoUs += (uint32_t)n * MAC_SLOT_US;
    g_mac.bo = g_macBoUs / 1000;
    uint16_t rem = n;
    while (rem > 0) {
      uint32_t s = micros();
      bool busy = false;
      while ((uint32_t)(micros() - s) < MAC_SLOT_US) {
        if (macChannelBusy()) { busy = true; break; }
        delayMicroseconds(20);
      }
      if (busy) {
        g_mac.def++;
        g_mac.busy++;
        macEvent("CS_BUSY/DEFER rem=%u", (unsigned)rem);
        if (!macWaitIdleDifs(t0, deadlineMs, false)) {
          macEvent("DEADLINE (%lums)", (unsigned long)deadlineMs);
          if (attempted && needAck) { routeOnTxResult(dest, false); return MAC_FAIL; }
          return attempted ? MAC_FAIL : MAC_ABORT;
        }
      } else {
        rem--;
      }
    }
    // 3. TRANSMISSION
    if (!attempted) g_mac.tx++; else g_mac.retx++;
    attempted = true;
    if (needAck) {
      g_ackWait.got = false;
      g_ackWait.from = dest; g_ackWait.type = ftype; g_ackWait.q = q; g_ackWait.o = origin;
      g_ackWait.active = true;
    }
    esp_err_t er = esp_now_send(dmac, (const uint8_t*)frame, len);
    if (dest == 0) macEvent("TX %s bcast", ftName(ftype));
    else macEvent("TX %s q=%u ->N%d%s", ftName(ftype), (unsigned)q, dest, retries ? " (retx)" : "");
    if (er != ESP_OK) macEvent("TX_ERR %d", (int)er);
    if (IS_SINK) sinkCountTx(ftype);
    if (!needAck) return (er == ESP_OK) ? MAC_OK : MAC_FAIL;
    // 4. ACK WAIT (other frames keep being processed so this node still ACKs its neighbours)
    uint32_t w = millis();
    while (!g_ackWait.got && (millis() - w) < MAC_ACK_TIMEOUT_MS) {
      rxProcessQueue(1);
      delayMicroseconds(100);
    }
    bool got = g_ackWait.got;
    g_ackWait.active = false;
    if (got) {
      g_mac.ok++;
      macEvent("ACK_OK");
      routeOnTxAttempt(dest, true);
      routeOnTxResult(dest, true);
      return MAC_OK;
    }
    g_mac.to++;
    routeOnTxAttempt(dest, false);
    retries++;
    g_macLastRetries = retries;
    if (retries > MAC_MAX_RETRIES) {
      g_macLastRetries = MAC_MAX_RETRIES;
      macEvent("TX_FAIL after %d retx", MAC_MAX_RETRIES);
      routeOnTxResult(dest, false);         // routing treats it as link-failure evidence
      return MAC_FAIL;
    }
    cw = (uint16_t)wMin(cw * 2, MAC_CW_MAX); // binary exponential backoff
    macEvent("ACK_TIMEOUT → RETX %u (cw=%u)", (unsigned)retries, (unsigned)cw);
  }
}

// ---------------------------------------------------------------------------------------------
// Boot: Wi-Fi STA, channel, ESP-NOW, promiscuous sniffer
// ---------------------------------------------------------------------------------------------
static uint8_t macPickChannel() {
  uint8_t ch = WIFI_CHANNEL;
#if AUTO_CHANNEL_FROM_SSID
  wlogf("WIFI", "scanning for '%s' to adopt its channel ...", UPLINK_SSID);
  int n = WiFi.scanNetworks(false, true);
  int bestRssi = -1000;
  for (int i = 0; i < n; i++) {
    if (strcmp(WiFi.SSID(i).c_str(), UPLINK_SSID) == 0 && WiFi.RSSI(i) > bestRssi) {
      bestRssi = WiFi.RSSI(i);
      ch = (uint8_t)WiFi.channel(i);
    }
  }
  WiFi.scanDelete();
  if (bestRssi > -1000) wlogf("WIFI", "found '%s' on channel %d (rssi %d)", UPLINK_SSID, ch, bestRssi);
  else wlogf("WIFI", "'%s' not found -> fixed WIFI_CHANNEL %d", UPLINK_SSID, WIFI_CHANNEL);
#endif
  return ch;
}

static void macInit() {
  WiFi.mode(WIFI_STA);
  esp_wifi_get_mac(WIFI_IF_STA, g_myMac);
  if (IS_SINK) {
    sinkWifiBoot();                          // N4: join the hotspot, ESP-NOW uses the AP's channel
    uint8_t pch = 0;
    wifi_second_chan_t sc;
    if (esp_wifi_get_channel(&pch, &sc) == ESP_OK && pch) g_channel = pch;
  } else {
    WiFi.disconnect();
    g_channel = macPickChannel();
    esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
  }
  if (esp_now_init() != ESP_OK) wlogf("WIFI", "esp_now_init FAILED");
  esp_now_register_recv_cb(onNowRecv);
  esp_now_register_send_cb(onNowSent);
  macEnsurePeer(BCAST_MAC);
#if CS_USE_PROMISCUOUS
  wifi_promiscuous_filter_t f;
  memset(&f, 0, sizeof(f));
  f.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT | WIFI_PROMIS_FILTER_MASK_DATA;
  esp_wifi_set_promiscuous_filter(&f);
  esp_wifi_set_promiscuous_rx_cb(promiscCb);
  g_promiscOk = (esp_wifi_set_promiscuous(true) == ESP_OK);
#endif
  if (!IS_SINK) esp_wifi_set_channel(g_channel, WIFI_SECOND_CHAN_NONE);
  char ms[18];
  macFmt(g_myMac, ms, sizeof(ms));
  wlogf("WIFI", "STA MAC %s, ESP-NOW on channel %d, channel sensing: %s", ms, g_channel,
        g_promiscOk ? "promiscuous sniffer" : "CS_FALLBACK (virtual carrier sense)");
}
