// =============================================================================================
// AquaSense-WSN  -  ble_loc.h   [G §3 BLE, G §4.a BLE neighbour discovery & localization]
// * Advertising: name "WSN-N<k>", manufacturer data 0xFF 0xFF 'W' 'S' k txPowerRef(int8), 100 ms.
// * Scanning: active, interval 100 ms / window 50 ms, 1 s scans restarted from loop()
//   (non-blocking start(1, cb, false)), paused while the node sleeps (spec §2, §5).
// * Per-neighbour RSSI EMA, log-distance distance estimate, nearest node.
// * Sink (N4): RSSI/distance matrix + weighted-centroid localization + error for all 4 targets.
// =============================================================================================
#pragma once
#include "shared.h"
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <BLEAdvertising.h>
#include <math.h>

struct BleNbr {
  volatile float    ema;      // smoothed RSSI (dBm)
  volatile int8_t   last;     // last raw RSSI
  volatile uint32_t lastMs;   // millis() of last advert
  volatile uint32_t cnt;      // adverts seen
  volatile bool     seen;     // ever seen (EMA initialised)
  bool              reported; // "DISCOVERED" line printed
};
static BleNbr   g_ble[5];
static bool     g_bleEnabled = false;
static BLEScan* g_bleScan = nullptr;
static volatile bool g_bleScanActive = false;
static uint32_t g_bleScanStartMs = 0;
static uint32_t g_bleScanStopMs = 0;
static uint32_t g_bleScans = 0;
static uint32_t g_bleLastPrintMs = 0;

// [G §4.a] RSSI smoothing for one advert (runs in the BT task: only plain stores, no logging)
static void bleHandleAdv(BLEAdvertisedDevice& dev) {
  if (!dev.haveManufacturerData()) return;
  // std::string in core 2.x, String in core 3.x - both provide c_str() / length()
  auto md = dev.getManufacturerData();
  size_t len = md.length();
  if (len < 6) return;
  const uint8_t* p = (const uint8_t*)md.c_str();
  if (p[0] != 0xFF || p[1] != 0xFF || p[2] != 'W' || p[3] != 'S') return;
  uint8_t k = p[4];
  if (k < 1 || k > 4 || k == NODE_ID) return;
  int rssi = dev.getRSSI();
  BleNbr& b = g_ble[k];
  if (!b.seen || (millis() - b.lastMs) > BLE_STALE_MS) b.ema = (float)rssi;
  else b.ema = BLE_EMA_OLD * b.ema + BLE_EMA_NEW * (float)rssi;     // rssi_ema = 0.7*ema + 0.3*rssi
  b.last = (int8_t)rssi;
  b.lastMs = millis();
  b.cnt = b.cnt + 1;
  b.seen = true;
}

// Scan callbacks. Bluedroid in core 2.x AND 3.x declares onResult(BLEAdvertisedDevice) (by value);
// a pointer overload is provided as well so the class also fits a library variant that passes
// BLEAdvertisedDevice*. No 'override' keyword on purpose: whichever one the base declares is the
// override, the other one is a harmless extra overload.
class WsnScanCallbacks : public BLEAdvertisedDeviceCallbacks {
 public:
  void onResult(BLEAdvertisedDevice advertisedDevice) { bleHandleAdv(advertisedDevice); }
  void onResult(BLEAdvertisedDevice* advertisedDevice) { if (advertisedDevice) bleHandleAdv(*advertisedDevice); }
};
static WsnScanCallbacks g_bleCallbacks;

// Scan-complete callback (signature identical in core 2.x and 3.x: void(*)(BLEScanResults))
static void bleScanDoneCB(BLEScanResults results) {
  (void)results;
  g_bleScanActive = false;
}

static bool bleValid(uint8_t k) {
  // FIX: lastMs is written by the BT task on the other core; when it is written between our
  // millis() and the read, the unsigned age wrapped to ~4e9 -> spurious "LOST"/"DISCOVERED" lines
  return k >= 1 && k <= 4 && k != NODE_ID && g_ble[k].seen && (int32_t)(millis() - g_ble[k].lastMs) <= BLE_STALE_MS;
}
static int8_t bleRssi(uint8_t k) { return bleValid(k) ? (int8_t)lroundf(g_ble[k].ema) : 0; }

// [G §4.a] "Estimate approximate distance from RSSI": log-distance path-loss model
//   d_m = 10 ^ ((RSSI_1M - rssi_ema) / (10 * n)), reported in cm, clamped 5..1000
static uint16_t rssiToDistCm(float rssi) {
  float dm = powf(10.0f, ((float)RSSI_1M - rssi) / (10.0f * PATH_LOSS_N));
  int32_t cm = (int32_t)lroundf(dm * 100.0f);
  if (cm < DIST_MIN_CM) cm = DIST_MIN_CM;
  if (cm > DIST_MAX_CM) cm = DIST_MAX_CM;
  return (uint16_t)cm;
}
static uint16_t bleDistCm(uint8_t k) { return bleValid(k) ? rssiToDistCm(g_ble[k].ema) : 0; }

