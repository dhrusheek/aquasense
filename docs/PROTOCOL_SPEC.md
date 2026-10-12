# AquaSense-WSN — System & Protocol Specification (shared contract)

This document is the single source of truth for the firmware (`firmware/wsn_node/`), the
dashboard server (`server/`), the simulator (`server/simulator.py`) and the technical report
(`docs/`). Every component MUST follow the message formats, field names and parameters here.

---------------------------------------------------------------------------------------------
## 0. Use case

**AquaSense — hybrid BLE/Wi-Fi WSN for aquaculture (fish-pond) water-quality monitoring.**
Two sensor nodes sit at the pond edge: N2 holds the **turbidity probe** in the water (the only
external sensor the team owns), N1 reports the **temperature inside its own electronics
enclosure** from the ESP32 on-chip temperature sensor, with an over-temperature alert whose
threshold the farmer sets from the dashboard (`TEMP_WARN`). The cluster head on the bank (N3)
aggregates both and adds its own enclosure temperature (same on-chip sensor). The
sink/gateway in the farm office (N4) collects everything, feeds the live dashboard on a laptop
and drives a **pond status light** (a green and a red LED). BLE localization tells the
farmer *where* a sensor float is relative to the fixed anchors (useful when a float drifts), and
the multi-hop + route recovery keeps data flowing when a bank-side link is blocked.

**Bill of materials (everything the team owns; nothing else is used):**
4 × ESP32 DevKit V1 (ESP32-WROOM-32, 30-pin), 1 × turbidity probe with its LM393 adapter board
(headers `G A D V` and `1 2 3 4`, trimmer pot), 2 × 5 mm LEDs (red, green) with
2 series resistors, 1 breadboard, male-female and female-female jumper wires (the DevKit and the module have male header pins), 4 USB
cables and a laptop. Every other "sensor" is an ESP32 on-chip peripheral (§1.1).

---------------------------------------------------------------------------------------------
## 1. Node configuration

| Node | Logical ID | Role (per guideline table)              | Sensor / hardware                           | Also does                                    |
|------|-----------:|-----------------------------------------|---------------------------------------------|----------------------------------------------|
| N1   | 1          | Sensor node                              | **ESP32 on-chip temperature sensor** (`temperatureRead()`, no external part, no wiring) = pond-edge enclosure temperature, alert flag `th` when above the `TEMP_WARN` threshold | BLE adv+scan, Wi-Fi MAC, unicast DATA        |
| N2   | 2          | Sensor / Relay node                      | **Turbidity module** (LM393 board + probe): `A` → **GPIO34** (ADC1_CH6), `D` → **GPIO27** (comparator flag), `V` → 3V3, `G` → GND | BLE adv+scan, forwards N1 data on alt. route, relays SCHED/CTRL |
| N3   | 3          | Cluster head / Aggregator / Router / Scheduler | **ESP32 on-chip temperature sensor** (`temperatureRead()`, no external part) = enclosure/electronics temperature | TDMA scheduler + time master, aggregation, routing |
| N4   | 4          | Sink / Gateway                           | **Pond status light**: green → **GPIO25**, red → **GPIO27** (each through its series resistor, cathodes to GND). USB to laptop; Wi-Fi STA to laptop hotspot | collects, computes localization, POSTs JSON to dashboard, drives the light, backup scheduler |

All four boards: **ESP32 DevKit V1 (ESP32-WROOM-32, 30-pin)**, onboard LED on **GPIO2** = awake/TX
indicator (ON = awake, OFF = sleeping slot).

Wiring (exact pins; the step-by-step guide with breadboard rows is `docs/HARDWARE_SETUP.md`):

```
N1 (sensor node)             no wiring: temperature comes from the ESP32 die sensor (USB power only)
N2 (turbidity module)        ESP32
  V  ----------------------> 3V3     (NEVER VIN/5 V: at 5 V the A and D outputs exceed 3.3 V)
  G  ----------------------> GND
  A  ----------------------> GPIO34  (input-only ADC1_CH6, attenuation 11 dB → 0..~3.1 V, 12 bit)
  D  ----------------------> GPIO27  (INPUT_PULLUP; LM393 comparator output, threshold = trimmer pot)
  probe 1/2/3/4 -----------> board 1/2/3/4 (straight through; M-F or F-F jumpers depending on the probe connector)

N3 (cluster head)            no wiring: temperature comes from the ESP32 die sensor

N4 (sink + status light)     ESP32                         Breadboard
  GPIO25 ---- resistor ---- GREEN  LED anode (long leg)   cathode (short leg) → GND rail
  GPIO27 ---- resistor ---- RED    LED anode              cathode → GND rail
  GND    ----------------------------------------------> GND rail
  USB    ----------------------------------------------> laptop (power + Serial 115200 + optional serial bridge)
  Wi-Fi STA -------------------------------------------> laptop mobile hotspot (2.4 GHz) → HTTP POST http://<laptop-ip>:5050/api/data
```

Pin rules behind these choices: GPIO34–39 are input-only with no pull resistors (fine for the
analog `A`, not for the open-collector `D`, which therefore goes to GPIO27 with the internal
pull-up); ADC2 pins (GPIO0/2/4/12–15/25–27) cannot be read by `analogRead()` while Wi-Fi is on,
so the only analog input is on ADC1 (GPIO34); strapping pins 0/2/5/12/15 carry nothing except the
onboard LED on GPIO2; GPIO25 and GPIO27 are plain outputs with no boot-time role.

Firmware is ONE Arduino sketch `firmware/wsn_node/wsn_node.ino` (+ tab headers). The role is
selected in `config.h` by `#define NODE_ID 1..4`; flash it four times.

