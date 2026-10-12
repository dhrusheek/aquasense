// =============================================================================================
// AquaSense-WSN  -  aggregation.h   [G §4.e data aggregation at the cluster head N3]
// Window = one superframe. N3 keeps the latest DATA per origin + window statistics
// (count / mean / min / max) and sends ONE AGG frame per window in its own slot (spec §7).
// Aggregation function = latest-value fusion + window statistics + OR-fused alert flag th (if
// ANY DATA of an origin in the window had th = 1, the window's th is 1; flags are never
// averaged, and different quantities are never averaged across nodes). n3.v = N3's own on-chip
// temperature x100. Byte / packet accounting + cumulative counters for STAT.agg.
// =============================================================================================
#pragma once
#include "shared.h"

struct AggOrigin { uint16_t cnt; int32_t v; uint16_t q; uint32_t ts; int64_t sum; int32_t mn, mx; uint8_t th; char p[20]; };
static AggOrigin g_aggWin[3];                   // index 1 = N1, 2 = N2
static uint16_t  g_aggIn = 0;                   // DATA frames received in this window
static uint32_t  g_aggBi = 0;                   // their byte lengths
static uint32_t  g_aggCumIn = 0, g_aggCumOut = 0, g_aggCumBi = 0, g_aggCumBo = 0;

// DATA frame arrived at N3 (already ACKed and de-duplicated)
static void aggOnData(uint8_t o, int32_t v, uint8_t th, uint16_t q, uint32_t ts, const char* path, uint8_t len) {
  if (o != 1 && o != 2) return;
  AggOrigin& a = g_aggWin[o];
  if (a.cnt == 0) { a.sum = 0; a.mn = v; a.mx = v; a.th = 0; }
  if (th) a.th = 1;                                               // OR-fused over the window
  a.cnt++;
  a.sum += v;
  if (v < a.mn) a.mn = v;
  if (v > a.mx) a.mx = v;
  a.v = v; a.q = q; a.ts = ts;
  snprintf(a.p, sizeof(a.p), "%s>%d", path, NODE_ID);
  g_aggIn++;
  g_aggBi += len;
  wlogf("AGG", "buffer N%u v=%ld th=%u q=%u path %s (window in=%u, %lu B)", (unsigned)o, (long)v, (unsigned)th, (unsigned)q, a.p,
        (unsigned)g_aggIn, (unsigned long)g_aggBi);
}

// level 0: full stats always; 1: mean/min/max only when cnt>1 (sink expands cnt==1 -> =v);
// 2: like 1 without per-origin path; 3: no stats, no path. Used only to stay <= 250 bytes.
// th (the OR-fused alert flag) is kept at EVERY level: it drives the sink's status light.
// The per-origin path p is left out when it is the direct path "<o>>3" (the sink rebuilds it),
// so the common window (cnt 1, direct paths) fits at level 1 and an alternate path "1>2>3" too.
static size_t aggBuild(char* out, size_t cap, uint8_t nh, uint16_t q, uint16_t bo, uint8_t level, int32_t n3v, uint8_t red) {
  JSON_DOC(doc, 1024);
  doc["t"] = "AGG"; doc["s"] = NODE_ID; doc["d"] = nh; doc["q"] = q; doc["ts"] = netNow();
  doc["o"] = NODE_ID; doc["w"] = tdmaCurrentSf(); doc["in"] = g_aggIn; doc["bi"] = g_aggBi; doc["bo"] = bo;
  for (uint8_t o = 1; o <= 2; o++) {
    const AggOrigin& a = g_aggWin[o];
    if (a.cnt == 0) continue;
    JsonObject x = JSON_ADD_OBJ(doc, o == 1 ? "n1" : "n2");
    x["v"] = a.v; x["q"] = a.q; x["ts"] = a.ts; x["cnt"] = a.cnt;
    if (level == 0 || (level <= 2 && a.cnt > 1)) {
      x["mean"] = (int32_t)((a.sum + (int64_t)a.cnt / 2) / a.cnt);
      x["min"] = a.mn; x["max"] = a.mx;
    }
    x["th"] = a.th;
    char direct[8];
    snprintf(direct, sizeof(direct), "%u>%d", (unsigned)o, NODE_ID);
    if (level < 2 && strcmp(a.p, direct) != 0) x["p"] = (const char*)a.p;
  }
  doc["n3"]["v"] = n3v;
  doc["p"] = "3"; doc["hop"] = 1; doc["ttl"] = ROUTE_DATA_TTL; doc["red"] = red;
  if (measureJson(doc) > FRAME_MAX) return 0;
  return serializeJson(doc, out, cap);
}

