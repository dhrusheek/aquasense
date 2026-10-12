# AquaSense-WSN firmware (`wsn_node`)

This is one Arduino sketch for all four ESP32 boards. You pick the role with `NODE_ID` in
`config.h`. The binding contract is `docs/PROTOCOL_SPEC.md`. Guideline items are tagged
`[G §x]` in the source.

| File | Purpose |
|------|---------|
| `wsn_node.ino` | `setup()`/`loop()`, RX dispatcher, slot jobs (DATA / STAT / HELLO / CTRL), contention test, node table |
| `config.h` | every tunable (`NODE_ID`, uplink, channel, sensor and LED pins, MAC, TDMA, routing, BLE model, positions, topology) |
| `shared.h` | shared types and state, core-version guards, logging, cross-module forward declarations |
| `sensors.h` | N1 on-chip temperature (`temperatureRead()` x100, `-1` if NaN) with the over-temperature flag `th` (`v >= TEMP_WARN`, default `TEMP_WARN_C100` = 60.00 °C, changed by CTRL `TEMP_WARN`), N2 turbidity (`analogRead(34)` 4-sample mean + LM393 flag `D` on GPIO27), N3 on-chip temperature (`temperatureRead()` x100, `-1` if NaN) |
| `ble_loc.h` | BLE advertising/scanning, RSSI EMA, log-distance distance, nearest node, sink localization |
| `mac.h` | ESP-NOW, peers, sniffer channel sensing, CSMA/CA `macSend()`, ACK, duplicates, MAC counters and events |
| `routing.h` | neighbour table, HELLO, cost metric, next hop and alternate, failure detection and recovery, forwarding queue, LINK_FAIL |
| `tdma.h` | time sync, superframe/slot state machine, sleep/wake, scheduler (5 rules), SCHED |
| `aggregation.h` | N3 window buffer, AGG frame (window stats + OR-fused `th`), byte/packet reduction counters |
| `sink.h` | N4: PDR, delay, logs, §9.1 uplink JSON, HTTP POST, command queue, `JSON:` / `CMD:` serial, pond status light (§9.3) and `LIGHT_TEST` |

## 1. Flashing the four boards

1. In `config.h`, set `#define NODE_ID 1` (then 2, 3 and 4 for the other boards).
2. On N4 only, also check `UPLINK_SSID`, `UPLINK_PASS` and `UPLINK_URL`. The defaults are
   `LAPTOP-HOTSPOT` / `12345678` / `http://192.168.137.1:5050/api/data`. Use the laptop's hotspot
   IP (on Windows this is usually `192.168.137.1`) and dashboard port 5050.
3. Flash each board. Label the boards N1..N4.

### Arduino IDE settings

| Setting | Value |
|---------|-------|
| Board | **ESP32 Dev Module** (esp32 by Espressif, core **2.0.14+ or 3.x**; tested to compile on 2.0.17 and 3.3.12) |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)**. BLE + Wi-Fi + HTTP + JSON is about 1.7-1.85 MB and does not fit the default 1.2 MB |
| Upload Speed | 921600 (use 460800 or 115200 if uploads fail) |
| CPU Frequency | 240 MHz |
| Core Debug Level | None |
| Serial Monitor | **115200 baud**, "Both NL & CR" (or "Newline") |

### Libraries (Library Manager)

* **ArduinoJson** 6.x or 7.x (both supported through `JSON_DOC` / `JSON_ADD_*` macros). This is the
  only library to install.
* Everything else comes with the ESP32 core: BLE (`BLEDevice.h`; do **not** install a separate
  "ESP32 BLE Arduino" library), Wi-Fi / ESP-NOW / HTTPClient, `analogRead()` and
  `temperatureRead()`.

## 2. Wiring

Exact pins from `docs/PROTOCOL_SPEC.md` §1 (the step-by-step breadboard guide is
`docs/HARDWARE_SETUP.md`):