// Nearest node = neighbour with the highest rssi_ema (0 = none)
static uint8_t bleNearest() {
  uint8_t best = 0;
  float br = -1000.0f;
  for (uint8_t k = 1; k <= 4; k++) if (bleValid(k) && g_ble[k].ema > br) { br = g_ble[k].ema; best = k; }
  return best;
}

static void bleInit() {
#if IS_SINK && !SINK_BLE_ENABLE
  wlogf("BLE", "disabled on the sink (SINK_BLE_ENABLE 0)");
  return;
#endif
  char name[8];
  snprintf(name, sizeof(name), "WSN-N%d", NODE_ID);
  BLEDevice::init(name);                                   // BLE first, then Wi-Fi (coexistence)
#if BLE_SET_POWER
  BLEDevice::setPower(ESP_PWR_LVL_P9);
#endif
  // --- advertising: name + manufacturer data 0xFF 0xFF 'W' 'S' k txPowerRef
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  BLEAdvertisementData ad;
  ad.setFlags(0x06);                                       // LE general discoverable, BR/EDR not supported
  ad.setName(name);
  const uint8_t md[6] = { 0xFF, 0xFF, 'W', 'S', (uint8_t)NODE_ID, (uint8_t)((int8_t)RSSI_1M) };
#if WSN_CORE3
  ad.setManufacturerData(String((const char*)md, 6));
#else
  ad.setManufacturerData(std::string((const char*)md, 6));
#endif
  adv->setAdvertisementData(ad);
  adv->setMinInterval((uint16_t)(BLE_ADV_INTERVAL_MS * 1000 / 625));   // units of 0.625 ms
  adv->setMaxInterval((uint16_t)(BLE_ADV_INTERVAL_MS * 1000 / 625));
  adv->start();
  // --- scanning (active, 100/50 ms). wantDuplicates=false: one sample per device per 1 s scan.
  g_bleScan = BLEDevice::getScan();
  g_bleScan->setAdvertisedDeviceCallbacks(&g_bleCallbacks, false);
  g_bleScan->setActiveScan(true);
  g_bleScan->setInterval(BLE_SCAN_INTERVAL_MS);
  g_bleScan->setWindow(BLE_SCAN_WINDOW_MS);
  g_bleEnabled = true;
  wlogf("BLE", "advertising as %s (mfg FF FF 'W' 'S' %d %d), scan %d/%d ms", name, NODE_ID, RSSI_1M,
        BLE_SCAN_INTERVAL_MS, BLE_SCAN_WINDOW_MS);
}

// Scan maintenance from loop(): restart 1 s scans while awake, pause while sleeping.
static void bleService(bool awake) {
  if (!g_bleEnabled || !g_bleScan) return;
  uint32_t now = millis();
  if (!awake) {
    if (g_bleScanActive) {                              // [G §4.d] BLE scan paused in sleep slots
      g_bleScan->stop();
      g_bleScanActive = false;
      g_bleScanStopMs = now;
      // FIX: no clearResults() here: the BT task may still be inside the result map (insert/count of
      // a pending advert) right after stop() -> concurrent std::map access -> heap corruption/crash.
      // start(..., false) clears the map itself, >= 20 ms later.
    }
    return;
  }
  if (g_bleScanActive) {
    if (now - g_bleScanStartMs > (uint32_t)BLE_SCAN_DURATION_S * 1000 + 1500) {   // lost completion event
      g_bleScan->stop();
      g_bleScanActive = false;
      g_bleScanStopMs = now;
    }
    return;
  }
  if (now - g_bleScanStopMs < 20) return;
  g_bleScanActive = true;                                // (start(.., false) frees the previous results)
  if (g_bleScan->start(BLE_SCAN_DURATION_S, bleScanDoneCB, false)) {
    g_bleScanStartMs = now;
    g_bleScans++;
  } else {
    g_bleScanActive = false;
    g_bleScanStopMs = now;
  }
}