Arduino settings: board "ESP32 Dev Module", **Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"**
(BLE + Wi-Fi + HTTP + JSON exceed the default 1.2 MB app partition), upload speed 921600.
Libraries: ESP32 core ≥ 2.0.14 or 3.x (code is version-guarded) and ArduinoJson 6.x or 7.x
(use only API common to both: `JsonDocument`/`StaticJsonDocument` guarded). **No other library**:
ADC, the temperature sensor and BLE (`BLEDevice.h`) all come with the core.

### 1.1 ESP32 on-chip capabilities used (so the demo needs almost no external hardware)

| Capability (ESP32-WROOM-32)            | Used by | What it does in AquaSense                                              |
|----------------------------------------|---------|------------------------------------------------------------------------|
| Wi-Fi radio + **ESP-NOW**              | all     | every WSN frame (§3); no access point needed between nodes              |
| Wi-Fi **promiscuous sniffer**          | all     | physical channel sensing for CSMA/CA (§4)                               |
| **Bluetooth LE** (Bluedroid)           | all     | discovery, RSSI, distance, localization (§8)                            |
| **SAR ADC1** (12 bit, 11 dB)           | N2      | turbidity analog output on GPIO34                                       |
| GPIO with **internal pull-up**         | N2      | LM393 comparator flag on GPIO27                                         |
| **On-chip temperature sensor**         | N1, N3  | enclosure temperature ×100 (uncalibrated; shows self-heating and drift); N1 adds the `TEMP_WARN` alert flag |
| **GPIO outputs**                       | N4      | 2-LED pond status light (§9.3)                                          |
| **Hardware RNG** (`esp_random`)        | all     | random backoff and guard offsets (§4, §5)                               |
| **Modem sleep / light sleep**          | N1, N2  | sleep slots (§5)                                                        |
| **eFuse MAC**                          | all     | node addressing: MACs learned from HELLO, never hard-coded (§2)         |
| **Wi-Fi STA + HTTP client**            | N4      | uplink to the dashboard (§9.1)                                          |
| **UART0 over USB**                     | N4      | `JSON:` / `CMD:` serial bridge fallback (§9.1)                          |

### 1.2 Sensor reading rules (firmware `sensors.h`, mirrored by `simulator.py`)

| Node | `u`    | `v` (int)                                                                 | `th` flag                                                      | `config.h`                                              | uplink `sensor` / `unit`                          |
|------|--------|---------------------------------------------------------------------------|----------------------------------------------------------------|---------------------------------------------------------|---------------------------------------------------|
| N1   | `temp` | `round(temperatureRead() × 100)`; `-1` if NaN                              | `1` when `v >= g_tempWarn` (°C×100); `g_tempWarn` starts at `TEMP_WARN_C100` and is changed at run time by the CTRL command `TEMP_WARN{a:1, v}`; `RESET_STATS` restores the default | `TEMP_WARN_C100 6000` (60.00 °C) | `ESP32 die temperature` / `degC x100` |
| N2   | `turb` | mean of `SENSOR_ADC_SAMPLES` = 4 × `analogRead(TURB_ADC_PIN)` (12 bit, 11 dB) | `1` when `digitalRead(TURB_DOUT_PIN)` is LOW (`TURB_DOUT_ACTIVE_LOW 1`; set 0 if the board's D LED shows the opposite) | `TURB_ADC_PIN 34`, `TURB_DOUT_PIN 27`, `TURB_DOUT_ACTIVE_LOW 1` | `Turbidity (LM393 module)` / `raw ADC`   |
| N3   | `temp` | `round(temperatureRead() × 100)`; `-1` if NaN                              | none (0)                                                       | —                                                       | `ESP32 die temperature` / `degC x100`             |
| N4   | —      | no DATA                                                                   | —                                                              | `LED_GREEN_PIN 25`, `LED_RED_PIN 27`, `LIGHT_STALE_SF 3`, `LIGHT_TEST_MS 1000` | `Pond status light (2 LEDs)` / `` |

Caveats that the dashboard and report state openly: the classic ESP32's temperature sensor is
uncalibrated (offset of several °C, some chips return a constant 53.3 °C, on which the `TEMP_WARN`
flag only reacts to the threshold being moved); the over-temperature alert is demonstrated by
setting the threshold just below the live reading from the dashboard (the chip rarely exceeds
60 °C in a lab); the turbidity module is rated 5 V but is **deliberately powered at 3.3 V**: at 5 V its `A`
output reaches 4.5 V and `D` swings to 5 V, both above the ESP32's 3.3 V pin limit, and the only
three resistors the team owns are the LED series resistors, so no divider can be built. At 3.3 V
the LM393 (2–36 V) and the IR pair still work, the analog swing is smaller (clear water ≈ 1.5–2.3 V
≈ 1900–2900 counts, turbid water well below), the 5 V NTU curve does not apply and the raw ADC
value is reported (NTU needs a per-probe calibration). The probe's 4-pin socket is wired straight
through to the board's `1 2 3 4` header; the numbering must be checked on the parts (an IR pair
plugged the wrong way round simply gives no signal, it is not damaged at 3.3 V).

---------------------------------------------------------------------------------------------
## 2. Radio architecture (hybrid BLE + Wi-Fi)