```
N1 (sensor node)             no wiring: temperature comes from the ESP32 die sensor (USB power only)

N2 (turbidity module)        ESP32
  V  ----------------------> 3V3     (NEVER VIN/5 V: at 5 V the A and D outputs exceed 3.3 V)
  G  ----------------------> GND
  A  ----------------------> GPIO34  (input-only ADC1_CH6, attenuation 11 dB -> 0..~3.1 V, 12 bit)
  D  ----------------------> GPIO27  (INPUT_PULLUP; LM393 comparator output, threshold = trimmer pot)
  probe 1/2/3/4 -----------> board 1/2/3/4 (straight through, four female-female jumpers)

N3 (cluster head)            no wiring: temperature comes from the ESP32 die sensor

N4 (sink + status light)     ESP32                         Breadboard
  GPIO25 ---- resistor ---- GREEN  LED anode (long leg)   cathode (short leg) -> GND rail
  GPIO27 ---- resistor ---- RED    LED anode              cathode -> GND rail
  GND    ----------------------------------------------> GND rail
  USB    ----------------------------------------------> laptop (power + Serial 115200 + optional serial bridge)
  Wi-Fi STA -------------------------------------------> laptop mobile hotspot (2.4 GHz) -> HTTP POST http://<laptop-ip>:5050/api/data
```

What each node reports (spec §1.2): N1 `v` = die temperature in °C x100 (`u:"temp"`,
uncalibrated; it stands for the pond-edge enclosure temperature), `th` = 1 when `v >= TEMP_WARN`.
`TEMP_WARN` starts at `TEMP_WARN_C100` = 6000 (60.00 °C), is changed at run time from the
dashboard (CTRL `TEMP_WARN{a:1, v}`, clamped to 0..15000), goes back to 60.00 °C on
`RESET_STATS` or a reboot, and N1 reports it in STAT `tw` (uplink `nodes[0].temp_warn`). The chip
rarely passes 60 °C in a lab, so the alert is shown by setting `TEMP_WARN` just below the live
reading. N2 `v` = raw ADC 0..4095 (`u:"turb"`), `th` = 1 while the LM393 output `D` is LOW (its
board LED lights up; set the switching point with the trimmer pot). N3 `v` = die temperature in
°C x100 (`u:"temp"`, uncalibrated). N4 status light (two LEDs, spec §9.3): green = all nominal,
red = turbidity threshold (`red`), red blinking = N1 enclosure hot while the water is not turbid
(`hot`), green blinking = no data for 3 superframes (`stale`), both off = no data received yet
(`off`). The light follows the freshest flag the sink holds for each node, whether it arrived in
an AGG from N3 or in a DATA frame that reached N4 directly (N2 routing `2>4`), so a turbid
reading that bypasses N3 still turns it red.

The onboard LED (GPIO2) is ON while the node is awake and OFF in sleep slots. It stays OFF
while the node is killed by `NODE_KILL`.

Ground-truth positions for localization, in cm (`NODE_POS_TABLE`): N2 (0,0), N3 (120,0),
N4 (60,90), N1 (target) (50,30). Place the boards on the table at these positions.

## 3. Start-up order

Any order works. The recommended order is:

1. Start the laptop hotspot (2.4 GHz band) and the dashboard server on port 5050.
2. Power **N4**. It joins the hotspot within 10 s and prints its IP and channel.
3. Power **N3**. It listens for 4.5 s, then becomes the scheduler (`MASTER N3: initial schedule v1`).
4. Power **N1** and **N2**. They pick up the hotspot channel, sync on the first SCHED, and start
   using their slots.

If N4 is up and N3 is missing for 3 superframes (9 s), N4 becomes the backup scheduler (`m:4`).
It yields as soon as N3 sends a SCHED again.

## 4. Reading the serial output (viva walk-through)

Every line is `[N<k> <MODULE>] ...`. The table below maps the 17-step demo to the lines you can point at.

