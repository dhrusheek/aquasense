// =============================================================================================
// AquaSense-WSN  -  config.h
// ALL tunables of the firmware. Values mirror docs/PROTOCOL_SPEC.md (the shared contract).
// Flash the SAME sketch to all four boards; only NODE_ID changes (1..4).
// =============================================================================================
#pragma once

// ---------------------------------------------------------------------------------------------
// [G §2] Node identity (spec §1, §1.2):
//   1 = N1 sensor node: ESP32 on-chip temperature sensor (no wiring), over-temperature alert TEMP_WARN
//   2 = N2 sensor / relay: turbidity module (LM393 board: A -> GPIO34, D -> GPIO27)
//   3 = N3 cluster head / aggregator / router / scheduler: ESP32 on-chip temperature sensor
//   4 = N4 sink / gateway: pond status light (green GPIO25, red GPIO27)
// ---------------------------------------------------------------------------------------------
#ifndef NODE_ID
#define NODE_ID 1
#endif

#define IS_SINK   (NODE_ID == 4)
#define IS_CH     (NODE_ID == 3)
#define IS_MEMBER (NODE_ID == 1 || NODE_ID == 2)

#if (NODE_ID < 1) || (NODE_ID > 4)
#error "NODE_ID must be 1, 2, 3 or 4"
#endif

// ---------------------------------------------------------------------------------------------
// [G §3] Sink uplink (N4 only): laptop mobile hotspot + dashboard server (spec §9.1)
// ---------------------------------------------------------------------------------------------
#define UPLINK_SSID              "your-hotspot-name"
#define UPLINK_PASS              "your-hotspot-password"
#define UPLINK_URL               "http://192.168.137.1:5050/api/data"   // server PORT = 5050 (spec §9.2)
#define UPLINK_HTTP_TIMEOUT_MS   700      // HTTP read timeout (POST runs in a quiet slot of N4)
#define UPLINK_CONNECT_TIMEOUT_MS 400     // TCP connect timeout
#define UPLINK_BOOT_WAIT_MS      10000    // N4 waits this long at boot for the hotspot
#define UPLINK_RETRY_MS          30000    // retry period when the hotspot was never reached
#define UPLINK_ATTEMPT_MS        8000     // one (re)connect attempt lasts at most this long
#define SINK_SERIAL_JSON         1        // also print the uplink as one line "JSON:{...}" (serial_bridge.py)
#define SINK_UPLINK_LOG_MAX      40       // newest entries of mac_log / msg_log / events per uplink (spec: <= 60)
#define SINK_UPLINK_BUF          20480    // static uplink JSON buffer on N4 (bytes)
#define SINK_BLE_ENABLE          1        // 0 = N4 skips BLE (frees radio time; N4 is then no BLE anchor)
#define SINK_WIFI_UPLINK         1        // 0 = N4 never joins the hotspot: serial_bridge.py only, ESP-NOW radio never leaves the WSN channel

// ---------------------------------------------------------------------------------------------
// [G §3] Wi-Fi / ESP-NOW radio (spec §2)
// ---------------------------------------------------------------------------------------------
#define WIFI_CHANNEL             1        // fixed ESP-NOW channel (fallback)
#define AUTO_CHANNEL_FROM_SSID   1        // 1 = N1..N3 scan for UPLINK_SSID at boot and adopt its channel
#define CS_USE_PROMISCUOUS       1        // 1 = physical channel sensing with the promiscuous sniffer