* **BLE (Bluedroid, core library)** — advertising + scanning on every node, used ONLY for:
  neighbour discovery, RSSI measurement, distance estimation, nearest-node, localization,
  localization error.
  * Advertising: device name `WSN-N<k>` (k = 1..4), manufacturer data = `0xFF 0xFF 'W' 'S' k txPowerRef(int8)`.
    Adv interval 100 ms. Always on.
  * Scanning: active scan, interval 100 ms, window 50 ms, continuous (restarted every 1 s
    from the main loop, non-blocking `start(1, cb, false)` in a scan-complete callback or
    `BLEScan::start(duration=1, false)` + `clearResults()`), paused while the node is in SLEEP slots.
  * RSSI smoothing: EMA `rssi_ema = 0.7*rssi_ema + 0.3*rssi` per neighbour.
  * Distance (log-distance path-loss model):
    `d_m = 10 ^ ((RSSI_1M - rssi_ema) / (10 * PATH_LOSS_N))`, `RSSI_1M = -59` dBm, `PATH_LOSS_N = 2.2`
    (both `#define` in `config.h`, calibrated on the lab table). Report distance in **cm**, clamp 5..1000.
  * Nearest node = neighbour with highest `rssi_ema`.
  * Localization (sink only, see §8).

* **Wi-Fi (ESP-NOW, 2.4 GHz, fixed channel)** — ALL network traffic: MAC, broadcast, unicast,
  scheduling, sensor data, aggregation, multi-hop, route recovery, sink communication.
  * Every node: `WiFi.mode(WIFI_STA)`; N4 additionally connects to the laptop hotspot
    (`UPLINK_SSID`/`UPLINK_PASS` in `config.h`).
  * Channel: `WIFI_CHANNEL` (default 1). If `AUTO_CHANNEL_FROM_SSID 1`, every node scans at boot
    for `UPLINK_SSID` and adopts its channel so ESP-NOW and N4's STA link share one channel.
  * Broadcast = ESP-NOW peer `FF:FF:FF:FF:FF:FF`. Unicast = ESP-NOW peer with the neighbour's MAC
    learned dynamically from HELLO frames (`esp_now_add_peer` on first sight). **No MACs are hard-coded.**
  * **Logical topology / simulated radio range** (all boards sit on one table, so real range does
    not separate them). Frames from a non-allowed neighbour are dropped on receive and counted
    as `oor` (out of range). This forces real multi-hop.

    ```
    ALLOWED[1] = {2,3}      N1 —— N2
    ALLOWED[2] = {1,3,4}    |  \   | \
    ALLOWED[3] = {1,2,4}    |   N3 ——N4
    ALLOWED[4] = {2,3}      (N1–N4 NOT allowed → N1 must multi-hop)
    ```
  * Promiscuous sniffer (`esp_wifi_set_promiscuous(true)`, mask DATA|MGMT): the callback only
    looks at frames of type MGMT/subtype ACTION (0xD, what ESP-NOW uses) and type DATA; it records
    `g_lastAirUs = micros()` and the per-source Wi-Fi RSSI (`rx_ctrl.rssi`) when the source MAC is a
    known neighbour. Beacons/probes are ignored so that the lab's APs do not keep the channel "busy".
    This is the physical **channel sensing** input. If promiscuous mode is unavailable the MAC falls
    back to virtual carrier sense from the ESP-NOW receive callback (`CS_FALLBACK`).

---------------------------------------------------------------------------------------------
## 3. Frame formats (ESP-NOW payload = compact JSON, ≤ 250 bytes)

Common keys: `t` type, `s` sender node number (1..4), `d` destination (0 = broadcast),
`q` sequence number (uint16, per sender per type DATA/AGG; HELLO/SCHED/CTRL use their own counter),
`ts` network time in ms (uint32, see §5).

| Type   | Cast      | Sender → Receiver            | Purpose                                            | Extra fields |
|--------|-----------|------------------------------|----------------------------------------------------|--------------|
| HELLO  | broadcast | every node, CONTROL slot     | neighbour discovery / route control / network status | `h` hops-to-sink (255 = none), `nh` current next hop (0 = none), `c` route cost, `ver` schedule version known, `up` uptime s, `nb` `[[n, bleRssi, wifiRssi, ackPct, up01], ...]` |
| SCHED  | broadcast | N3 (or N4 as backup) slot 0; N2 re-broadcasts once with `r:1` | schedule information | `sf` superframe no., `t0` network time of slot-0 start, `sl` slot ms, `n` slots, `a` `[owner per slot]` (owner 1..4, `0` = CONTROL/contention, `255` = UNUSED/sleep), `ver`, `why` reason string of last change, `m` master node (3 or 4) |
| DATA   | unicast   | origin → next hop → … → N3/N4 | sensor-data transmission, hop-by-hop ACKed | `o` origin, `v` value (int), `u` sensor code (`temp` = N1/N3 °C×100, `turb` = N2 raw ADC), `th` threshold flag 0/1 (N1: enclosure temperature ≥ `TEMP_WARN`, N2: comparator `D` active), `p` path so far e.g. `"1>2"`, `hop` hop count, `ttl` |
| AGG    | unicast   | N3 → N4 (via next hop)       | aggregated-data transmission              | `o:3`, `w` window = superframe no., `in` DATA frames received in window, `bi` bytes in, `bo` bytes out, `n1` `{v,q,ts,cnt,mean,min,max,th}`, `n2` same, `n3` `{v}`, `p`, `hop`, `red` reduction % (packets) |
| STAT   | unicast   | every node → sink via route  | per-node counters for dashboard (sent right after DATA in own slot; N3 after AGG) | `mac` `{tx,retx,ok,to,busy,bo,col,def}`, `tdma` `{slot,ver,awake,sleep,duty}`, `rt` `{nh,h,c,alt,altc}`, `ble` `[[n,rssi,dist_cm],...]`, `near` nearest node, `ev` `[last ≤4 event strings]`, `tx` DATA sent count, `fw` forwarded count, `oor`, `tw` current TEMP_WARN threshold (N1 only, °C×100) |
| ACK    | unicast   | receiver → sender of DATA/AGG/STAT | link-layer acknowledgement          | `q` = acknowledged seq, `at` = acked type |
| CTRL   | broadcast | N4 (from dashboard), relayed once by N3 and N2 (`r:1`) | network-control messages | `c` command, `a`,`b` node numbers, `dur` seconds, `at` network time, `v` integer argument (only `TEMP_WARN`), `id` command id (dedupe) |