// Discovery + RSSI/distance lines for the viva ([G §4.a] discovery, RSSI, distance, nearest)
static void bleLogService() {
  if (!g_bleEnabled) return;
  for (uint8_t k = 1; k <= 4; k++) {
    if (k == NODE_ID) continue;
    bool v = bleValid(k);
    if (v && !g_ble[k].reported) {
      g_ble[k].reported = true;
      wlogf("BLE", "DISCOVERED WSN-N%d rssi=%d dBm", k, (int)g_ble[k].last);
      nodeEvent(EV_BLE, "BLE DISCOVERED N%d", k);
    } else if (!v && g_ble[k].reported) {
      g_ble[k].reported = false;
      wlogf("BLE", "LOST WSN-N%d (no advert for %d s)", k, BLE_STALE_MS / 1000);
    }
  }
  uint32_t now = millis();
  if (now - g_bleLastPrintMs < BLE_PRINT_PERIOD_MS) return;
  g_bleLastPrintMs = now;
  char line[160];
  int n = snprintf(line, sizeof(line), "RSSI/dist:");
  for (uint8_t k = 1; k <= 4 && n < (int)sizeof(line) - 1; k++) {
    if (!bleValid(k)) continue;
    n += snprintf(line + n, sizeof(line) - n, " N%d raw=%d ema=%.1f d=%ucm |", k, (int)g_ble[k].last,
                  (double)g_ble[k].ema, (unsigned)bleDistCm(k));
  }
  uint8_t nr = bleNearest();
  if (nr) snprintf(line + n, sizeof(line) - n, " nearest=N%d", nr);
  else snprintf(line + n, sizeof(line) - n, " (no BLE neighbours yet)");
  wlogf("BLE", "%s", line);
}

// =============================================================================================
// Sink-side localization (spec §8): weighted centroid with w_i = 1/d_i^2
// =============================================================================================
struct LocTarget {
  bool valid; float ex, ey, err;
  uint8_t nAnch; uint8_t anch[3]; uint16_t anchDist[3];
};
static LocTarget g_loc[5];
static int8_t    g_bleMatRssi[5][5];      // [from][to] as reported by 'from' (STAT.ble) or measured by N4
static uint16_t  g_bleMatDist[5][5];
static uint32_t  g_bleMatMs[5][5];        // millis() of the report (0 = never)
static uint8_t   g_nearestOf[5];          // STAT.near of every node

static void locSetPair(uint8_t from, uint8_t to, int8_t rssi, uint16_t dist) {
  if (from < 1 || from > 4 || to < 1 || to > 4 || from == to) return;
  g_bleMatRssi[from][to] = rssi;
  g_bleMatDist[from][to] = dist;
  g_bleMatMs[from][to] = millis();
}
static bool locFresh(uint8_t a, uint8_t b) { return g_bleMatMs[a][b] != 0 && (millis() - g_bleMatMs[a][b]) <= LOC_MATRIX_FRESH_MS; }

// Distance between i and k = average of both directions when both are reported, else the one available
static uint16_t locPairDist(uint8_t i, uint8_t k) {
  bool a = locFresh(i, k), b = locFresh(k, i);
  if (a && b) return (uint16_t)((g_bleMatDist[i][k] + g_bleMatDist[k][i] + 1) / 2);
  if (a) return g_bleMatDist[i][k];
  if (b) return g_bleMatDist[k][i];
  return 0;
}

static void locCompute() {
  // own row (N4's BLE view)
  for (uint8_t k = 1; k <= 4; k++) if (k != NODE_ID && bleValid(k)) locSetPair(NODE_ID, k, bleRssi(k), bleDistCm(k));
  g_nearestOf[NODE_ID] = bleNearest();
  for (uint8_t k = 1; k <= 4; k++) {
    LocTarget& L = g_loc[k];
    L.valid = false; L.nAnch = 0;
    float sw = 0, sx = 0, sy = 0;
    for (uint8_t i = 1; i <= 4; i++) {
      if (i == k) continue;
      uint16_t d = locPairDist(i, k);
      if (d == 0) continue;
      float w = 1.0f / ((float)d * (float)d);
      sw += w; sx += w * NODE_POS[i][0]; sy += w * NODE_POS[i][1];
      L.anch[L.nAnch] = i; L.anchDist[L.nAnch] = d; L.nAnch++;
    }
    if (L.nAnch >= 2 && sw > 0) {
      L.ex = sx / sw; L.ey = sy / sw;
      float dx = L.ex - NODE_POS[k][0], dy = L.ey - NODE_POS[k][1];
      L.err = sqrtf(dx * dx + dy * dy);
      L.valid = true;
    }
  }
}

static void locPrint(bool all) {
  for (uint8_t k = 1; k <= 4; k++) {
    if (!all && k != 1) continue;               // demo target is N1
    const LocTarget& L = g_loc[k];
    if (!L.valid) { if (k == 1) wlogf("LOC", "N1 not enough anchors yet (%d)", L.nAnch); continue; }
    wlogf("LOC", "N%d est=(%.1f,%.1f) true=(%d,%d) err=%.1fcm anchors=%d", k, (double)L.ex, (double)L.ey,
          NODE_POS[k][0], NODE_POS[k][1], (double)L.err, L.nAnch);
  }
}

static void locReset() {
  memset(g_bleMatMs, 0, sizeof(g_bleMatMs));
  memset(g_loc, 0, sizeof(g_loc));
}