| Demo step | Lines to show |
|-----------|---------------|
| BLE discovery | `[N1 BLE] DISCOVERED WSN-N3 rssi=-58 dBm` |
| RSSI measurement / distance | `[N1 BLE] RSSI/dist: N2 raw=-63 ema=-62.4 d=56cm \| ... nearest=N3` |
| Localization + error | `[N4 LOC] N1 est=(46.2,33.9) true=(50,30) err=5.4cm anchors=3` |
| Wi-Fi initialization | `[N1 WIFI] found 'LAPTOP-HOTSPOT' on channel 6`, `STA MAC ..., ESP-NOW on channel 6, channel sensing: promiscuous sniffer` |
| Dynamic schedule assignment | `[N3 SCHED] MASTER N3: initial schedule v1 slots=[3,1,2,3,0,255]`, `[N1 SCHED] RX v2 ... why="retx slot for N1"` |
| Channel sensing | `[N1 MAC] CS_IDLE` / `[N1 MAC] CS_BUSY` |
| Random backoff | `[N1 MAC] BACKOFF 3 slots`, `[N2 MAC] CS_BUSY/DEFER rem=2` |
| Scheduled transmission / sleep | `[N1 TDMA] sf=41 slot 1 OWN (v3) -> DATA+STAT at +12ms`, `[N1 TDMA] ... SLEEP (no TX, BLE paused, LED off)` |
| Unicast + ACK | `[N1 TX] DATA seq=12 v=4778 temp th=0 -> N3 (ACK ok, 0 retx)`, `[N3 RX] DATA q=12 origin N1 from N1 v=4778 th=0 ... -> ACK sent` |
| Broadcast | `[N3 TX] SCHED bcast sf=41 v3 ...`, `[N2 TX] HELLO bcast h=2 nh=N3 c=20` |
| Retransmission | `[N1 MAC] ACK_TIMEOUT → RETX 1 (cw=8)` |
| Data aggregation | `[N3 AGG] buffer N1 v=4778 th=0 ...`, `[N3 AGG] in=2 bytes 196->172 red=50% ... n1(cnt 1 th 0) n2(cnt 1 th 0) n3=4812` |
| Multi-hop path | `[N4 SINK] AGG q=40 ... path 3>4 \| N1=4778 th0 N2=2610 th0 N3=4812 ...`, route `1>3>4` in the sink table |
| Sink actuation (status light) | `[N4 LIGHT] green: all nominal`; dashboard TEMP_WARN set below the live N1 reading (e.g. 45.00 °C) -> `[N4 CMD] queued TEMP_WARN a=1 b=0 dur=0 v=4500 ...`, `[N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)`, `[N4 SINK] N1 TEMP_WARN 45.00 C (STAT tw=4500)`, `[N4 LIGHT] hot: N1 enclosure hot` (red blinking); dashboard "Light test" -> `[N4 CMD] LIGHT_TEST ...`, `[N4 LIGHT] LIGHT_TEST from dashboard: red -> green, 1000 ms each ...`, `[N4 LIGHT] test: LIGHT_TEST` |
| Link failure (dashboard "Link fail N1-N3") | `[N1 CTRL] LINK_FAIL N1-N3 for 40 s ...`, then `[N1 MAC] TX_FAIL after 3 retx` |
| Failure detection + alternate route | `[N1 ROUTE] LINK_DOWN N3 (2 frames unACKed) -> next hop N2 (cost 30) [ALTERNATE ROUTE]` |
| Delivery via alternate | `[N2 FWD] DATA q=15 origin N1 -> N3 (ACK ok, 0 retx) path 1>2`, sink route `1>2>3>4` |
| Route recovery | `[N1 ROUTE] LINK_UP N3 (HELLOs resumed)`, `[N1 ROUTE] ROUTE RESTORED N2 -> N3 cost 50 -> 40` |
| Contention test | `[N1 MAC] CONTENTION_TEST T=... timeline:` followed by `+0us CS_IDLE`, `+2050us BACKOFF 1 slots`, `+3100us TX DATA ...` |
| Performance | `[N4 TABLE]` (PDR, loss, delay, route per node) and the dashboard |

Every `SERIAL_TABLE_PERIOD_MS` (10 s) each node prints a `[Nk TABLE]` block: schedule,
route, duty cycle, the neighbour table (known / link / Wi-Fi RSSI / BLE RSSI / distance /
hops / next hop / ACK% / cost / HELLO age) and the MAC counters. N4 also prints the
reference-style sink table (value, seq, rx, lost, PDR, delay, route) plus the localization of
all four nodes.

N4 also prints one very long line per superframe starting with `JSON:`. This is the uplink
object for `server/serial_bridge.py`, used when the hotspot is unavailable:
`python serial_bridge.py --port /dev/cu.usbserial-XXXX`. The bridge writes dashboard commands
back as `CMD:{...}` lines. You can also type a command into the Serial Monitor of N4, e.g.
`CMD:{"c":"LINK_FAIL","a":1,"b":3,"dur":40,"id":901}` or `CMD:{"c":"TEMP_WARN","a":1,"v":4500}`.