// [G §4.e] build + send the window's AGG frame (N3 slot). Returns MacResult or 255 (nothing to send).
uint8_t aggSendWindow(uint32_t dl) {
  uint32_t w = tdmaCurrentSf();
  if (g_aggIn == 0) {
    wlogf("AGG", "window %lu: no DATA received -> no AGG this superframe", (unsigned long)w);
    return 255;
  }
  uint8_t nh = routeNextHop();
  if (!nh) { wlogf("AGG", "window %lu: no route to sink, AGG kept for next window", (unsigned long)w); return MAC_ABORT; }
  int32_t n3v = readSensor();                                    // N3 on-chip temperature x100 (-1 = NaN)
  uint8_t red = (uint8_t)((g_aggIn - 1) * 100UL / g_aggIn);       // (in-1)/in*100
  uint16_t q = (uint16_t)(g_seqAgg + 1);
  char out[FRAME_MAX + 8];
  size_t n = 0;
  uint8_t level = 0;
  for (; level <= 3; level++) {
    uint16_t bo = 0;
    for (int it = 0; it < 4; it++) {                                // bo = length of the AGG frame itself
      n = aggBuild(out, sizeof(out), nh, q, bo, level, n3v, red);
      if (n == 0 || n == bo) break;
      bo = (uint16_t)n;
    }
    if (n) break;
  }
  if (!n) { wlogf("AGG", "frame too large, window dropped"); return MAC_ABORT; }
  g_seqAgg = q;
  uint8_t r = macSend(out, n, nh, true, FT_AGG, q, NODE_ID, dl);
  g_txDataCount++;
  g_aggCumIn += g_aggIn; g_aggCumOut += 1; g_aggCumBi += g_aggBi; g_aggCumBo += n;
  uint32_t byteRed = g_aggBi ? (g_aggBi > n ? (g_aggBi - n) * 100UL / g_aggBi : 0) : 0;
  wlogf("AGG", "in=%u bytes %lu->%u red=%u%% (bytes %lu%%) w=%lu n1(cnt %u th %u) n2(cnt %u th %u) n3=%ld", (unsigned)g_aggIn,
        (unsigned long)g_aggBi, (unsigned)n, (unsigned)red, (unsigned long)byteRed, (unsigned long)w,
        (unsigned)g_aggWin[1].cnt, (unsigned)g_aggWin[1].th, (unsigned)g_aggWin[2].cnt, (unsigned)g_aggWin[2].th, (long)n3v);
  if (r == MAC_OK) wlogf("TX", "AGG q=%u -> N%u (ACK ok, %u retx)%s", (unsigned)q, (unsigned)nh, (unsigned)g_macLastRetries, level ? " [compact]" : "");
  else wlogf("TX", "AGG q=%u -> N%u FAILED (%s)", (unsigned)q, (unsigned)nh, r == MAC_FAIL ? "no ACK" : "aborted");
  memset(g_aggWin, 0, sizeof(g_aggWin));                           // next window
  g_aggIn = 0;
  g_aggBi = 0;
  return r;
}

void aggResetStats() { g_aggCumIn = g_aggCumOut = g_aggCumBi = g_aggCumBo = 0; }