// ---------------------------------------------------------------------------------------------
// [G §2] Sensors and actuators (spec §1, §1.2, §9.3). No external library: ADC, GPIO and the
// on-chip temperature sensor all come with the ESP32 core.
// ---------------------------------------------------------------------------------------------
// N1: ESP32 on-chip temperature sensor (temperatureRead(), uncalibrated, no wiring), v = degC x100,
//     -1 if NaN; th = 1 when v >= TEMP_WARN
#define TEMP_WARN_C100           6000     // 60.00 °C; changed at run time by CTRL TEMP_WARN
// N2: turbidity module (LM393 adapter board, header G A D V, powered from 3V3)
#define TURB_ADC_PIN             34       // A -> GPIO34 (input-only ADC1_CH6, 11 dB, 12 bit)
#define TURB_DOUT_PIN            27       // D -> GPIO27 (INPUT_PULLUP, LM393 comparator output)
#define TURB_DOUT_ACTIVE_LOW     1        // 1: th = 1 when D reads LOW; set 0 if the board's D LED shows the opposite
#define SENSOR_ADC_SAMPLES       4        // analogRead() samples averaged per reading
// N3: ESP32 on-chip temperature sensor (temperatureRead(), uncalibrated), v = degC x100, -1 if NaN
// N4: pond status light, two LEDs (red, green), each GPIO -> series resistor -> LED anode, cathode -> GND
#define LED_GREEN_PIN            25       // green  = all nominal (blinking = stale, no data)
#define LED_RED_PIN              27       // red    = water turbid (blinking = N1 enclosure hot)
#define LIGHT_STALE_SF           3        // no AGG and no DATA for 3 superframes -> "stale" (green blinking)
#define LIGHT_TEST_MS            1000     // LIGHT_TEST: red -> green, 1000 ms each
#define LIGHT_BLINK_MS           500      // blink half-period ("stale" and "hot")

// ---------------------------------------------------------------------------------------------
// [G §4.a] BLE discovery / RSSI / distance / localization (spec §2, §8)
// ---------------------------------------------------------------------------------------------
#define BLE_ADV_INTERVAL_MS      100      // advertising interval
#define BLE_SCAN_INTERVAL_MS     100      // active scan interval
#define BLE_SCAN_WINDOW_MS       50       // active scan window
#define BLE_SCAN_DURATION_S      1        // one scan = 1 s, restarted from loop() (non-blocking)
#define BLE_SET_POWER            1        // 1 = BLEDevice::setPower(ESP_PWR_LVL_P9)
#define BLE_EMA_OLD              0.7f     // rssi_ema = 0.7*rssi_ema + 0.3*rssi
#define BLE_EMA_NEW              0.3f
#define BLE_STALE_MS             10000    // a BLE neighbour not heard for this long is dropped
#define BLE_PRINT_PERIOD_MS      6000     // "[Nk BLE] RSSI ..." line period
#define RSSI_1M                  (-59)    // dBm at 1 m (calibrated on the lab table)
#define PATH_LOSS_N              2.2f     // path-loss exponent
#define DIST_MIN_CM              5        // distance clamp (cm)
#define DIST_MAX_CM              1000
#define LOC_MATRIX_FRESH_MS      15000    // sink: matrix entries older than this are ignored

// ---------------------------------------------------------------------------------------------
// [G §4.b] Wi-Fi MAC: CSMA/CA + ACK + timeout + BEB retransmission (spec §4)
// ---------------------------------------------------------------------------------------------
#define MAC_SLOT_US              1000     // backoff slot time
#define MAC_DIFS_US              2000     // channel idle this long before TX / before counting down
#define MAC_CW_MIN               4        // contention window (slots)
#define MAC_CW_MAX               32
#define MAC_ACK_TIMEOUT_MS       40
#define MAC_MAX_RETRIES          3
#define MAC_CS_BUSY_US           3000     // busy if an ESP-NOW/DATA frame was sniffed in the last 3 ms
#define MAC_TX_DEADLINE_MS       400      // whole procedure must finish within this (fits a slot)
#define MAC_NEAR_COLL_US         5000     // two frames from different senders < 5 ms apart = NEAR_COLLISION
#define MAC_EVT_RING             32       // MAC event ring buffer (us timestamps)
#define MAC_SLOT_END_MARGIN_MS   15       // never start a frame closer than this to the slot end
#define MAC_LOG_VERBOSE          1        // 1 = print every MAC event line ([Nk MAC] ...)