Unicast reliability (DATA, AGG, STAT): sender runs the MAC procedure of §4 and expects an ACK
with the same `q`. Broadcasts (HELLO, SCHED, CTRL) are sent through the same channel-sense +
backoff procedure but are **not** ACKed (standard 802.11 behaviour).

Duplicate suppression: receiver keeps last `q` per (sender,type); a duplicate is re-ACKed but
not processed (handles the "ACK lost → retransmission" case).

---------------------------------------------------------------------------------------------
## 4. Wi-Fi MAC protocol (CSMA/CA with ACK, timeout, retransmission)

Implemented in `mac.h` as `macSend(frame, destMac, needAck)`; every outgoing frame goes through it.

```
CSMA/CA parameters (config.h)
  MAC_SLOT_US        = 1000     // backoff slot time
  MAC_DIFS_US        = 2000     // channel must be idle this long before TX / before counting down
  MAC_CW_MIN         = 4        // contention window (slots)
  MAC_CW_MAX         = 32
  MAC_ACK_TIMEOUT_MS = 40
  MAC_MAX_RETRIES    = 3
  MAC_CS_BUSY_US     = 3000     // channel = busy if any ACTION/DATA frame sniffed in the last 3 ms
  MAC_TX_DEADLINE_MS = 400      // give up if the whole procedure exceeds this (must fit a slot)

Procedure (per frame)
  retries = 0; cw = MAC_CW_MIN
  loop:
    1. CHANNEL SENSING : wait until channel idle for DIFS  (idle = micros()-g_lastAirUs > MAC_CS_BUSY_US)
                         every time the channel is found busy → counter mac.busy++, event "CS_BUSY"
    2. RANDOM BACKOFF  : n = random(0, cw) slots; count down one slot per MAC_SLOT_US only while idle;
                         freeze the counter while busy (802.11 style)  → mac.bo += n*slot, event "BACKOFF n"
    3. TRANSMISSION    : esp_now_send(dest, frame)  → mac.tx++ (first attempt) / mac.retx++ (retry)
    4. ACK WAIT        : if needAck: wait ≤ MAC_ACK_TIMEOUT_MS for ACK{q}
                         ACK received → mac.ok++, update neighbour ackOk, return OK
                         timeout      → mac.to++, neighbour ackFail++, retries++, cw = min(cw*2, MAC_CW_MAX)
                                        (binary exponential backoff), event "ACK_TIMEOUT → RETX"
                         retries > MAC_MAX_RETRIES → return FAIL (routing layer treats it as link failure evidence)
```

Collision / contention handling:
* Two nodes contending in the same CONTROL slot (HELLOs) or in the CONTENTION_TEST both sense the
  channel; the one whose random backoff expires first transmits; the other senses the channel busy,
  freezes its backoff (`mac.def++`, event "DEFER") and transmits afterwards. If both counters expire
  together the frames collide (CRC fail at receiver, hardware drops them) → no ACK → timeout →
  retransmission with doubled CW. The receiver also logs `col++` ("NEAR_COLLISION") when it receives
  two frames from different senders < 5 ms apart.
* **CONTENTION_TEST** (dashboard button → CTRL `{c:"CONTENTION_TEST", at:T}`): at network time T
  (chosen ≥ 1.5 s in the future, inside the CONTROL slot) N1 and N2 BOTH call `macSend` of a DATA frame
  (`u:"test"`) to N3 at the same instant. Each node records its MAC event timeline (µs offsets from T)
  and ships it in the next STAT `ev` list; the dashboard shows the two timelines side by side.

MAC counters reported in STAT.mac: `tx` first-attempt frames, `retx` retransmissions, `ok` ACKs
received, `to` ACK timeouts, `busy` channel-busy detections, `bo` total backoff ms, `col` near-collisions
observed as receiver, `def` deferrals (backoff frozen because channel became busy).

---------------------------------------------------------------------------------------------
## 5. Dynamic TDMA scheduling and sleep/wake

* **Network time** = scheduler's `millis()`. SCHED carries `t0` (network time of slot-0 start of
  the superframe being announced). Receivers compute `offset = t0 - localMillisAtRx` (propagation ≈ 1 ms,
  ignored) and `netNow() = millis() + offset`. N4 also syncs from SCHED (it is the time reference for
  end-to-end delay). Scheduler/time master is N3; if N4 hears no SCHED for 3 superframes it becomes
  backup scheduler (`m:4`) so the network survives N3 failure; it yields when N3 returns.

* **Superframe**: `TDMA_SLOT_MS = 500`, `TDMA_SLOTS = 6` → 3000 ms superframe.
  Default schedule version 1 (`why:"initial"`):

  | slot | owner | meaning                                          |
  |-----:|------:|--------------------------------------------------|
  | 0    | 3     | BEACON: SCHED broadcast (N2 re-broadcasts it once at +60 ms) |
  | 1    | 1     | N1 DATA (+STAT) to its next hop                  |
  | 2    | 2     | N2 DATA (+STAT) + forwards any queued N1 packets  |
  | 3    | 3     | N3 AGG (+STAT) to N4                              |
  | 4    | 0     | CONTROL (contention/CSMA): HELLO from every node, CTRL, contention test |
  | 5    | 255   | UNUSED → all nodes sleep                          |