## 5. Implementation notes (all within the spec)

These are internal choices. None of them changes a field name or parameter of the spec, and
the uplink JSON is exactly §9.1.

* **STAT is sent as up to four parts (`pt` 1..4)** so that each ESP-NOW payload stays at or
  under 250 bytes, which the full field list of §3 cannot fit in one frame:
  * `pt1`: `mac`, `tdma`
  * `pt2`: `rt`, `ble`, `near` (+ `agg` on N3)
  * `pt3`: `tx`, `fw`, `oor`, `up`, `tw` (N1 only: current TEMP_WARN, °C x100), `ev` (the
    last <= 4 new events) and `me` (the newest MAC events as `[age_ms, "text"]`, which feed the
    sink's `mac_log`)
  * `pt4`: only after a contention test, with `cta` (= T) and `ev` (the µs timeline)

  The sink merges the parts. Field names are the spec's.
* `AGG.n1` / `n2` also carry `p` (that origin's path to N3), so the sink can report
  `route: "1>2>3>4"`. `p` is left out when it is the direct path (`1>3`, `2>3`); the sink
  rebuilds it. When a window holds only one sample (`cnt` = 1), `mean`/`min`/`max` may be
  omitted to save bytes. The sink fills them in as `v`, so the uplink always has all eight
  fields. `th` is always sent (OR of the window's DATA flags).
* `LIGHT_TEST` is executed by N4 itself (from the server reply or a `CMD:` line) and is never
  broadcast as CTRL.
* ACK frames also carry `o` (origin), so an ACK for a forwarded frame cannot be confused with
  an ACK for the relay's own frame that has the same `q`.
* Network-time sync uses the sender's `ts` (set right before the frame enters the MAC) instead
  of `t0`. This removes the 0..20 ms guard offset from the sync error. `t0` still defines the
  superframe grid.
* The sniffer marks the channel busy for ESP-NOW action frames from anyone and for 802.11 DATA
  frames from known WSN nodes only. Data traffic of the lab's other access points is ignored,
  as §2 asks for beacons/probes. If promiscuous mode cannot start, the MAC falls back to virtual
  carrier sense from the ESP-NOW receive callback (`CS_FALLBACK`, printed at boot).
* The ack-rate window "reset every 20 attempts" halves both counters, so the estimate never
  jumps back to 100 %.
* Sleep slots stop TX, pause BLE scanning, switch the LED off and set the
  `WIFI_PS_MAX_MODEM` hint. Received unicasts are still ACKed: an unassociated STA keeps
  receiving ESP-NOW anyway, and a sleeping relay that has not yet heard its new child's HELLO
  must not lose that child's first frames. `USE_LIGHT_SLEEP 1` (N1/N2 only) adds real light
  sleep.
* `WIFI_PS_NONE` is never used while BLE is on, because the ESP32 coexistence layer forbids it
  (it aborts). Awake = `WIFI_PS_MIN_MODEM`.
* A retransmission slot (rule 3) resends the DATA that failed in the member's primary slot
  (same `q`/`ts`) and flushes the forwarding queue.
* `counters.ucast.DATA` = DATA originated by N1+N2 (their STAT `tx`). `ACK` = ACKs sent
  by N4 + ACKs received by every node (STAT `mac.ok`). Broadcast counters are frames seen or
  sent by the sink.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Sketch too big` / `text section exceeds available space` | Select **Partition Scheme: Huge APP (3MB No OTA/1MB SPIFFS)**. |
| N1-N3 never hear N4 (`NOT synced`, no `RX` lines) / N4 posts but sees no AGG | **Channel mismatch.** ESP-NOW only works on one channel and N4 follows the hotspot's channel. Keep `AUTO_CHANNEL_FROM_SSID 1` and make sure every node can see the hotspot at boot (check the `found 'LAPTOP-HOTSPOT' on channel X` line). Otherwise set the hotspot to a fixed 2.4 GHz channel and set `WIFI_CHANNEL` to it with `AUTO_CHANNEL_FROM_SSID 0`. Restart N1-N3 if the hotspot changed channel. |
| N4 `hotspot NOT reached` | Wrong SSID/password, a 5 GHz-only hotspot, or the laptop is too far away. N4 keeps working on `WIFI_CHANNEL` (or on the scanned channel), streams `JSON:` lines over USB, and retries every 30 s. Use `serial_bridge.py` meanwhile. |
| N4 prints `hotspot is on channel X but the WSN runs on channel Y -> NOT joining` | The hotspot came up (or changed channel) after the nodes booted. N4 stays on the WSN channel and keeps working over `serial_bridge.py`. To use HTTP again: hotspot on first, then reboot all four nodes. If the hotspot is unreliable, set `SINK_WIFI_UPLINK 0` on N4: it never joins the hotspot (serial bridge only) and its radio never leaves the ESP-NOW channel. |
| `POST ... -> -1` or `-11` | Server not running, wrong IP/port (5050), or a firewall blocking port 5050 on the laptop. |
| Boot loop, `abort()` / `Should enable WiFi modem sleep when both WiFi and Bluetooth are enabled` | Something set `WIFI_PS_NONE` while BLE is on. Do not add `WiFi.setSleep(false)`. |
| Low free heap (`heap` in the table < 30 kB), random resets | BLE (Bluedroid) and Wi-Fi together use most of the heap. Keep Core Debug Level "None". On N4 you may set `SINK_BLE_ENABLE 0` (N4 is then no BLE anchor, so localization uses N2/N3 only), lower `SINK_UPLINK_LOG_MAX`, or reduce `SINK_UPLINK_BUF`. |
| Many `ACK_TIMEOUT` even without LINK_FAIL | BLE scanning time-shares the radio with Wi-Fi. Raise `BLE_SCAN_INTERVAL_MS` (e.g. 200) or lower `BLE_SCAN_WINDOW_MS` (e.g. 30). Also check that no other ESP-NOW project is busy on the same channel (`CS_BUSY` storms). |
| Everything is "out of range" (`oor` grows, no neighbours) | Expected for non-allowed pairs (N1-N4). If it happens for all pairs, two boards have the same `NODE_ID`. |
| Light never blinks red (`hot`) | Expected with the default 60.00 °C: the chip rarely gets that hot. Set TEMP_WARN below the live N1 reading shown in view 1, from the dashboard or with `CMD:{"c":"TEMP_WARN","a":1,"v":4500}` in N4's Serial Monitor. N1 prints `[N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)`; its next DATA has `th=1`. `RESET_STATS` restores 60.00 °C. |
| N1 `th` never changes although TEMP_WARN moved | The chip may be one of those stuck at 53.33 °C (`v=5333`): its reading never moves, so `th` only reacts to the threshold being moved across 53.33 °C (e.g. 5300 -> `th=1`, 5400 -> `th=0`). If N1 never prints `[N1 CTRL] TEMP_WARN ...`, the CTRL did not arrive: check the `[N4 CTRL] bcast TEMP_WARN ...` and `[N3 CTRL] RX TEMP_WARN ...` lines. |
| N2 turbidity `th` is inverted (1 in clear water) | Flip `TURB_DOUT_ACTIVE_LOW` (1 -> 0) in `config.h`, or turn the trimmer pot until the board's D LED changes at the wanted point. |
| N2 `v` stays near 0 or 4095 | Check `A` -> GPIO34 and that the module is on 3V3 (not VIN). The 4-pin probe cable must go 1-1, 2-2, 3-3, 4-4. |
| N1 / N3 temperature looks constant (e.g. 5333) or a few °C off | Expected: the classic ESP32 die sensor is uncalibrated, and some chips return a constant 53.3 °C. `-1` means the reading was NaN. |
| Status light never leaves `off` | N4 has not received any data yet (N3 down, no route, or channel mismatch). Check for `[N4 SINK] AGG q=...` or `[N4 SINK] DATA N... (raw, not aggregated)` lines. |
| One LED never lights | LED polarity: the long leg (anode) goes to the resistor / GPIO side, the short leg (cathode) to GND. Run `LIGHT_TEST` (`CMD:{"c":"LIGHT_TEST"}` in N4's Serial Monitor) to check both (red, then green). |
| Garbled serial lines on N4 | Normal while the `JSON:` line streams (about 1.4 s per superframe at 115200). Event lines are held back and printed right after it. Set `SINK_SERIAL_JSON 0` if you do not use the bridge. |
| Distances look wrong | Calibrate `RSSI_1M` (average RSSI at exactly 1 m) and `PATH_LOSS_N` on the lab table, and set the same values in `server/config.py`. |