// ---------------------------------------------------------------------------------------------
// [G §4.d] Dynamic TDMA + sleep/wake (spec §5)
// ---------------------------------------------------------------------------------------------
#define TDMA_SLOT_MS             500
#define TDMA_SLOTS               6
#define TDMA_SF_MS               (TDMA_SLOT_MS * TDMA_SLOTS)   // 3000 ms superframe
#define TDMA_GUARD_MS            20       // TX starts at slot start + random(0..20) ms
#define TDMA_SCHED_RELAY_MS      60       // N2 re-broadcasts SCHED once at +60 ms (r:1)
#define TDMA_BACKUP_AFTER_SF     3        // N4 becomes backup scheduler after 3 silent superframes
#define TDMA_BOOT_LISTEN_MS      4500     // N3 listens this long at boot for an existing (backup) SCHED
#define TDMA_LEFT_AFTER_SF       3        // rule 1: member not heard for 3 SF loses its slot
#define TDMA_RETX_HIGH_PCT       20       // rule 3: timeout ratio > 20 % -> extra retransmission slot
#define TDMA_RETX_LOW_PCT        5        //         ratio < 5 % -> slot released
#define TDMA_RETX_WINDOW_SF      3        //         ratio window (superframes)
#define TDMA_RETX_MIN_ATTEMPTS   4        //         minimum attempts in the window before deciding
#define TDMA_HELLO_MIN_MS        150      // HELLO inside CONTROL slot at +150..350 ms (contention)
#define TDMA_HELLO_MAX_MS        350
#define TDMA_HELLO_URGENT_MS     40       // HELLO after a route change goes out early in the slot
#define TDMA_CTRL_OFFSET_MS      25       // N4 sends CTRL at CONTROL slot start + 25 ms
#define TDMA_CT_LEAD_MS          1500     // CONTENTION_TEST: at >= now + 1.5 s ...
#define TDMA_CT_OFFSET_MS        100      // ... rounded into the next CONTROL slot (+100 ms)
#define TDMA_HISTORY             12       // sink: schedule (ver, why, t) history entries
#define USE_LIGHT_SLEEP          0        // 1 = esp_light_sleep_start() in sleep slots (N1/N2 only)
#define LED_PIN                  2        // onboard LED: ON = awake, OFF = sleeping slot

// ---------------------------------------------------------------------------------------------
// [G §4.f] Adaptive multi-hop routing (spec §6)
// ---------------------------------------------------------------------------------------------
#define ROUTE_HELLO_TIMEOUT_MS   (3 * TDMA_SF_MS)   // 9000 ms without HELLO -> LINK_DOWN
#define ROUTE_FAIL_CONSEC        2        // two unicast frames exhausted MAC_MAX_RETRIES -> LINK_DOWN
#define ROUTE_RECOVER_HELLOS     2        // HELLOs needed to bring a failed link back up
#define ROUTE_ACK_WINDOW         20       // ackOk/ackFail sliding window (halved every 20 attempts)
#define ROUTE_MEMBER_CH_PENALTY  20       // members prefer the cluster head (aggregation-aware)
#define ROUTE_RSSI_KNEE          (-70)    // RSSI penalty below -70 dBm
#define ROUTE_DATA_TTL           4        // DATA/AGG ttl
#define ROUTE_LINK_FAIL_DEFAULT_S 40      // LINK_FAIL with dur 0
#define NODE_KILL_DEFAULT_S      30       // NODE_KILL with dur 0
#define FWD_QUEUE_LEN            10       // relay forwarding queue (frames)
#define FWD_MAX_ATTEMPTS         2        // a queued frame is dropped after 2 failed slots

// ---------------------------------------------------------------------------------------------
// [G §2 / §8] Ground-truth layout (cm) and logical topology (simulated radio range, spec §2)
// Index 0 is unused so that NODE_POS[k] / ALLOWED[a][b] use node numbers directly.
// ---------------------------------------------------------------------------------------------
#define NODE_POS_TABLE   { {0, 0}, {50, 30}, {0, 0}, {120, 0}, {60, 90} }
//                         -        N1        N2      N3        N4
#define ALLOWED_TABLE    { {0,0,0,0,0},  \
                           {0,0,1,1,0},  /* N1: N2, N3      */ \
                           {0,1,0,1,1},  /* N2: N1, N3, N4  */ \
                           {0,1,1,0,1},  /* N3: N1, N2, N4  */ \
                           {0,0,1,1,0} } /* N4: N2, N3      */

// ---------------------------------------------------------------------------------------------
// Serial console
// ---------------------------------------------------------------------------------------------
#define SERIAL_BAUD              115200
#define SERIAL_TABLE_PERIOD_MS   10000    // periodic node table (like the reference gateway code)
#define SERIAL_VERBOSE_RX        0        // 1 = print every received HELLO/SCHED line