* **Slot-based transmission**: a node transmits DATA/AGG/STAT only inside a slot it owns
  (`slotOwner[slot] == NODE_ID`), starting at slot start + `random(0..20) ms` (guard), and `macSend`
  must finish within the slot (`MAC_TX_DEADLINE_MS`). HELLO/CTRL only in CONTROL slots. ACKs are
  sent immediately whenever a frame arrives (ACK is part of the unicast exchange inside the sender's slot).

* **Sleep/wake**: a node is AWAKE in slot 0, in slots it owns, in CONTROL slots, and in slots owned
  by nodes for which it is the current next hop (so a relay/CH/sink listens for its children). In all
  other slots (incl. UNUSED) it SLEEPS: LED off, BLE scan paused, no TX, `esp_wifi_set_ps(WIFI_PS_MAX_MODEM)`
  modem-sleep hint; optional `USE_LIGHT_SLEEP 1` calls `esp_light_sleep_start()` for the remaining slot
  time (off by default because it stops BLE scanning and loosens time sync). N3 and N4 are mains/USB
  powered and treated as always-awake except in UNUSED slots. Each node accumulates `awake` and `sleep`
  ms and reports `duty = awake/(awake+sleep)*100` in STAT.tdma.

* **Dynamic schedule update** (the schedule MUST NOT stay static). The scheduler re-plans at the
  start of every superframe; whenever the slot table changes, `ver++` and `why` is set. Rules:
  1. `why:"N<k> left"` — a member whose DATA/HELLO was not heard for 3 superframes loses its slot
     (slot → 255 UNUSED, everyone sleeps there).
  2. `why:"N<k> joined"` — a member heard again (HELLO or DATA) gets its slot back (first UNUSED slot,
     or its original index).
  3. `why:"retx slot for N<k>"` — if a member's reported ACK-timeout ratio `to/(tx+retx)` over the last
     window > 20 %, the UNUSED slot is given to it as a second (retransmission) slot;
     `why:"retx slot released"` when the ratio drops below 5 %.
  4. `why:"dashboard request"` — CTRL `{c:"SCHED_UPDATE"}` rotates the member slots (1↔2) to demonstrate
     an explicit update on demand.
  5. `why:"route change: N1 via N2"` — when N1's next hop becomes N2, the scheduler ensures N2's slot is
     after N1's (it already is in the default order; the rule re-orders if a previous rotation broke it).
  The dashboard keeps the `(ver, why, t)` history.

---------------------------------------------------------------------------------------------
## 6. Adaptive multi-hop routing and recovery

Each node keeps a **neighbour table** (max 4 entries) in `routing.h`:

```
struct Neighbor { uint8_t id; uint8_t mac[6]; bool known; bool linkUp;
                  int8_t wifiRssi; int8_t bleRssi; uint16_t bleDistCm;
                  uint8_t hops;        // hops-to-sink advertised in its HELLO (255 = none)
                  uint16_t ackOk, ackFail;  // sliding window counters (reset every 20 attempts)
                  uint8_t consecFail;  uint32_t lastHelloMs; uint16_t cost; };
```

Route metric (lower = better), computed for every neighbour that is `known && linkUp && hops < 255`
and `ALLOWED`:

```
cost = 10 * (hops + 1)                                  // hop count
     + (100 - ackRatePct) / 5                           // packet loss / successful-ACK rate
     + max(0, -70 - wifiRssi) / 2                       // link quality (penalise RSSI below -70 dBm)
     + (isMember(NODE_ID) && next != 3 && CH_reachable ? 20 : 0)   // aggregation-aware: members prefer the cluster head
nextHop = argmin cost;  hopsToSink = hops(nextHop)+1 ; the 2nd best is reported as `alt`
```
Sink: `hops = 0`. Members (N1, N2) = nodes 1 and 2. `CH_reachable` = N3 is a known neighbour with
`linkUp`. With the allowlist this yields primary routes **N1→N3→N4** (cost 10·2=20) and
**N2→N3→N4** (20, vs N2→N4 direct = 10+20 = 30) so aggregation at N3 happens by design, and the
alternates **N1→N2→N3→N4** (N2 advertises hops 2 → cost 30) and **N2→N4** (30) are used on failure.

**Failure detection** (`linkUp = false`, event `"LINK_DOWN N<k>"`):
* `consecFail >= 2` (two unicast frames exhausted `MAC_MAX_RETRIES` in a row), or
* no HELLO from that neighbour for `ROUTE_HELLO_TIMEOUT_MS = 3 * superframe = 9000 ms`.

**Route update**: on any `linkUp` change or HELLO with a new `hops`, recompute; if `nextHop` changes
log `"ROUTE N<old>→N<new> cost a→b"`, send an immediate HELLO (route-control broadcast) in the next
CONTROL slot with the new `h`. **Alternate-route selection** = the argmin above with the failed link
excluded. **Recovery**: when HELLOs resume (or a unicast succeeds) `linkUp = true` and the primary route
is restored if its cost is lower (`"ROUTE RESTORED"`).

**Successful delivery through the alternate route** is proven by the `p` path field of every DATA/AGG
(`"1>2>3>4"` instead of `"1>3>4"`) and by the sink's per-origin PDR continuing to rise.

Forwarding: a non-sink node that receives a DATA whose `d != NODE_ID`-final (i.e. it is a relay) queues
it; N2 forwards queued N1 DATA in N2's own slot to N2's next hop (appending `>2` to `p`, `hop++`,
`ttl--`; drop if `ttl == 0`). N3 never forwards raw DATA — it aggregates (§7). N4 consumes.

**Link failure simulation** (so the evaluator can trigger it from the dashboard without touching
hardware; a physical alternative is powering N3 off or moving it away):
CTRL `{c:"LINK_FAIL", a:1, b:3, dur:40}` → both N1 and N3 add the pair to a `blocked` list for `dur` s:
they drop every frame from each other on receive (no ACK is generated) → N1 sees ACK timeouts →
`consecFail` → LINK_DOWN → alternate route via N2. `{c:"LINK_RESTORE", a:1, b:3}` clears it → HELLOs
resume → recovery. Any pair from the allowlist may be used.

---------------------------------------------------------------------------------------------
## 7. Data aggregation at N3

N3 keeps the latest DATA per origin received during the current superframe (window `w`). In slot 3 it
builds ONE AGG frame per window:

```
in   = number of DATA frames received in the window (from N1 and N2, any path, incl. retx-slot duplicates)
bi   = sum of their byte lengths;  bo = length of the AGG frame
n1   = {v: latest value, q: its seq, ts: its creation time, cnt, mean, min, max, th}   (stats over the window;
        th = 1 if ANY DATA of that origin in the window had th = 1, i.e. the flag is OR-fused, never averaged)
n2   = same;  n3 = {v: N3's own on-chip temperature ×100 (int), -1 if the reading is NaN}
red  = in > 0 ? (in - 1) / in * 100 : 0        // packet reduction % for this window
```
If `in == 0` no AGG is sent (slot unused → sleep). Cumulative counters `aggIn`, `aggOut`, `aggBytesIn`,
`aggBytesOut` go in N3's STAT (`agg:{in,out,bi,bo}`), and the sink computes
`reduction_packets = (aggIn - aggOut)/aggIn*100`, `reduction_bytes = (aggBytesIn - aggBytesOut)/aggBytesIn*100`.
Aggregation function = **latest-value fusion + window statistics (count/mean/min/max) + OR-fused alert
flags**, since the three sensors measure different quantities (so averaging across nodes is meaningless).

---------------------------------------------------------------------------------------------
## 8. BLE localization at the sink

Ground-truth table layout in **cm** (`NODE_POS` in `config.h`, also in the server config so the
dashboard draws the same map):

```
N2 = (0, 0)    N3 = (120, 0)    N4 = (60, 90)    N1 (target, true position) = (50, 30)
```
Anchors for target k = the other three nodes. Distance between i and k = average of the two
directions when both are reported (i's STAT.ble entry for k and k's entry for i), else the one available.
**Weighted centroid**: `est = Σ w_i·P_i / Σ w_i`, `w_i = 1 / d_i²`. Error = `‖est − true_k‖` (cm).
N4 computes `loc` for all four nodes (each using the other three as anchors) but the demo target is N1.
Nearest-node for each node = `near` from its STAT. The sink reports the full RSSI/distance matrix.

---------------------------------------------------------------------------------------------
## 9. Sink ⇄ dashboard contract

### 9.1 Uplink: N4 → server `POST http://<laptop>:5050/api/data` once per superframe (every 3 s)
(Also printed to Serial as a single line `JSON:{...}` so `server/serial_bridge.py` can forward it
over USB if the hotspot is unavailable.) Field names below are fixed.

```jsonc
{
  "source": "hardware",            // "simulator" when produced by simulator.py
  "sink": "N4", "net_time": 123456, "sf": 41, "uptime_s": 130, "sched_master": 3,
  "sink_ip": "192.168.137.23", "sink_mac": "AA:BB:...", "channel": 1,
  "nodes": [                        // always 4 entries, N1..N4
    { "id": "N1", "num": 1, "role": "Sensor node", "sensor": "ESP32 die temperature", "unit": "degC x100",
      "status": "active" | "inactive",            // inactive = nothing heard for 3 superframes
      "last_seen_s": 2, "mac_addr": "AA:BB:CC:DD:EE:01", "uptime_s": 120,
      "value": 4812, "seq": 40, "value_ts": 123000, "threshold": false,   // threshold = th flag of the latest DATA (N1, N2 only; absent/null for N3, N4)
      "temp_warn": 6000,                            // N1 only: current TEMP_WARN threshold (°C×100) as last reported by N1 in STAT.tw
      "route": "1>3>4", "next_hop": 3, "hops": 2, "alt_next_hop": 2, "route_cost": 20, "alt_cost": 30,
      "delay_ms": 215,              // end-to-end: sink net_time at reception − value_ts (incl. aggregation hold)
      "wifi_rssi": -48, "ble_rssi": -61,
      "rx_count": 40, "first_seq": 1, "max_seq": 40, "lost": 0, "tx_count": 40, "fwd_count": 0, "oor": 0,
      "mac": {"tx":40,"retx":2,"ok":40,"to":2,"busy":7,"bo":35,"col":0,"def":3},
      "tdma": {"slot":1,"ver":3,"awake_ms":40000,"sleep_ms":80000,"duty":33.3},
      "ble": [{"id":"N2","rssi":-65,"dist_cm":52},{"id":"N3","rssi":-60,"dist_cm":76}],
      "nearest": "N3",
      "events": ["ROUTE N3→N2 cost 20→30", "..."] }
    // N2 ... , N3 (adds "agg": {"in":80,"out":40,"bi":9600,"bo":5200}), N4 ...
  ],
  "schedule": { "ver": 3, "sf": 41, "slot_ms": 500, "slots": [3,1,2,3,0,255], "t0": 123000,
                "master": 3, "why": "retx slot for N1",
                "history": [ {"ver":1,"why":"initial","t":0}, ... ] },
  "aggregation": { "window": 41, "in": 2, "bytes_in": 240, "bytes_out": 130, "reduction_pct": 50.0,
                   "n1": {"v":4812,"q":40,"ts":123000,"cnt":1,"mean":4812,"min":4812,"max":4812,"th":0},
                   "n2": {"v":2610,"q":39,"ts":123600,"cnt":1,"mean":2610,"min":2610,"max":2610,"th":0},
                   "n3": {"v":4812}, "path": "3>4", "delay_ms": 180,
                   "cum": {"in":80,"out":40,"bytes_in":9600,"bytes_out":5200,
                           "reduction_packets_pct":50.0,"reduction_bytes_pct":45.8} },
  "localization": {
     "params": {"rssi_1m": -59, "n": 2.2},
     "positions_true": {"N1":[50,30],"N2":[0,0],"N3":[120,0],"N4":[60,90]},
     "matrix": [ {"from":"N1","to":"N2","rssi":-65,"dist_cm":52}, ... ],   // every reported pair
     "targets": [ {"id":"N1","est":[46.2,33.9],"true":[50,30],"err_cm":5.4,
                   "anchors":[{"id":"N2","dist_cm":55},{"id":"N3","dist_cm":74},{"id":"N4","dist_cm":62}]}, ... ],
     "nearest": {"N1":"N3","N2":"N1","N3":"N1","N4":"N3"} },
  "light": { "state": "green",                 // "green" | "red" | "hot" | "stale" | "test" | "off"  (§9.3)
             "reason": "all nominal", "since": 120000, "pins": {"green":25,"red":27} },
  "links": [ {"a":"N1","b":"N3","up":true,"wifi_rssi":-48,"ble_rssi":-60,"ack_pct":95,"blocked":false}, ... ],
  "mac_log": [ {"t":123456,"node":"N1","ev":"CS_BUSY"}, {"t":123457,"node":"N1","ev":"BACKOFF 3 slots"}, ... ],  // ≤ 60 newest
  "msg_log": [ {"t":123456,"type":"DATA","cast":"unicast","from":"N1","to":"N3","seq":40,"acked":true,"path":"1>3"}, ... ], // ≤ 60 newest
  "events":  [ {"t":123456,"node":"N1","type":"route","msg":"LINK_DOWN N3"}, ... ],  // ≤ 60 newest
  "counters": { "bcast": {"HELLO":120,"SCHED":41,"CTRL":2}, "ucast": {"DATA":80,"AGG":40,"STAT":160,"ACK":280} },
  "contention_test": { "at": 120000, "N1": ["+0us CS_IDLE","+0us BACKOFF 2","+2100us TX","+5300us ACK_OK"],
                       "N2": ["+0us CS_IDLE","+0us BACKOFF 5","+2100us CS_BUSY/DEFER","+7900us TX","+11000us ACK_OK"] }  // null if none
}
```

Server reply (HTTP 200, JSON): `{"ok": true, "commands": [ {"c":"LINK_FAIL","a":1,"b":3,"dur":40,"id":7}, ... ]}`.
N4 executes/broadcasts each command once (dedupe by `id`) in the next CONTROL slot. Serial bridge
writes the same objects as `CMD:{...}` lines to N4's serial port.

Commands: `LINK_FAIL{a,b,dur}`, `LINK_RESTORE{a,b}`, `CONTENTION_TEST{}` (N4 fills `at = netNow()+1500 rounded
into the next CONTROL slot), `SCHED_UPDATE{}`, `RESET_STATS{}`, `NODE_KILL{a,dur}` (node a stops transmitting
for dur s — simulates node failure/leaving for the "N<k> left" schedule rule), `NODE_WAKE{a}`,
`TEMP_WARN{a:1, v}` (broadcast CTRL; N1 stores `v` (°C×100, 0..15000) as its alert threshold, logs
`[N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)`, raises an event and reports it back in STAT `tw`; the
dashboard shows it as `nodes[0].temp_warn`), `LIGHT_TEST{}` (N4 only, not broadcast: the status light cycles red → green for `LIGHT_TEST_MS`
each, then returns to the data-driven state; proves dashboard → sink → GPIO actuation).

### 9.3 Pond status light (N4, two LEDs: red and green) — evaluated on every sample that reaches the sink

There is no yellow LED. The light is driven by the **freshest alert flag the sink holds for each
sensor node**, whichever way it arrived: inside an AGG from N3 (`n1.th`, `n2.th`) or in a DATA frame
that reached N4 directly (adaptive routing lets N2 use `2>4`, and N1 can arrive raw through N2, so
the latest AGG alone is not enough). The sink re-evaluates after every AGG, after every direct DATA
from N1 or N2, and from its service loop (blink, stale and test timing). A node's flag counts only
while its last sample is younger than `LIGHT_STALE_SF` superframes.

Priority from top to bottom:

| state   | LEDs                        | rule                                                                                         | reason string example     |
|---------|-----------------------------|----------------------------------------------------------------------------------------------|---------------------------|
| `test`  | red, then green             | `LIGHT_TEST` in progress (`LIGHT_TEST_MS` = 1000 ms per colour, 2 s in total)                | `LIGHT_TEST`              |
| `off`   | none                        | N4 not time-synced yet / no sample ever received                                             | `waiting for first data`  |
| `stale` | green **blinking** (500 ms) | no AGG and no direct DATA for `LIGHT_STALE_SF` = 3 superframes (route or cluster head down)   | `no data for 9 s`         |
| `red`   | red                         | freshest N2 flag is 1 (turbidity comparator tripped → water turbid)                          | `turbidity threshold (D)` |
| `hot`   | red **blinking** (500 ms)   | freshest N1 flag is 1 (N1 enclosure temperature ≥ its `TEMP_WARN` threshold), water not turbid | `N1 enclosure hot`        |
| `green` | green                       | everything else                                                                              | `all nominal`             |

The sink reports the state in the uplink `light` object, logs `[N4 LIGHT] red: turbidity threshold (D)`
on every change and raises an event `light -> red` so the dashboard timeline shows it. The
simulator implements the same table so the dashboard's light widget behaves identically.

### 9.2 Server → browser `GET /api/state`
Returns the last uplink object **plus** a `"derived"` block computed by the server:

```jsonc
"derived": {
  "received_at": "2026-10-11T10:00:00", "age_s": 1.2, "online": true, "source": "hardware|simulator",
  "metrics": {
     "pdr": {"N1":97.5,"N2":100,"N3":100},                 // rx/(max_seq-first_seq+1)*100 per origin
     "packet_loss": {"N1":2.5,...}, "lost_total": 3, "rx_total": 120,
     "delay_ms": {"N1":{"last":215,"avg":230,"min":180,"max":410},...},
     "throughput_bps": {"total": 420, "N1":140,"N2":140,"N3":140},   // payload bytes delivered at sink / s, 30 s window
     "retransmissions": {"N1":2,"N2":5,"N3":0,"N4":0,"total":7},
     "loc_err_cm": {"N1":{"last":5.4,"avg":8.1,"min":2,"max":15}},
     "reduction_pct": {"packets":50.0,"bytes":45.8}
  },
  "series": { "t":[...], "pdr_N1":[...], "pdr_N2":[...], "delay_N1":[...], "delay_N2":[...], "delay_N3":[...],
              "throughput":[...], "retx_total":[...], "loc_err_N1":[...], "reduction":[...],
              "value_N1":[...], "value_N2":[...], "value_N3":[...] },   // last 120 samples
  "demo_flow": { "BLE Discovery": true, "RSSI Measurement": true, "Localization": true, "Wi-Fi Initialization": true,
                 "Dynamic Schedule Assignment": true, "Channel Sensing": true, "Random Backoff": true,
                 "Scheduled Transmission": true, "Unicast Communication": true, "Data Aggregation": true,
                 "Multi-Hop Routing": true, "Sink": true, "Link Failure": false, "Failure Detection": false,
                 "Alternate Route Selection": false, "Route Recovery": false, "Performance Analysis": true },
  "schedule_history": [...], "route_history": [ {"t":..,"node":"N1","from":"1>3>4","to":"1>2>3>4","reason":"LINK_DOWN N3"} ]
}
```

Other endpoints: `POST /api/command` body `{c, a, b, dur}` → queued for the sink; `GET /api/history`
(full series); `GET /api/export.csv` (per-superframe metric rows for the report); `GET /` dashboard.
Server config `server/config.py`: `PORT = 5050` (5000 is taken by AirPlay on macOS), `NODE_POS`, `SUPERFRAME_MS = 3000`, `OFFLINE_AFTER_S = 10`.

---------------------------------------------------------------------------------------------
## 10. Dashboard views (one per rubric item)

| View | Rubric | Must show |
|------|--------|-----------|
| Overview | — | use case, live topology map (nodes at NODE_POS, active links, animated packet path), KPIs, live readings (N1 °C + hot flag, N2 raw ADC + turbid flag, N3 °C), pond status light widget (§9.3) with *Test light* button, demo-flow stepper (§5 of guideline), hardware/simulator badge |
| 1 Architecture & Setup | 2 marks | 4 node cards (role, sensor, exact pins, threshold flag, MAC, IP, channel, uptime, status, slot), on-chip peripheral table (§1.1), status-light state + history, addressing table, allowed-link table |
| 2 BLE Localization | 3 marks | RSSI matrix, distance table, nearest node per node, 2-D map true vs estimated, error (cm) + error over time, the distance formula with params |
| 3 Wi-Fi MAC | 3 marks | per-node MAC counters, MAC event timeline, Contention Test button + two timelines side by side, retransmission/timeout chart |
| 4 TDMA Schedule | 2 marks | slot strip with live cursor, owner/unused/control slots, sleep-awake duty per node, schedule version history with reasons, "Request schedule update" button, Kill/Wake node buttons |
| 5 Broadcast & Unicast | 1 mark | broadcast vs unicast counters per type, live message feed with destination + ACK status |
| 6 Data Aggregation | 2 marks | inputs (N1,N2,N3) vs output, window stats, packet & byte reduction %, cumulative chart |
| 7 Adaptive Routing | 2 marks | neighbour tables with cost per candidate, current + alternate route per node, link status, failure/recovery timeline, path trace of last packets, Link-fail / Restore buttons |
| 8 Performance | 2 marks | metric table with formulas + measured values, 6 charts (PDR, loss, delay, throughput, retx, loc err, reduction), Export CSV |
| 9 Demo & Viva | 3 marks | the 17-step integrated demonstration sequence with live auto-completion, viva cheat-sheet (what each protocol does, where it is in the code) |

UI: contemporary 2026 style — clean neutral surfaces, one accent colour, large readable numbers,
subtle borders, 12–16 px radii, light/dark via `prefers-color-scheme`, responsive grid, no build step
(vanilla HTML/CSS/JS + local `static/vendor/chart.umd.min.js`). Works fully offline.

---------------------------------------------------------------------------------------------
## 11. Performance metrics — definitions used everywhere

| Metric | Where measured | Formula |
|--------|----------------|---------|
| PDR (per origin) | sink | `rx_unique / (max_seq − first_seq + 1) × 100` |
| Packet loss | sink | `100 − PDR`; `lost = expected − rx_unique` |
| End-to-end delay | sink | `net_time_at_sink_reception − ts_created_at_origin` (ms), via network time (§5) |
| Throughput | server | `Σ payload bytes delivered at sink in last 30 s / 30` (bytes/s) and ×8 bps |
| Retransmissions | nodes (STAT.mac.retx) | count of MAC retries; also `to` timeouts |
| Localization error | sink | `‖est − true‖` cm (§8) |
| Data reduction | N3 + server | `(in − out)/in × 100` packets and bytes (§7) |

All seven are implemented; the guideline requires at least four.
