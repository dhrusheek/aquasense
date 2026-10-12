"""AquaSense-WSN network simulator — a faithful emulation of the 4-node hybrid BLE + Wi-Fi WSN.

It reproduces, slot by slot, what the firmware does (docs/PROTOCOL_SPEC.md) and posts one sink
uplink per superframe in EXACTLY the §9.1 format (``source: "simulator"``) to the dashboard
server. Commands returned in the POST reply are executed like N4 would (CTRL broadcast in the next
CONTROL slot).

Modelled:
  * §5  TDMA superframes (6 x 500 ms), default schedule v1, the five dynamic-update rules,
        SCHED beacons (N2 re-broadcast), per-node clock offsets + drift, sleep/awake duty,
        backup scheduler N4 when N3 is silent for 3 superframes.
  * §2/§8 BLE RSSI from the true NODE_POS geometry (log-distance model, sigma = 2.5 dB),
        EMA smoothing, distance, nearest node, weighted-centroid localization at the sink.
  * §4  CSMA/CA per frame: channel sensing (busy probability), DIFS, random backoff with
        freeze/deferral, ACK wait, ~3 % frame/ACK loss -> 40 ms timeout -> retransmission with
        binary exponential backoff, max 3 retries; per-node MAC counters; contention test.
  * §6  neighbour tables from HELLO, the exact route-cost formula and allowlist, LINK_DOWN on
        2 consecutive MAC failures or 9 s HELLO silence, alternate route, ROUTE RESTORED.
  * §7  aggregation at N3 (window = superframe, in/bytes/reduction, cnt/mean/min/max, OR-fused
        ``th`` alert flags).
  * §1.2 sensors: N1 ESP32 die temperature of its own pond-edge board (°C x100, ~46 °C at boot
        rising slowly to ~52 °C, +-0.3 °C noise, ``th`` = 1 when v >= its TEMP_WARN threshold,
        default 6000, changed at run time by the TEMP_WARN command and reported in STAT ``tw``),
        N2 turbidity module (raw 12-bit ADC ~2600 clear, ~1400 turbid, ``th`` = LM393 comparator
        D pin), N3 ESP32 die temperature (°C x100, 48..54 °C, rising slowly after boot). The demo
        scenario switches a "turbid" episode on at N2 (steady red light) and moves N1's TEMP_WARN
        threshold below the live reading (``hot``: red blinking).
  * §9.3 pond status light at the sink, two LEDs (red and green): test / off / stale / red / hot /
        green from the freshest alert flag held per node (AGG or a DATA frame that reached N4
        directly), the uplink ``light`` object and a ``light -> <state>`` event on every change;
        LIGHT_TEST cycles red, then green.
  * §11 per-origin seq / PDR / loss bookkeeping and end-to-end delay at the sink.

Usage:
  python simulator.py [--url http://127.0.0.1:5050/api/data] [--interval 3] [--scenario demo]
                      [--seed 1] [--duration 0] [--once]
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

import config

# --- protocol constants (spec §4, §5, §6) ----------------------------------------------------
SLOT_MS = config.TDMA_SLOT_MS
NSLOTS = config.TDMA_SLOTS
SF_MS = config.SUPERFRAME_MS
MAC_SLOT_MS = 1.0
MAC_DIFS_MS = 2.0
MAC_CW_MIN = 4
MAC_CW_MAX = 32
MAC_ACK_TIMEOUT_MS = 40.0
MAC_MAX_RETRIES = 3
MAC_TX_DEADLINE_MS = 400.0
ROUTE_HELLO_TIMEOUT_MS = 3 * SF_MS
ESPNOW_OVERHEAD_B = 43            # 802.11 action-frame header + ESP-NOW vendor IE + FCS
PHY_RATE_BPS = 1_000_000          # ESP-NOW default 1 Mbps

# --- channel / radio model parameters --------------------------------------------------------
P_CHANNEL_BUSY = 0.08             # probability that a CCA finds the channel busy (lab APs, etc.)
P_DEFER = 0.04                    # probability the channel turns busy during a backoff count-down
P_FRAME_LOSS = 0.012              # frame lost on air (no ACK generated)
P_ACK_LOSS = 0.015                # ACK lost on air (frame delivered, sender retransmits)
P_BCAST_LOSS = 0.02               # broadcast frame missed by one receiver
BLE_SIGMA_DB = 2.5
BLE_SCANS_PER_SF = 3

PRIMARY_NH = {1: 3, 2: 3, 3: 4}   # §6 primary routes (for "ROUTE RESTORED")
SENSOR_CODE = {1: "temp", 2: "turb", 3: "temp"}  # DATA.u (spec §3, §1.2)
MEMBERS = (1, 2)

# --- sensor models (spec §1.2) -----------------------------------------------------------------
TURB_CLEAR = 2600.0               # raw ADC (12 bit, 11 dB, module at 3.3 V) in clear water
TURB_MUDDY = 1400.0               # raw ADC in turbid water
TURB_D_TRIP = 2000.0              # LM393 comparator trip point (trimmer pot) -> D LOW -> th = 1
DIE_T_BOOT = 48.0                 # N3: ESP32 die temperature right after boot (degC, uncalibrated)
DIE_T_RISE = 6.0                  # N3: self-heating rise towards ~54 degC
DIE_T_TAU_S = 600.0               # time constant of the self-heating rise (both boards)
N1_T_BOOT = 46.0                  # N1: its own board, cooler at the pond edge: ~46 degC at boot
N1_T_RISE = 6.0                   # N1: rises slowly towards ~52 degC
DIE_T_NOISE = 0.3                 # +-0.3 degC read noise (1 sigma)
TEMP_WARN_DEFAULT = config.TEMP_WARN_DEFAULT_C100   # N1 th threshold (°C x100), spec §1.2

# --- pond status light at N4 (spec §9.3) -------------------------------------------------------
LIGHT_STALE_SF = config.LIGHT_STALE_SF
LIGHT_TEST_MS = config.LIGHT_TEST_MS
LIGHT_BLINK_MS = config.LIGHT_BLINK_MS


def nid(k: int) -> str:
    """Node number -> "N<k>"."""
    return "N%d" % k


def frame_len(frame: Dict[str, Any]) -> int:
    """ESP-NOW payload length of a frame = compact JSON length (spec §3); private keys excluded."""
    return len(json.dumps({k: v for k, v in frame.items() if not k.startswith("_")},
                          separators=(",", ":")))


def airtime_ms(nbytes: int) -> float:
    """On-air duration of one ESP-NOW frame at 1 Mbps incl. ~192 us long preamble."""
    return (nbytes + ESPNOW_OVERHEAD_B) * 8 * 1000.0 / PHY_RATE_BPS + 0.192


def true_dist_cm(a: int, b: int) -> float:
    """Ground-truth distance between two nodes (spec §8 NODE_POS)."""
    (x1, y1), (x2, y2) = config.NODE_POS[nid(a)], config.NODE_POS[nid(b)]
    return math.hypot(x1 - x2, y1 - y2)


def rssi_to_cm(rssi: float) -> int:
    """Log-distance path-loss inversion (spec §2), clamped 5..1000 cm."""
    d_m = 10 ** ((config.RSSI_1M - rssi) / (10.0 * config.PATH_LOSS_N))
    return int(round(min(1000.0, max(5.0, d_m * 100.0))))


# =================================================================================================
class Neighbor:
    """Routing-table entry (spec §6 ``struct Neighbor``)."""

    def __init__(self, num: int) -> None:
        self.id = num
        self.known = False
        self.link_up = False
        self.wifi_rssi = -50.0
        self.hops = 255
        self.nh_of_nb = 0
        self.ack_ok = 0
        self.ack_fail = 0
        self.consec_fail = 0
        self.last_hello = -1e9
        self.cost = 0
        self.life_ok = 0          # lifetime counters for links[].ack_pct
        self.life_fail = 0

    def ack_rate(self) -> float:
        """Successful-ACK rate over the sliding window (%)."""
        n = self.ack_ok + self.ack_fail
        return 100.0 if n == 0 else self.ack_ok * 100.0 / n

    def record(self, ok: bool) -> None:
        """Update ACK window counters (reset every 20 attempts, spec §6)."""
        if self.ack_ok + self.ack_fail >= 20:
            self.ack_ok = self.ack_fail = 0
        if ok:
            self.ack_ok += 1
            self.life_ok += 1
        else:
            self.ack_fail += 1
            self.life_fail += 1


class Node:
    """One ESP32 node: MAC/TDMA counters, neighbour table, BLE table, queues, sensor."""

    def __init__(self, num: int, rng: random.Random, boot_ms: float) -> None:
        self.num = num
        self.rng = rng
        self.active = True
        self.kill_until: Optional[float] = None
        self.boot_ms = boot_ms
        self.mac_addr = "24:6F:28:%02X:%02X:%02X" % (rng.randrange(256), rng.randrange(256), 0x10 + num)
        self.clock_err = rng.uniform(-3.0, 3.0)      # ms, local netNow() - true network time
        self.drift_ppm = rng.uniform(-40.0, 40.0)
        self.mac = {"tx": 0, "retx": 0, "ok": 0, "to": 0, "busy": 0, "bo": 0.0, "col": 0, "def": 0}
        self.awake_ms = 0.0
        self.sleep_ms = 0.0
        self.nbrs: Dict[int, Neighbor] = {j: Neighbor(j) for j in config.ALLOWED[num]}
        self.ble_ema: Dict[int, float] = {}
        self.ble_seen: Dict[int, float] = {}
        self.nh = 0
        self.hops = 0 if num == 4 else 255
        self.cost = 0
        self.alt = 0
        self.altc = 0
        self.degraded = False
        self.seq_data = 0
        self.seq_stat = 0
        self.seq_agg = 0
        self.seq_ctl = 0
        self.tx_count = 0
        self.fwd_count = 0
        self.oor = 0
        self.events: Deque[str] = deque(maxlen=4)
        self.queue: List[Dict[str, Any]] = []        # frames to forward in own slot
        self.retry: List[Dict[str, Any]] = []        # own frames that failed (for retx slot)
        self.dedupe: Dict[Tuple[int, str, int], int] = {}
        self.ratio_hist: Deque[Tuple[int, int]] = deque(maxlen=4)   # (to, tx+retx) snapshots
        # sensor state (spec §1.2)
        self.episode = False                         # N2: water turbid
        self.sensor_v = rng.uniform(TURB_CLEAR - 20, TURB_CLEAR + 20) if num == 2 else 0.0
        self.dry_level = self.sensor_v               # N2: per-probe clear-water level
        self.die_walk = 0.0                          # N1/N3: slow drift of the die temperature
        self.temp_warn = TEMP_WARN_DEFAULT if num == 1 else None   # N1 g_tempWarn (°C x100)

    # -- §1.2 sensors ----------------------------------------------------------------------------
    def read_sensor(self, t_ms: float) -> int:
        """One raw reading as ``sensors.h`` would return it (spec §1.2)."""
        if self.num in (1, 3):  # round(temperatureRead() x 100): die temperature, self-heating
            boot, rise, walk = (N1_T_BOOT, N1_T_RISE, 0.3) if self.num == 1 else (DIE_T_BOOT, DIE_T_RISE, 0.8)
            up_s = max(0.0, (t_ms - self.boot_ms) / 1000.0)
            self.die_walk = min(walk, max(-walk, self.die_walk + self.rng.gauss(0, 0.05)))
            c = boot + rise * (1 - math.exp(-up_s / DIE_T_TAU_S)) + self.die_walk
            c += self.rng.gauss(0, DIE_T_NOISE)
            return int(round(min(60.0, max(40.0, c)) * 100))
        if self.num == 2:      # mean of 4 x analogRead(GPIO34): ~2600 +-15 clear, ~1400 turbid
            target = TURB_MUDDY if self.episode else self.dry_level
            self.sensor_v += 0.6 * (target - self.sensor_v)
            v = self.sensor_v + self.rng.gauss(0, 15 / 2.0)     # 4-sample mean -> sigma / 2
            return int(round(min(4095, max(0, v))))
        return -1

    def sensor_th(self, v: int) -> int:
        """DATA ``th`` flag (spec §1.2): N1 die temperature >= TEMP_WARN, N2 comparator D."""
        if self.num == 1:
            return 1 if v != -1 and self.temp_warn is not None and v >= self.temp_warn else 0
        if self.num == 2:
            return 1 if v < TURB_D_TRIP else 0
        return 0

    def ev(self, msg: str) -> None:
        """Record a node-local event string (shipped in STAT.ev, last 4)."""
        self.events.append(msg)

    def ble_list(self) -> List[Dict[str, Any]]:
        """STAT.ble as [{id, rssi, dist_cm}] for neighbours heard recently."""
        return [{"id": nid(j), "rssi": int(round(r)), "dist_cm": rssi_to_cm(r)}
                for j, r in sorted(self.ble_ema.items())]

    def nearest(self) -> Optional[str]:
        """Nearest node = highest smoothed BLE RSSI (spec §2)."""
        if not self.ble_ema:
            return None
        return nid(max(self.ble_ema.items(), key=lambda kv: kv[1])[0])


# =================================================================================================
class Network:
    """The whole network + the sink's bookkeeping; :meth:`step` simulates one superframe."""

    def __init__(self, seed: Optional[int] = None, start_ms: float = 20000.0) -> None:
        self.rng = random.Random(seed)
        self.t = start_ms                         # true network time (ms), N3's millis()
        self.sf = 0
        self.nodes: Dict[int, Node] = {k: Node(k, self.rng, start_ms - self.rng.uniform(2000, 6000))
                                      for k in (1, 2, 3, 4)}
        self.nodes[3].clock_err = 0.0             # N3 is the time master
        # §5 schedule
        self.slots: List[int] = list(config.DEFAULT_SLOTS)
        self.ver = 1
        self.why = "initial"
        self.sched_history: List[Dict[str, Any]] = [{"ver": 1, "why": "initial", "t": int(start_ms)}]
        self.master = 3
        self.n4_missed_sched = 0
        self.left: Dict[int, int] = {}            # member -> home slot index it had
        self.retx_slot_of: Optional[int] = None
        self.sched_request = False
        self.t0 = start_ms
        # §6 link failure simulation
        self.blocked: Dict[Tuple[int, int], float] = {}
        # everyone powered up together: treat all nodes as "heard" at boot (no spurious "left")
        self.last_heard: Dict[int, Dict[int, float]] = {
            k: {j: start_ms for j in (1, 2, 3, 4) if j != k} for k in (1, 2, 3, 4)}
        # logs / counters (§9.1)
        self.mac_log: Deque[Dict[str, Any]] = deque(maxlen=60)
        self.msg_log: Deque[Dict[str, Any]] = deque(maxlen=60)
        self.events: Deque[Dict[str, Any]] = deque(maxlen=60)
        self.counters = {"bcast": {"HELLO": 0, "SCHED": 0, "CTRL": 0},
                         "ucast": {"DATA": 0, "AGG": 0, "STAT": 0, "ACK": 0}}
        self.contention_test: Optional[Dict[str, Any]] = None
        self.contention_at: Optional[float] = None
        # commands from the server
        self.seen_cmd_ids: set = set()
        self.pending_ctrl: List[Dict[str, Any]] = []
        # §7 aggregation state at N3
        self.agg_window: List[Dict[str, Any]] = []
        self.agg_cum = {"in": 0, "out": 0, "bi": 0, "bo": 0}
        # §11 sink bookkeeping
        self.sink_seqs: Dict[int, set] = {1: set(), 2: set(), 3: set()}
        self.sink_val: Dict[int, Dict[str, Any]] = {}
        self.sink_stat: Dict[int, Dict[str, Any]] = {}
        self.last_agg: Optional[Dict[str, Any]] = None
        # §9.3 pond status light at N4
        self.light: Dict[str, Any] = {"state": "off", "reason": "waiting for first data",
                                      "since": int(start_ms), "pins": dict(config.LIGHT_PINS)}
        self.light_leds: Dict[str, bool] = {"green": False, "red": False}   # LEDs lit right now
        self.last_agg_rx: Optional[float] = None      # true time the sink last consumed an AGG
        self.last_sample_rx: Optional[float] = None   # ... an AGG or a direct DATA (g_lastSampleRxMs)
        self.sink_th: Dict[int, int] = {1: 0, 2: 0}   # freshest alert flag held per node (g_sn[o].th)
        self.sink_th_rx: Dict[int, Optional[float]] = {1: None, 2: None}   # when it arrived (g_thRxMs)
        self.light_test_start: Optional[float] = None
        # boot: let BLE + routing converge for a few superframes before the first uplink
        for _ in range(3):
            self.step()

    # ---------------------------------------------------------------------------------------------
    # logging helpers
    # ---------------------------------------------------------------------------------------------
    def maclog(self, t: float, node: int, ev: str) -> None:
        """Append to mac_log (§9.1, ≤ 60 newest)."""
        self.mac_log.append({"t": int(t), "node": nid(node), "ev": ev})

    def event(self, t: float, node: int, typ: str, msg: str) -> None:
        """Append a network event (§9.1 events) and the node's own STAT.ev list."""
        self.events.append({"t": int(t), "node": nid(node), "type": typ, "msg": msg})
        self.nodes[node].ev(msg)

    def msglog(self, t: float, typ: str, cast: str, frm: int, to: Optional[int], seq: Any,
               acked: Optional[bool], path: str = "") -> None:
        """Append to msg_log (§9.1, ≤ 60 newest)."""
        self.msg_log.append({"t": int(t), "type": typ, "cast": cast, "from": nid(frm),
                             "to": nid(to) if to else "*", "seq": seq, "acked": acked,
                             "path": path})

    # ---------------------------------------------------------------------------------------------
    # radio helpers
    # ---------------------------------------------------------------------------------------------
    def is_blocked(self, a: int, b: int) -> bool:
        """True if the a-b pair is in the LINK_FAIL blocked list (spec §6)."""
        return (min(a, b), max(a, b)) in self.blocked

    def wifi_rssi(self, a: int, b: int) -> float:
        """Wi-Fi RSSI of a link: table-top distance model + noise."""
        d = max(10.0, true_dist_cm(a, b))
        return -42.0 - 15.0 * math.log10(d / 50.0) + self.rng.gauss(0, 1.5)

    def hears(self, src: int, dst: int) -> bool:
        """Physical + logical reachability of a frame src->dst (allowlist, blocked, power)."""
        return (self.nodes[dst].active and self.nodes[src].active
                and config.is_allowed_link(src, dst) and not self.is_blocked(src, dst))

    def _csma(self, src: Node, t: float, cw: int) -> float:
        """Steps 1-2 of §4: channel sensing (DIFS) + random backoff with freeze. Returns TX time."""
        tries = 0
        while self.rng.random() < P_CHANNEL_BUSY and tries < 3:
            src.mac["busy"] += 1
            self.maclog(t, src.num, "CS_BUSY")
            t += self.rng.uniform(0.5, 3.0)
            tries += 1
        t += MAC_DIFS_MS
        n = self.rng.randrange(cw)
        src.mac["bo"] += n * MAC_SLOT_MS
        self.maclog(t, src.num, "BACKOFF %d slots" % n)
        t += n * MAC_SLOT_MS
        if n > 0 and self.rng.random() < P_DEFER:
            src.mac["def"] += 1
            src.mac["busy"] += 1
            self.maclog(t, src.num, "DEFER")
            t += self.rng.uniform(1.0, 3.0) + MAC_DIFS_MS
        return t

    def unicast(self, src: Node, dst: int, frame: Dict[str, Any], t: float) -> Tuple[bool, float]:
        """macSend(frame, dest, needAck=true) — spec §4. Returns (acked, end time)."""
        frame["s"], frame["d"] = src.num, dst
        typ = frame["t"]
        size = frame_len(frame)
        t_start = t
        retries = 0
        cw = MAC_CW_MIN
        nb = src.nbrs.get(dst)
        self.counters["ucast"][typ] = self.counters["ucast"].get(typ, 0) + 1
        while True:
            t = self._csma(src, t, cw)
            if retries == 0:
                src.mac["tx"] += 1
                self.maclog(t, src.num, "TX %s→%s q=%s" % (typ, nid(dst), frame.get("q")))
            else:
                src.mac["retx"] += 1
                self.maclog(t, src.num, "RETX#%d %s→%s" % (retries, typ, nid(dst)))
            t += airtime_ms(size)
            delivered = self.hears(src.num, dst) and self.rng.random() > P_FRAME_LOSS
            acked = False
            if delivered:
                self._receive(self.nodes[dst], src, frame, t)
                self.counters["ucast"]["ACK"] += 1
                t_ack = t + self.rng.uniform(0.4, 1.6) + airtime_ms(30)
                if self.rng.random() > P_ACK_LOSS:
                    acked = True
                    t = t_ack
            if acked:
                src.mac["ok"] += 1
                self.maclog(t, src.num, "ACK_OK q=%s" % frame.get("q"))
                if nb:
                    nb.record(True)
                    nb.consec_fail = 0
                    if not nb.link_up and nb.known:
                        self._link_up(src, dst, t, "unicast ok")
                self.msglog(t, typ, "unicast", src.num, dst, frame.get("q"), True,
                            "%s>%d" % (frame.get("p", src.num), dst))
                return True, t
            t += MAC_ACK_TIMEOUT_MS
            src.mac["to"] += 1
            if nb:
                nb.record(False)
            retries += 1
            cw = min(cw * 2, MAC_CW_MAX)
            if retries > MAC_MAX_RETRIES or t - t_start > MAC_TX_DEADLINE_MS:
                self.maclog(t, src.num, "TX_FAIL %s→%s after %d retries" % (typ, nid(dst), retries - 1))
                self.msglog(t, typ, "unicast", src.num, dst, frame.get("q"), False,
                            "%s>%d" % (frame.get("p", src.num), dst))
                if nb:
                    nb.consec_fail += 1
                    if nb.consec_fail >= 2 and nb.link_up:
                        self._link_down(src, dst, t, "2 consecutive MAC failures")
                return False, t
            self.maclog(t, src.num, "ACK_TIMEOUT → RETX (cw=%d)" % cw)

    def broadcast(self, src: Node, frame: Dict[str, Any], t: float, csma: bool = True) -> float:
        """Broadcast through the same CSMA procedure, no ACK (spec §3). Returns end time."""
        frame["s"], frame["d"] = src.num, 0
        if csma:
            t = self._csma(src, t, MAC_CW_MIN)
        src.mac["tx"] += 1
        self.counters["bcast"][frame["t"]] += 1
        t += airtime_ms(frame_len(frame))
        self._deliver_bcast(src, frame, t)
        self.msglog(t, frame["t"], "broadcast", src.num, None, frame.get("q"), None, "")
        return t

    def _deliver_bcast(self, src: Node, frame: Dict[str, Any], t: float) -> None:
        """Hand a broadcast to every node that hears it; non-allowed receivers count ``oor``."""
        for k, dst in self.nodes.items():
            if k == src.num or not dst.active or not src.active:
                continue
            if not config.is_allowed_link(src.num, k):
                dst.oor += 1              # heard physically, dropped by the allowlist
                continue
            if self.is_blocked(src.num, k) or self.rng.random() < P_BCAST_LOSS:
                continue
            self._receive(dst, src, frame, t)

    # ---------------------------------------------------------------------------------------------
    # receive path
    # ---------------------------------------------------------------------------------------------
    def _receive(self, dst: Node, src: Node, frame: Dict[str, Any], t: float) -> None:
        """Receive handler of node ``dst`` (dedupe, HELLO/SCHED/DATA/AGG/STAT processing)."""
        typ = frame["t"]
        heard = self.last_heard[dst.num]
        heard[src.num] = t
        if "o" in frame:
            heard[frame["o"]] = t
        if typ in ("DATA", "AGG", "STAT"):
            key = (src.num, typ, frame.get("o", src.num))
            if dst.dedupe.get(key) == frame.get("q"):
                return                      # duplicate: re-ACKed by the MAC, not processed
            dst.dedupe[key] = frame.get("q")
        if typ == "HELLO":
            self._on_hello(dst, src, frame, t)
        elif typ == "SCHED":
            dst.clock_err = self.rng.gauss(0, 1.0) if dst.num != 3 else 0.0
            if dst.num == 4:
                self.n4_missed_sched = 0
        elif typ == "DATA":
            if frame.get("u") == "test":
                return
            if dst.num == 4:
                self._sink_data(frame, t)
            elif dst.num == 3:
                self.agg_window.append(copy.deepcopy(frame))
            else:
                dst.queue.append(copy.deepcopy(frame))
        elif typ in ("AGG", "STAT"):
            if dst.num == 4:
                (self._sink_agg if typ == "AGG" else self._sink_stat)(frame, t)
            else:
                dst.queue.append(copy.deepcopy(frame))

    def _on_hello(self, dst: Node, src: Node, frame: Dict[str, Any], t: float) -> None:
        """Neighbour discovery / route control (spec §6)."""
        nb = dst.nbrs[src.num]
        nb.known = True
        nb.last_hello = t
        nb.hops = frame["h"]
        nb.nh_of_nb = frame["nh"]
        nb.wifi_rssi = 0.7 * nb.wifi_rssi + 0.3 * self.wifi_rssi(src.num, dst.num)
        if not nb.link_up:
            self._link_up(dst, src.num, t, "HELLO")
        self.route(dst, t)

    def _link_up(self, node: Node, j: int, t: float, why: str) -> None:
        """Mark a neighbour link usable again (recovery, spec §6)."""
        nb = node.nbrs[j]
        was_known = nb.consec_fail > 0 or nb.ack_fail > 0 or node.degraded
        nb.link_up = True
        nb.consec_fail = 0
        nb.ack_ok = nb.ack_fail = 0
        if was_known and self.sf > 3:
            self.event(t, node.num, "route", "LINK_UP %s (%s)" % (nid(j), why))
        self.route(node, t)

    def _link_down(self, node: Node, j: int, t: float, why: str) -> None:
        """Failure detection: ``linkUp = false`` + LINK_DOWN event (spec §6)."""
        nb = node.nbrs[j]
        if not nb.link_up:
            return
        nb.link_up = False
        if node.nh == j:
            node.degraded = True
        self.event(t, node.num, "route", "LINK_DOWN %s" % nid(j))
        self.maclog(t, node.num, "LINK_DOWN %s (%s)" % (nid(j), why))
        self.route(node, t)

    # ---------------------------------------------------------------------------------------------
    # §6 routing
    # ---------------------------------------------------------------------------------------------
    def route(self, node: Node, t: float) -> None:
        """Recompute next hop with the exact §6 cost formula; log ROUTE / ROUTE RESTORED."""
        if node.num == 4:
            node.nh, node.hops, node.cost = 0, 0, 0
            return
        ch_reachable = 3 in node.nbrs and node.nbrs[3].known and node.nbrs[3].link_up
        cands: List[Tuple[int, int]] = []
        for j, nb in node.nbrs.items():
            if not (nb.known and nb.link_up and nb.hops < 255) or nb.nh_of_nb == node.num:
                continue                       # split horizon: never route via our own child
            cost = (10 * (nb.hops + 1) + int((100 - nb.ack_rate()) / 5)
                    + int(max(0.0, -70 - nb.wifi_rssi) / 2)
                    + (20 if node.num in MEMBERS and j != 3 and ch_reachable else 0))
            nb.cost = cost
            cands.append((cost, j))
        cands.sort()
        old, old_cost = node.nh, node.cost
        if cands:
            node.cost, node.nh = cands[0]
            node.hops = node.nbrs[node.nh].hops + 1
            node.alt, node.altc = (cands[1][1], cands[1][0]) if len(cands) > 1 else (0, 0)
        else:
            node.nh, node.hops, node.cost, node.alt, node.altc = 0, 255, 0, 0, 0
        if node.nh != old:
            self.event(t, node.num, "route", "ROUTE %s→%s cost %s→%s" % (
                nid(old) if old else "-", nid(node.nh) if node.nh else "-",
                old_cost if old else "-", node.cost if node.nh else "-"))
            if node.nh == PRIMARY_NH.get(node.num) and node.degraded:
                node.degraded = False
                self.event(t, node.num, "route", "ROUTE RESTORED")
            elif old == PRIMARY_NH.get(node.num):
                node.degraded = True

    def route_string(self, k: int) -> str:
        """Path string from the next-hop chain, e.g. "1>2>3>4" (spec §6)."""
        path, cur = [k], k
        for _ in range(5):
            if cur == 4:
                break
            nh = self.nodes[cur].nh
            if not nh or nh in path:
                break
            path.append(nh)
            cur = nh
        return ">".join(str(p) for p in path)

    def hello_timeouts(self, t: float) -> None:
        """LINK_DOWN after ROUTE_HELLO_TIMEOUT_MS of HELLO silence (spec §6)."""
        for node in self.nodes.values():
            if not node.active:
                continue
            for j, nb in node.nbrs.items():
                if nb.link_up and t - nb.last_hello > ROUTE_HELLO_TIMEOUT_MS:
                    self._link_down(node, j, t, "HELLO timeout")

    # ---------------------------------------------------------------------------------------------
    # §5 scheduler
    # ---------------------------------------------------------------------------------------------
    def _set_sched(self, slots: List[int], why: str, t: float) -> None:
        """Install a new slot table: ver++, why, history (spec §5)."""
        if slots == self.slots:
            return
        self.slots = slots
        self.ver += 1
        self.why = why
        self.sched_history.append({"ver": self.ver, "why": why, "t": int(t)})
        del self.sched_history[:-50]
        self.event(t, self.master, "tdma", "SCHED v%d: %s" % (self.ver, why))

    def replan(self, t: float) -> None:
        """Scheduler re-plan at superframe start — the five dynamic-update rules (spec §5)."""
        n3 = self.nodes[3]
        # master election: N3, or N4 as backup after 3 silent superframes
        if n3.active and self.master != 3:
            self.master = 3
            self.event(t, 3, "tdma", "N3 resumed as scheduler (N4 yields)")
        elif not n3.active and self.master == 3 and self.n4_missed_sched >= 3:
            self.master = 4
            self.event(t, 4, "tdma", "N4 became backup scheduler (m:4)")
        if not self.nodes[self.master].active:
            return
        heard = self.last_heard[self.master]
        slots = list(self.slots)
        for k in MEMBERS:
            last = heard.get(k, -1e9)
            # rule 1: member silent for 3 superframes loses its slot(s)
            if k not in self.left and k in slots and t - last > 3 * SF_MS:
                self.left[k] = slots.index(k)
                if self.retx_slot_of == k:
                    self.retx_slot_of = None
                slots = [config.SLOT_UNUSED if o == k else o for o in slots]
                self._set_sched(slots, "%s left" % nid(k), t)
            # rule 2: member heard again gets its slot back
            elif k in self.left and t - last <= SF_MS:
                home = self.left.pop(k)
                if slots[home] != config.SLOT_UNUSED:
                    home = slots.index(config.SLOT_UNUSED) if config.SLOT_UNUSED in slots else home
                slots = list(slots)
                slots[home] = k
                self._set_sched(slots, "%s joined" % nid(k), t)
        # rule 3: retransmission slot for a member with ACK-timeout ratio > 20 % (released < 5 %)
        for k in MEMBERS:
            node = self.nodes[k]
            hist = node.ratio_hist
            if len(hist) < 2:
                continue
            d_to = hist[-1][0] - hist[0][0]
            d_tx = hist[-1][1] - hist[0][1]
            ratio = d_to / d_tx if d_tx >= 3 else 0.0
            slots = list(self.slots)
            if (self.retx_slot_of is None and ratio > 0.20 and k not in self.left
                    and config.SLOT_UNUSED in slots):
                slots[slots.index(config.SLOT_UNUSED)] = k
                self.retx_slot_of = k
                self._set_sched(slots, "retx slot for %s" % nid(k), t)
            elif self.retx_slot_of == k and ratio < 0.05:
                idx = [i for i, o in enumerate(slots) if o == k]
                if len(idx) > 1:
                    slots[idx[-1]] = config.SLOT_UNUSED
                self.retx_slot_of = None
                self._set_sched(slots, "retx slot released", t)
        # rule 4: dashboard request rotates the member slots (1 <-> 2)
        if self.sched_request:
            self.sched_request = False
            slots = [2 if o == 1 else 1 if o == 2 else o for o in self.slots]
            if slots == self.slots:      # nothing to rotate (e.g. both members gone): bump anyway
                self.ver += 1
                self.why = "dashboard request"
                self.sched_history.append({"ver": self.ver, "why": self.why, "t": int(t)})
            else:
                self._set_sched(slots, "dashboard request", t)
        # rule 5: N1 routed via N2 -> N2's main slot must come after N1's
        if self.nodes[1].nh == 2 and 1 in self.slots and 2 in self.slots:
            i1, i2 = self.slots.index(1), self.slots.index(2)
            if i2 < i1:
                slots = list(self.slots)
                slots[i1], slots[i2] = 2, 1
                self._set_sched(slots, "route change: N1 via N2", t)

    def home_slot(self, k: int) -> int:
        """First slot (>0) owned by node k, or -1."""
        for i, o in enumerate(self.slots):
            if i > 0 and o == k:
                return i
        return -1

    # ---------------------------------------------------------------------------------------------
    # slot activities
    # ---------------------------------------------------------------------------------------------
    def _beacon(self, t: float) -> None:
        """Slot 0: SCHED broadcast by the master; N2 re-broadcasts once at +60 ms (spec §5)."""
        m = self.nodes[self.master]
        heard_n4 = False
        if m.active:
            m.seq_ctl += 1
            frame = {"t": "SCHED", "q": m.seq_ctl, "ts": int(t), "sf": self.sf, "t0": int(t),
                     "sl": SLOT_MS, "n": NSLOTS, "a": list(self.slots), "ver": self.ver,
                     "why": self.why, "m": self.master}
            before = self.n4_missed_sched
            self.n4_missed_sched = before + 1 if self.master != 4 else 0
            self.broadcast(m, frame, t + self.rng.uniform(0, 5))
            heard_n4 = self.n4_missed_sched == 0
            n2 = self.nodes[2]
            if self.master != 2 and n2.active and self.last_heard[2].get(self.master, -1) >= t:
                relay = dict(frame, r=1)
                self.broadcast(n2, relay, t + 60.0)
                heard_n4 = heard_n4 or self.n4_missed_sched == 0
        else:
            self.n4_missed_sched += 1
        # nodes that missed every beacon drift (ppm) away from network time
        for node in self.nodes.values():
            node.clock_err += node.drift_ppm * 1e-6 * SF_MS
        _ = heard_n4

    def _send_own(self, node: Node, frame: Dict[str, Any], t: float) -> float:
        """Send an own frame to the current next hop; failures go to the retry list."""
        if not node.nh:
            return t
        ok, t = self.unicast(node, node.nh, frame, t)
        if not ok and frame["t"] == "DATA" and self.retx_slot_of == node.num:
            node.retry.append(frame)
        return t

    def _forward_queue(self, node: Node, t: float, end: float) -> float:
        """Relay queued frames to the next hop (append ">k" to p, hop++, ttl--; spec §6)."""
        q, node.queue = node.queue, []
        for fr in q:
            if t > end - 60 or not node.nh:
                node.queue.append(fr)          # no time left in the slot / no route: keep
                continue
            fr = dict(fr)
            fr["ttl"] = fr.get("ttl", 4) - 1
            if fr["ttl"] <= 0:
                continue
            fr["p"] = "%s>%d" % (fr.get("p", ""), node.num)
            fr["hop"] = fr.get("hop", 1) + 1
            node.fwd_count += 1
            _, t = self.unicast(node, node.nh, fr, t + self.rng.uniform(0.5, 2.0))
        return t

    def _stat_frame(self, node: Node, t: float) -> Dict[str, Any]:
        """STAT frame content (spec §3)."""
        node.seq_stat += 1
        tot = node.awake_ms + node.sleep_ms
        fr = {"t": "STAT", "q": node.seq_stat, "ts": int(t + node.clock_err), "o": node.num,
              "mac": {k: int(v) for k, v in node.mac.items()},
              "tdma": {"slot": self.home_slot(node.num), "ver": self.ver, "awake": int(node.awake_ms),
                       "sleep": int(node.sleep_ms), "duty": round(node.awake_ms / tot * 100, 1) if tot else 0.0},
              "rt": {"nh": node.nh, "h": node.hops, "c": node.cost, "alt": node.alt, "altc": node.altc},
              "ble": [[int(j), int(round(r)), rssi_to_cm(r)] for j, r in sorted(node.ble_ema.items())],
              "near": node.nearest(), "ev": list(node.events), "tx": node.tx_count,
              "fw": node.fwd_count, "oor": node.oor, "up": int((t - node.boot_ms) / 1000),
              "p": str(node.num), "hop": 1, "ttl": 4,
              "_mac_addr": node.mac_addr,
              "_wifi": {j: nb.wifi_rssi for j, nb in node.nbrs.items()}}
        if node.num == 3:
            fr["agg"] = dict(self.agg_cum)
        if node.num == 1:
            fr["tw"] = int(node.temp_warn)        # current TEMP_WARN threshold, °C x100 (spec §3 STAT)
        return fr

    def _member_slot(self, node: Node, t: float, end: float, retx_slot: bool) -> None:
        """Owned slot of N1/N2: DATA (+ queued forwards) + STAT, or retries in a retx slot."""
        t += self.rng.uniform(0, 20)                 # guard (spec §5)
        if retx_slot:
            r, node.retry = node.retry, []
            for fr in r:
                t = self._send_own(node, fr, t)
            t = self._forward_queue(node, t, end)
            return
        if node.nh:
            node.seq_data += 1
            node.tx_count += 1
            v = node.read_sensor(t)
            data = {"t": "DATA", "q": node.seq_data, "ts": int(t + node.clock_err), "o": node.num,
                    "v": v, "u": SENSOR_CODE[node.num], "th": node.sensor_th(v),
                    "p": str(node.num), "hop": 1, "ttl": 4}
            t = self._send_own(node, data, t)
        t = self._forward_queue(node, t, end)
        if node.nh and t < end - 50:
            self._send_own(node, self._stat_frame(node, t), t + 1.0)

    def _ch_slot(self, node: Node, t: float, end: float) -> None:
        """Slot 3 of N3: build ONE AGG for the window (spec §7), STAT, forward queued STATs."""
        t += self.rng.uniform(0, 20)
        win, self.agg_window = self.agg_window, []
        if win and node.nh:
            node.seq_agg += 1
            node.tx_count += 1
            bi = sum(frame_len(f) + ESPNOW_OVERHEAD_B for f in win)
            parts: Dict[str, Any] = {}
            qs: Dict[int, List[Tuple[int, int, int, int]]] = {1: [], 2: []}
            for o in (1, 2):
                fs = [f for f in win if f.get("o") == o]
                if not fs:
                    continue
                vals = [f["v"] for f in fs]
                last = max(fs, key=lambda f: f["q"])
                p = {"v": last["v"], "q": last["q"], "ts": last["ts"], "cnt": len(fs),
                     "th": 1 if any(f.get("th") for f in fs) else 0}     # OR-fused, never averaged
                if len(fs) > 1:            # window stats only add information when cnt > 1
                    p.update(mean=round(sum(vals) / len(vals), 1), min=min(vals), max=max(vals))
                parts["n%d" % o] = p
                qs[o] = [(f["q"], f["ts"], f["v"], int(f.get("th") or 0)) for f in fs]
            n3v = node.read_sensor(t)
            red = round((len(win) - 1) / len(win) * 100, 1)
            agg = {"t": "AGG", "q": node.seq_agg, "ts": int(t + node.clock_err), "o": 3,
                   "w": self.sf, "in": len(win), "bi": bi, "bo": 0, **parts, "n3": {"v": n3v},
                   "p": "3", "hop": 1, "ttl": 4, "red": red, "_qs": qs}
            agg["bo"] = frame_len(agg) + ESPNOW_OVERHEAD_B
            agg["bo"] = frame_len(agg) + ESPNOW_OVERHEAD_B     # include its own digits
            self.agg_cum["in"] += len(win)
            self.agg_cum["out"] += 1
            self.agg_cum["bi"] += bi
            self.agg_cum["bo"] += agg["bo"]
            self.maclog(t, 3, "AGG w=%d in=%d red=%.0f%%" % (self.sf, len(win), red))
            t = self._send_own(node, agg, t)
        if node.nh:
            t = self._send_own(node, self._stat_frame(node, t), t + 1.0)
        self._forward_queue(node, t, end)

    def _control_slot(self, t: float, end: float) -> None:
        """CONTROL slot: CTRL from N4 (relayed), contention test, HELLO contention (spec §4, §5)."""
        # dashboard commands -> CTRL broadcast by N4, relayed once by N3 and N2 (r:1)
        if self.pending_ctrl:
            n4 = self.nodes[4]
            for cmd in self.pending_ctrl:
                if cmd.get("c") == "LIGHT_TEST":          # N4 only, not broadcast (spec §9.1)
                    self._apply_ctrl(cmd, t)
                    continue
                n4.seq_ctl += 1
                fr = {"t": "CTRL", "q": n4.seq_ctl, "ts": int(t), "c": cmd["c"], "a": cmd.get("a", 0),
                      "b": cmd.get("b", 0), "dur": cmd.get("dur", 0), "at": int(t), "id": cmd.get("id", 0)}
                if cmd.get("c") == "TEMP_WARN":             # integer argument (spec §3 CTRL ``v``)
                    fr["v"] = int(cmd.get("v", TEMP_WARN_DEFAULT))
                t = self.broadcast(n4, fr, t + 1)
                for relay in (3, 2):
                    if self.nodes[relay].active:
                        t = self.broadcast(self.nodes[relay], dict(fr, r=1), t + 2)
                self._apply_ctrl(cmd, t)
            self.pending_ctrl = []
        if self.contention_at is not None and self.contention_at <= end:
            self._contention_test(self.contention_at)
            self.contention_at = None
            t = max(t, self.contention_at or t) + 60
        self._hello_contention(t + 2)

    def _hello_contention(self, t: float) -> None:
        """Every active node sends HELLO in the CONTROL slot; CSMA deferral / collisions (spec §4)."""
        contenders = []
        for node in self.nodes.values():
            if not node.active:
                continue
            start = t + self.rng.uniform(0, 20)
            n = self.rng.randrange(MAC_CW_MIN)
            node.mac["bo"] += n * MAC_SLOT_MS
            contenders.append([start + MAC_DIFS_MS + n * MAC_SLOT_MS, node, n])
        contenders.sort(key=lambda c: c[0])
        free_at = -1e9
        last_tx: Optional[Tuple[float, Node]] = None
        for c in contenders:
            exp, node, n = c
            self.maclog(exp - n, node.num, "BACKOFF %d slots" % n)
            if last_tx and abs(exp - last_tx[0]) < 0.05:
                # both counters expired together: frames collide, receivers see NEAR_COLLISION
                for k, rx in self.nodes.items():
                    if k not in (node.num, last_tx[1].num) and rx.active:
                        rx.mac["col"] += 1
                self.maclog(exp, node.num, "NEAR_COLLISION with %s" % nid(last_tx[1].num))
                node.mac["tx"] += 1
                self.counters["bcast"]["HELLO"] += 1
                continue
            if exp < free_at:
                node.mac["def"] += 1
                node.mac["busy"] += 1
                self.maclog(exp, node.num, "CS_BUSY/DEFER")
                exp = free_at + MAC_DIFS_MS + self.rng.uniform(0, 2)
            node.seq_ctl += 1
            fr = {"t": "HELLO", "s": node.num, "d": 0, "q": node.seq_ctl, "ts": int(exp + node.clock_err),
                  "h": node.hops, "nh": node.nh, "c": node.cost, "ver": self.ver,
                  "up": int((exp - node.boot_ms) / 1000),
                  "nb": [[j, int(round(node.ble_ema.get(j, -100))), int(round(nb.wifi_rssi)),
                          int(nb.ack_rate()), int(nb.link_up)] for j, nb in node.nbrs.items()]}
            node.mac["tx"] += 1
            self.counters["bcast"]["HELLO"] += 1
            self.maclog(exp, node.num, "TX HELLO h=%d" % node.hops)
            end = exp + airtime_ms(frame_len(fr))
            free_at = end
            last_tx = (exp, node)
            self._deliver_bcast(node, fr, end)
            self.msglog(end, "HELLO", "broadcast", node.num, None, fr["q"], None, "")

    def _contention_test(self, T: float) -> None:
        """CONTENTION_TEST: N1 and N2 macSend a DATA to N3 at the same instant T (spec §4)."""
        tl: Dict[int, List[str]] = {1: [], 2: []}
        st: Dict[int, Dict[str, Any]] = {}
        for k in (1, 2):
            node = self.nodes[k]
            n = self.rng.randrange(MAC_CW_MIN)
            node.mac["bo"] += n
            st[k] = {"cw": MAC_CW_MIN, "exp": MAC_DIFS_MS * 1000 + n * 1000 + self.rng.uniform(0, 80),
                     "retries": 0, "done": not node.active}
            tl[k] += ["+0us CS_IDLE", "+0us BACKOFF %d" % n]
            self.maclog(T, k, "CONTENTION_TEST start, BACKOFF %d" % n)
        n3_ok = self.nodes[3].active
        guard = 0
        while not all(s["done"] for s in st.values()) and guard < 12:
            guard += 1
            live = sorted((k for k in st if not st[k]["done"]), key=lambda k: st[k]["exp"])
            a = live[0]
            b = live[1] if len(live) > 1 else None
            ea = st[a]["exp"]
            if b is not None and abs(st[b]["exp"] - ea) < 150:
                for k in (a, b):
                    s, node = st[k], self.nodes[k]
                    node.mac["tx" if s["retries"] == 0 else "retx"] += 1
                    tl[k].append("+%dus TX%s" % (s["exp"], "" if s["retries"] == 0 else " (retx)"))
                self.nodes[3].mac["col"] += 1
                self.maclog(T + ea / 1000, 3, "NEAR_COLLISION N1/N2")
                t_to = max(st[a]["exp"], st[b]["exp"]) + MAC_ACK_TIMEOUT_MS * 1000
                for k in (a, b):
                    s, node = st[k], self.nodes[k]
                    node.mac["to"] += 1
                    s["retries"] += 1
                    s["cw"] = min(s["cw"] * 2, MAC_CW_MAX)
                    n = self.rng.randrange(s["cw"])
                    node.mac["bo"] += n
                    tl[k].append("+%dus ACK_TIMEOUT → RETX" % t_to)
                    tl[k].append("+%dus BACKOFF %d (cw=%d)" % (t_to, n, s["cw"]))
                    s["exp"] = t_to + MAC_DIFS_MS * 1000 + n * 1000 + self.rng.uniform(0, 80)
                    self.maclog(T + t_to / 1000, k, "ACK_TIMEOUT → RETX (cw=%d)" % s["cw"])
                continue
            s, node = st[a], self.nodes[a]
            node.mac["tx" if s["retries"] == 0 else "retx"] += 1
            self.counters["ucast"]["DATA"] += 1
            tl[a].append("+%dus TX%s" % (ea, "" if s["retries"] == 0 else " (retx)"))
            self.maclog(T + ea / 1000, a, "TX DATA(test)→N3")
            busy_end = ea + airtime_ms(60) * 1000 + self.rng.uniform(1200, 2000)
            ok = n3_ok and not self.is_blocked(a, 3) and self.rng.random() > P_ACK_LOSS
            if ok:
                node.mac["ok"] += 1
                self.counters["ucast"]["ACK"] += 1
                tl[a].append("+%dus ACK_OK" % busy_end)
                self.maclog(T + busy_end / 1000, a, "ACK_OK (test)")
                self.msglog(T + busy_end / 1000, "DATA", "unicast", a, 3, "test", True, "%d>3" % a)
                s["done"] = True
            else:
                t_to = ea + MAC_ACK_TIMEOUT_MS * 1000
                node.mac["to"] += 1
                s["retries"] += 1
                s["cw"] = min(s["cw"] * 2, MAC_CW_MAX)
                tl[a].append("+%dus ACK_TIMEOUT → RETX" % t_to)
                if s["retries"] > MAC_MAX_RETRIES:
                    tl[a].append("+%dus TX_FAIL" % t_to)
                    self.msglog(T + t_to / 1000, "DATA", "unicast", a, 3, "test", False, "%d>3" % a)
                    s["done"] = True
                else:
                    n = self.rng.randrange(s["cw"])
                    tl[a].append("+%dus BACKOFF %d (cw=%d)" % (t_to, n, s["cw"]))
                    s["exp"] = t_to + MAC_DIFS_MS * 1000 + n * 1000
                busy_end = ea + airtime_ms(60) * 1000
            if b is not None and not st[b]["done"] and st[b]["exp"] > ea:
                sb, nb_ = st[b], self.nodes[b]
                remaining = sb["exp"] - ea
                nb_.mac["def"] += 1
                nb_.mac["busy"] += 1
                tl[b].append("+%dus CS_BUSY/DEFER" % (ea + self.rng.uniform(20, 120)))
                self.maclog(T + ea / 1000, b, "CS_BUSY/DEFER (contention test)")
                sb["exp"] = busy_end + MAC_DIFS_MS * 1000 + remaining
        self.contention_test = {"at": int(T), "N1": tl[1], "N2": tl[2]}
        self.event(T, 4, "mac", "CONTENTION_TEST done (N1 %d steps, N2 %d steps)" % (len(tl[1]), len(tl[2])))

    # ---------------------------------------------------------------------------------------------
    # §2 BLE
    # ---------------------------------------------------------------------------------------------
    def ble_scan(self, t: float) -> None:
        """BLE scans of every active node: RSSI from geometry + N(0, 2.5 dB), EMA 0.7/0.3."""
        for _ in range(BLE_SCANS_PER_SF):
            for a, na in self.nodes.items():
                if not na.active:
                    continue
                for b, nb in self.nodes.items():
                    if a == b or not nb.active:
                        continue
                    d_m = max(0.05, true_dist_cm(a, b) / 100.0)
                    r = config.RSSI_1M - 10 * config.PATH_LOSS_N * math.log10(d_m) + self.rng.gauss(0, BLE_SIGMA_DB)
                    na.ble_ema[b] = r if b not in na.ble_ema else 0.7 * na.ble_ema[b] + 0.3 * r
                    na.ble_seen[b] = t
        for na in self.nodes.values():
            for b in [b for b, ts in na.ble_seen.items() if t - ts > 5000]:
                na.ble_ema.pop(b, None)
                na.ble_seen.pop(b, None)

    # ---------------------------------------------------------------------------------------------
    # sink (N4) processing
    # ---------------------------------------------------------------------------------------------
    def _sink_now(self, t: float) -> float:
        """N4's netNow() (with its own sync error)."""
        return t + self.nodes[4].clock_err

    def _sink_data(self, fr: Dict[str, Any], t: float) -> None:
        """Raw DATA consumed at the sink (route without aggregation)."""
        o = fr["o"]
        self.sink_seqs[o].add(fr["q"])
        self.sink_val[o] = {"value": fr["v"], "seq": fr["q"], "value_ts": fr["ts"],
                            "threshold": bool(fr.get("th")),
                            "delay_ms": int(round(self._sink_now(t) - fr["ts"])),
                            "path": fr.get("p", "") + ">4"}
        self._light_on_sample(o, int(bool(fr.get("th"))), t)
        self._eval_light(t)                    # spec §9.3: a direct sample also drives the light

    def _sink_agg(self, fr: Dict[str, Any], t: float) -> None:
        """AGG consumed at the sink: per-origin seq/delay bookkeeping + aggregation block."""
        now = self._sink_now(t)
        for o in (1, 2):
            entries = fr["_qs"].get(o) or []
            for q, ts, v, th in entries:
                self.sink_seqs[o].add(q)
            if entries:
                q, ts, v, th = max(entries)
                self.sink_val[o] = {"value": v, "seq": q, "value_ts": ts, "threshold": bool(th),
                                    "delay_ms": int(round(now - ts)), "path": "%d>…>4" % o}
        self.sink_seqs[3].add(fr["q"])
        self.sink_val[3] = {"value": fr["n3"]["v"], "seq": fr["q"], "value_ts": fr["ts"],
                            "delay_ms": int(round(now - fr["ts"])), "path": fr["p"] + ">4"}

        def full(part: Optional[Dict[str, Any]], entries: List[Tuple[int, int, int, int]]) -> Optional[Dict[str, Any]]:
            if not part:
                return None
            vals = [e[2] for e in entries] or [part["v"]]
            return {"v": part["v"], "q": part["q"], "ts": part["ts"], "cnt": part["cnt"],
                    "mean": round(sum(vals) / len(vals), 1), "min": min(vals), "max": max(vals),
                    "th": int(part.get("th") or 0)}

        self.last_agg = {"window": fr["w"], "in": fr["in"], "bytes_in": fr["bi"], "bytes_out": fr["bo"],
                         "reduction_pct": fr["red"], "n1": full(fr.get("n1"), fr["_qs"].get(1, [])),
                         "n2": full(fr.get("n2"), fr["_qs"].get(2, [])), "n3": {"v": fr["n3"]["v"]},
                         "path": fr["p"] + ">4", "delay_ms": int(round(now - fr["ts"]))}
        self.last_agg_rx = t
        for o in MEMBERS:                      # a node missing from the AGG keeps its last flag
            part = fr.get("n%d" % o)
            if part:
                self._light_on_sample(o, int(bool(part.get("th"))), t)   # OR-fused over N3's window
        self._light_on_sample(0, 0, t)
        self._eval_light(t)                    # spec §9.3: after every AGG

    def _light_on_sample(self, o: int, th: int, t: float) -> None:
        """A sample reached the sink (firmware ``lightOnSample``): keep the light's freshness clocks.

        ``o`` = 1 or 2 when the sample carried that node's alert flag ``th`` (an AGG part or a DATA
        frame that reached N4 directly), anything else when it carried none. The newest arrival
        wins, whichever way it came: N2 may route ``2>4`` and bypass N3's aggregate.
        """
        self.last_sample_rx = t
        if o in MEMBERS:
            self.sink_th[o] = 1 if th else 0
            self.sink_th_rx[o] = t

    def _light_flag(self, o: int, t: float) -> bool:
        """True while node ``o``'s freshest flag is 1 and younger than LIGHT_STALE_SF superframes."""
        rx = self.sink_th_rx[o]
        return bool(self.sink_th[o]) and rx is not None and t - rx < LIGHT_STALE_SF * SF_MS

    def _eval_light(self, t: float) -> None:
        """Pond status light, two LEDs, red and green (spec §9.3, firmware ``lightEvaluate``).

        Called after every AGG, after every direct DATA, when LIGHT_TEST starts and at every slot
        boundary (the sink's service loop: blink, stale and test timing). Priority:

          test  > red, then green, LIGHT_TEST_MS each
          off   > no LED: no sample has reached the sink yet
          stale > green blinking: no AGG and no direct DATA for LIGHT_STALE_SF superframes
          red   > steady red: freshest N2 flag is 1 (water turbid)
          hot   > red blinking: freshest N1 flag is 1 (enclosure >= TEMP_WARN), water not turbid
          green   steady green: everything else

        There is no yellow LED. ``light_leds`` holds the LEDs lit at ``t`` (blink half-period
        LIGHT_BLINK_MS); only state, reason and since travel in the uplink. Logs
        ``light -> <state>`` as an N4 event on every state change.
        """
        blink_on = (int(t) // LIGHT_BLINK_MS) % 2 == 0
        green = red = False
        if self.light_test_start is not None and t - self.light_test_start >= 2 * LIGHT_TEST_MS:
            self.light_test_start = None                                   # test over
        if self.light_test_start is not None:
            state, reason = "test", "LIGHT_TEST"
            red = t - self.light_test_start < LIGHT_TEST_MS                # phase 0 red, 1 green
            green = not red
        elif self.last_sample_rx is None:
            state, reason = "off", "waiting for first data"
        elif t - self.last_sample_rx >= LIGHT_STALE_SF * SF_MS:
            # like the firmware the reason carries the age, so it grows while the light stays stale
            state, reason = "stale", "no data for %d s" % int((t - self.last_sample_rx) // 1000)
            green = blink_on
        elif self._light_flag(2, t):
            state, reason = "red", "turbidity threshold (D)"
            red = True
        elif self._light_flag(1, t):
            state, reason = "hot", "N1 enclosure hot"
            red = blink_on
        else:
            state, reason = "green", "all nominal"
            green = True
        self.light_leds = {"green": green, "red": red}
        if state != self.light["state"]:
            self.light["since"] = int(self._sink_now(t))
            self.event(t, 4, "light", "light -> %s" % state)
        self.light["state"], self.light["reason"] = state, reason

    def _sink_stat(self, fr: Dict[str, Any], t: float) -> None:
        """STAT consumed at the sink: snapshot of the node's counters."""
        self.sink_stat[fr["o"]] = copy.deepcopy(fr)

    # ---------------------------------------------------------------------------------------------
    # commands (spec §9.1)
    # ---------------------------------------------------------------------------------------------
    def accept_commands(self, cmds: List[Dict[str, Any]]) -> None:
        """Commands from the POST reply: dedupe by id, execute in the next CONTROL slot."""
        for c in cmds or []:
            cid = c.get("id")
            if cid in self.seen_cmd_ids:
                continue
            self.seen_cmd_ids.add(cid)
            self.pending_ctrl.append(c)

    def _apply_ctrl(self, cmd: Dict[str, Any], t: float) -> None:
        """Effect of a CTRL command on the network (spec §6, §9.1)."""
        c, a, b, dur = cmd.get("c"), int(cmd.get("a") or 0), int(cmd.get("b") or 0), int(cmd.get("dur") or 0)
        if c == "LINK_FAIL" and config.is_allowed_link(a, b):
            self.blocked[(min(a, b), max(a, b))] = t + (dur or 40) * 1000
            self.event(t, 4, "ctrl", "LINK_FAIL N%d–N%d for %ds" % (a, b, dur or 40))
        elif c == "LINK_RESTORE":
            if self.blocked.pop((min(a, b), max(a, b)), None) is not None:
                self.event(t, 4, "ctrl", "LINK_RESTORE N%d–N%d" % (a, b))
        elif c == "CONTENTION_TEST":
            # at = netNow()+1500 rounded into the next CONTROL slot (spec §9.1)
            target = t + 1500
            ctl = [i for i, o in enumerate(self.slots) if o == config.SLOT_CONTROL] or [4]
            sf_start = self.t0 + SF_MS * (1 + int((target - self.t0) // SF_MS))
            self.contention_at = sf_start + ctl[0] * SLOT_MS + 100
            self.event(t, 4, "ctrl", "CONTENTION_TEST scheduled at t=%d" % self.contention_at)
        elif c == "SCHED_UPDATE":
            self.sched_request = True
            self.event(t, 4, "ctrl", "SCHED_UPDATE requested")
        elif c == "RESET_STATS":
            self.reset_stats(t)
        elif c == "NODE_KILL" and a in (1, 2, 3):
            n = self.nodes[a]
            n.active = False
            n.kill_until = t + (dur or 30) * 1000
            n.queue, n.retry = [], []
            self.event(t, a, "node", "N%d killed (simulated failure) for %ds" % (a, dur or 30))
        elif c == "NODE_WAKE" and a in (1, 2, 3):
            self._wake(a, t)
        elif c == "LIGHT_TEST":
            # red -> green, LIGHT_TEST_MS each (2 s in total), then back to the data-driven state
            self.light_test_start = t
            self._eval_light(t)                               # shows as "light -> test" (§9.3)
        elif c == "TEMP_WARN":
            self.set_temp_warn(cmd.get("v"), t)

    def set_temp_warn(self, v: Any, t: float) -> bool:
        """TEMP_WARN at N1 (spec §9.1): store v (°C x100, 0..15000) as the alert threshold.

        Like the firmware it logs ``TEMP_WARN 45.00 C (was 60.00 C)`` as an N1 event; the new value
        travels back in STAT ``tw`` (uplink ``nodes[0].temp_warn``). Ignored when N1 is down (it
        would not hear the CTRL broadcast) or v is out of range. Returns True when applied.
        """
        n1 = self.nodes[1]
        try:
            v = int(v)
        except (TypeError, ValueError):
            return False
        if not n1.active or not config.TEMP_WARN_MIN_C100 <= v <= config.TEMP_WARN_MAX_C100:
            return False
        old, n1.temp_warn = n1.temp_warn, v
        msg = "TEMP_WARN %.2f C (was %.2f C)" % (v / 100.0, (old if old is not None else TEMP_WARN_DEFAULT) / 100.0)
        self.event(t, 1, "ctrl", msg)            # also lands in N1's STAT.ev
        return True

    def set_episode(self, name: str, on: bool) -> bool:
        """Switch a sensor episode ("turbid" at N2); True if it changed."""
        if name != "turbid":
            return False
        node = self.nodes[2]
        if node.episode == on:
            return False
        node.episode = on
        return True

    def _wake(self, a: int, t: float) -> None:
        """Bring a killed node back (it re-learns neighbours from HELLO)."""
        n = self.nodes[a]
        if n.active:
            return
        n.active = True
        n.kill_until = None
        n.clock_err = self.rng.uniform(-5, 5)
        for nb in n.nbrs.values():
            nb.known, nb.link_up, nb.hops = False, False, 255
        n.nh, n.hops = 0, 255
        # a rebooted node has no stale "not heard" memory (avoids spurious "N<k> left")
        self.last_heard[a] = {j: t for j in (1, 2, 3, 4) if j != a}
        self.event(t, a, "node", "N%d woke up" % a)

    def reset_stats(self, t: float) -> None:
        """RESET_STATS: zero node counters, sink bookkeeping and aggregation totals."""
        for n in self.nodes.values():
            n.mac = {k: 0 for k in n.mac}
            n.mac["bo"] = 0.0
            n.awake_ms = n.sleep_ms = 0.0
            n.tx_count = n.fwd_count = n.oor = 0
            n.ratio_hist.clear()
            for nb in n.nbrs.values():
                nb.life_ok = nb.life_fail = 0
        self.sink_seqs = {1: set(), 2: set(), 3: set()}
        self.nodes[1].temp_warn = TEMP_WARN_DEFAULT   # RESET_STATS restores N1's TEMP_WARN (§1.2)
        self.agg_cum = {"in": 0, "out": 0, "bi": 0, "bo": 0}
        self.counters = {"bcast": {"HELLO": 0, "SCHED": 0, "CTRL": 0},
                         "ucast": {"DATA": 0, "AGG": 0, "STAT": 0, "ACK": 0}}
        self.event(t, 4, "ctrl", "RESET_STATS")

    # ---------------------------------------------------------------------------------------------
    # one superframe
    # ---------------------------------------------------------------------------------------------
    def step(self) -> None:
        """Simulate one complete superframe (spec §5)."""
        t0 = self.t
        self.t0 = t0
        # expiries of LINK_FAIL / NODE_KILL
        for pair, exp in list(self.blocked.items()):
            if exp <= t0:
                del self.blocked[pair]
                self.event(t0, 4, "ctrl", "LINK_FAIL N%d–N%d expired" % pair)
        for k, n in self.nodes.items():
            if not n.active and n.kill_until is not None and n.kill_until <= t0:
                self._wake(k, t0)
        self.replan(t0)
        self.ble_scan(t0)
        for i in range(NSLOTS):
            s_start = t0 + i * SLOT_MS
            s_end = s_start + SLOT_MS
            owner = self.slots[i]
            self._account_awake(i, owner)
            if i == 0:
                self._beacon(s_start)
            elif owner == config.SLOT_CONTROL:
                self._control_slot(s_start, s_end)
            elif owner in MEMBERS and self.nodes[owner].active:
                self._member_slot(self.nodes[owner], s_start, s_end,
                                  retx_slot=(i != self.home_slot(owner)))
            elif owner == 3 and self.nodes[3].active:
                self._ch_slot(self.nodes[3], s_start, s_end)
            self.hello_timeouts(s_end)
            self._eval_light(s_end)            # sink service loop: blink, stale and test timing
        for k in MEMBERS:
            n = self.nodes[k]
            n.ratio_hist.append((n.mac["to"], n.mac["tx"] + n.mac["retx"]))
        self.sf += 1
        self.t = t0 + SF_MS

    def _account_awake(self, i: int, owner: int) -> None:
        """Sleep/wake accounting per slot (spec §5)."""
        for k, n in self.nodes.items():
            if not n.active:
                continue
            children = {c for c, cn in self.nodes.items() if cn.nh == k}
            if owner == config.SLOT_UNUSED:
                awake = False
            elif k in (3, 4):
                awake = True
            else:
                awake = i == 0 or owner == k or owner == config.SLOT_CONTROL or owner in children
            if awake:
                n.awake_ms += SLOT_MS
            else:
                n.sleep_ms += SLOT_MS

    # ---------------------------------------------------------------------------------------------
    # §8 localization + §9.1 uplink
    # ---------------------------------------------------------------------------------------------
    def _ble_tables(self) -> Dict[int, List[List[int]]]:
        """BLE tables as the sink knows them (STAT snapshots; N4's own table live)."""
        tabs: Dict[int, List[List[int]]] = {}
        for k in (1, 2, 3):
            if k in self.sink_stat and self._seen_recent(k):
                tabs[k] = self.sink_stat[k]["ble"]
        tabs[4] = [[j, int(round(r)), rssi_to_cm(r)] for j, r in sorted(self.nodes[4].ble_ema.items())]
        return tabs

    def _seen_recent(self, k: int) -> bool:
        """Sink heard anything from node k during the last 3 superframes."""
        return self.t - self.last_heard[4].get(k, -1e9) <= 3 * SF_MS

    def localization(self) -> Dict[str, Any]:
        """Weighted-centroid localization of all four nodes at the sink (spec §8)."""
        tabs = self._ble_tables()
        dist: Dict[Tuple[int, int], int] = {}
        matrix = []
        for i, rows in tabs.items():
            for j, rssi, dcm in rows:
                dist[(i, j)] = dcm
                matrix.append({"from": nid(i), "to": nid(j), "rssi": rssi, "dist_cm": dcm})
        targets = []
        for k in (1, 2, 3, 4):
            anchors = []
            for i in (1, 2, 3, 4):
                if i == k:
                    continue
                ds = [d for d in (dist.get((i, k)), dist.get((k, i))) if d is not None]
                if ds:
                    anchors.append({"id": nid(i), "dist_cm": int(round(sum(ds) / len(ds)))})
            true = list(config.NODE_POS[nid(k)])
            est = err = None
            if len(anchors) >= 3:
                ws = [1.0 / max(1.0, a["dist_cm"]) ** 2 for a in anchors]
                sx = sum(w * config.NODE_POS[a["id"]][0] for w, a in zip(ws, anchors))
                sy = sum(w * config.NODE_POS[a["id"]][1] for w, a in zip(ws, anchors))
                est = [round(sx / sum(ws), 1), round(sy / sum(ws), 1)]
                err = round(math.hypot(est[0] - true[0], est[1] - true[1]), 1)
            targets.append({"id": nid(k), "est": est, "true": true, "err_cm": err, "anchors": anchors})
        nearest = {}
        for k in (1, 2, 3, 4):
            if k == 4:
                nearest[nid(4)] = self.nodes[4].nearest()
            elif k in self.sink_stat and self._seen_recent(k):
                nearest[nid(k)] = self.sink_stat[k].get("near")
        return {"params": {"rssi_1m": config.RSSI_1M, "n": config.PATH_LOSS_N},
                "positions_true": {k: list(v) for k, v in config.NODE_POS.items()},
                "matrix": matrix, "targets": targets, "nearest": nearest}

    def _node_entry(self, k: int, meta: Dict[str, Any]) -> Dict[str, Any]:
        """One element of uplink.nodes[] (spec §9.1) from the sink's point of view."""
        now = self.t
        node = self.nodes[k]
        if k == 4:
            stat = self._stat_frame(node, now)
            node.seq_stat -= 1
            last_seen = 0.0
        else:
            stat = self.sink_stat.get(k)
            last_seen = (now - self.last_heard[4][k]) / 1000.0 if k in self.last_heard[4] else None
        # spec §9.1: inactive = nothing heard for 3 superframes
        active = last_seen is not None and last_seen <= 3 * SF_MS / 1000.0
        seqs = self.sink_seqs.get(k, set())
        val = self.sink_val.get(k, {})
        rt = (stat or {}).get("rt", {})
        nh = rt.get("nh", 0)
        wifi = (stat or {}).get("_wifi", {})
        e: Dict[str, Any] = dict(meta)
        e.update({
            "status": "active" if active else "inactive",
            "last_seen_s": None if last_seen is None else int(round(last_seen)),
            "mac_addr": node.mac_addr, "uptime_s": (stat or {}).get("up", 0),
            "value": val.get("value"), "seq": val.get("seq"), "value_ts": val.get("value_ts"),
            "threshold": val.get("threshold") if k in MEMBERS else None,
            "temp_warn": (stat or {}).get("tw") if k == 1 else None,   # N1 STAT.tw (spec §9.1)
            "route": "4" if k == 4 else self.route_string(k),
            "next_hop": nh, "hops": rt.get("h", 0 if k == 4 else 255),
            "alt_next_hop": rt.get("alt", 0), "route_cost": rt.get("c", 0), "alt_cost": rt.get("altc", 0),
            "delay_ms": val.get("delay_ms"),
            "wifi_rssi": int(round(wifi[nh])) if nh in wifi else None,
            "ble_rssi": int(round(self.nodes[4].ble_ema[k])) if k != 4 and k in self.nodes[4].ble_ema else None,
            "rx_count": len(seqs), "first_seq": min(seqs) if seqs else 0,
            "max_seq": max(seqs) if seqs else 0,
            "lost": (max(seqs) - min(seqs) + 1 - len(seqs)) if seqs else 0,
            "tx_count": (stat or {}).get("tx", 0), "fwd_count": (stat or {}).get("fw", 0),
            "oor": (stat or {}).get("oor", 0),
            "mac": dict((stat or {}).get("mac", {"tx": 0, "retx": 0, "ok": 0, "to": 0, "busy": 0,
                                                  "bo": 0, "col": 0, "def": 0})),
            "tdma": {"slot": self.home_slot(k), "ver": (stat or {}).get("tdma", {}).get("ver", self.ver),
                     "awake_ms": (stat or {}).get("tdma", {}).get("awake", 0),
                     "sleep_ms": (stat or {}).get("tdma", {}).get("sleep", 0),
                     "duty": (stat or {}).get("tdma", {}).get("duty", 0.0)},
            "ble": [{"id": nid(j), "rssi": r, "dist_cm": d} for j, r, d in (stat or {}).get("ble", [])],
            "nearest": (stat or {}).get("near"),
            "events": list((stat or {}).get("ev", [])),
        })
        if k == 3:
            e["agg"] = dict((stat or {}).get("agg", self.agg_cum))
        if k == 4:
            e["route_cost"], e["next_hop"], e["hops"] = 0, 0, 0
        return e

    def uplink(self) -> Dict[str, Any]:
        """Build the §9.1 uplink object (what N4 POSTs once per superframe)."""
        nodes = [self._node_entry(int(m["num"]), m) for m in config.NODE_META]  # type: ignore[arg-type]
        cum = self.agg_cum
        agg = dict(self.last_agg) if self.last_agg else {
            "window": self.sf, "in": 0, "bytes_in": 0, "bytes_out": 0, "reduction_pct": 0.0,
            "n1": None, "n2": None, "n3": None, "path": "", "delay_ms": None}
        agg["cum"] = {"in": cum["in"], "out": cum["out"], "bytes_in": cum["bi"], "bytes_out": cum["bo"],
                      "reduction_packets_pct": round((cum["in"] - cum["out"]) / cum["in"] * 100, 1) if cum["in"] else 0.0,
                      "reduction_bytes_pct": round((cum["bi"] - cum["bo"]) / cum["bi"] * 100, 1) if cum["bi"] else 0.0}
        links = []
        for a, b in config.ALLOWED_LINKS:
            na, nb = self.nodes[a], self.nodes[b]
            ab, ba = na.nbrs[b], nb.nbrs[a]
            ok, fail = ab.life_ok + ba.life_ok, ab.life_fail + ba.life_fail
            blocked = self.is_blocked(a, b)
            up = na.active and nb.active and ab.link_up and ba.link_up and not blocked
            ble = [x for x in (na.ble_ema.get(b), nb.ble_ema.get(a)) if x is not None]
            links.append({"a": nid(a), "b": nid(b), "up": bool(up),
                          "wifi_rssi": int(round((ab.wifi_rssi + ba.wifi_rssi) / 2)),
                          "ble_rssi": int(round(sum(ble) / len(ble))) if ble else None,
                          "ack_pct": round(ok * 100.0 / (ok + fail), 1) if ok + fail else 100.0,
                          "blocked": blocked})
        n4 = self.nodes[4]
        return {
            "source": "simulator", "sink": "N4", "net_time": int(self._sink_now(self.t)), "sf": self.sf,
            "uptime_s": int((self.t - n4.boot_ms) / 1000), "sched_master": self.master,
            "sink_ip": "127.0.0.1", "sink_mac": n4.mac_addr, "channel": 1,
            "nodes": nodes,
            "schedule": {"ver": self.ver, "sf": self.sf, "slot_ms": SLOT_MS, "slots": list(self.slots),
                         "t0": int(self.t0), "master": self.master, "why": self.why,
                         "history": list(self.sched_history)},
            "aggregation": agg,
            "localization": self.localization(),
            "links": links,
            "mac_log": sorted(self.mac_log, key=lambda e: e["t"]), "msg_log": list(self.msg_log), "events": list(self.events),
            "counters": copy.deepcopy(self.counters),
            "contention_test": self.contention_test,
            "light": {"state": self.light["state"], "reason": self.light["reason"],
                      "since": self.light["since"], "pins": dict(config.LIGHT_PINS)},
        }


# =================================================================================================
# demo scenario + main loop
# =================================================================================================
DEMO_TIMELINE: List[Tuple[float, Dict[str, Any]]] = [
    (30.0, {"c": "LINK_FAIL", "a": 1, "b": 3, "dur": 40}),
    (70.0, {"c": "LINK_RESTORE", "a": 1, "b": 3}),
    (85.0, {"c": "CONTENTION_TEST"}),
    (100.0, {"c": "SCHED_UPDATE"}),
    # "hot" light, red blinking (spec §9.3): move N1's alert threshold 1.00 °C below its live reading, then back
    (110.0, {"c": "TEMP_WARN", "a": 1, "v": "live-100"}),
    (118.0, {"c": "TEMP_WARN", "a": 1, "v": config.TEMP_WARN_DEFAULT_C100}),
]
DEMO_PERIOD_S = 120.0
#: Sensor episodes of the demo cycle (phase seconds [start, end)): turbid water at N2 (steady red light).
DEMO_EPISODES: List[Tuple[float, float, str]] = [
    (15.0, 25.0, "turbid"),
]


def due_demo_commands(sim_s: float, fired: set) -> List[Tuple[int, Dict[str, Any]]]:
    """DEMO_TIMELINE entries due at simulated time ``sim_s`` that have not fired yet.

    An entry is due once ``sim_s`` reaches ``cycle x DEMO_PERIOD_S + at``. The previous cycle is
    checked too, so an entry whose phase falls between two superframes at the end of a cycle
    (118 s while uplinks come at 117 s and 120 s) still fires, just after the wrap. Marks the
    returned entries in ``fired`` (keys ``(cycle, index)``).
    """
    cycle = int(sim_s // DEMO_PERIOD_S)
    out: List[Tuple[int, Dict[str, Any]]] = []
    for c in (cycle - 1, cycle):
        if c < 0:
            continue
        for i, (at, cmd) in enumerate(DEMO_TIMELINE):
            if (c, i) not in fired and sim_s >= c * DEMO_PERIOD_S + at:
                fired.add((c, i))
                out.append((i, cmd))
    return out


def demo_command(net: "Network", cmd: Dict[str, Any]) -> Dict[str, Any]:
    """Concrete command for a DEMO_TIMELINE entry.

    ``TEMP_WARN v = "live-100"`` becomes N1's latest value at the sink minus 100 (1.00 °C below the
    live reading, so N1's next DATA carries th = 1 and the light turns ``hot``, red blinking), clamped to the
    accepted 0..15000 range; 4500 if N1 has not delivered a value yet.
    """
    out = dict(cmd)
    if out.get("c") == "TEMP_WARN" and out.get("v") == "live-100":
        live = (net.sink_val.get(1) or {}).get("value")
        v = int(live) - 100 if isinstance(live, (int, float)) and live > 0 else 4500
        out["v"] = max(config.TEMP_WARN_MIN_C100, min(config.TEMP_WARN_MAX_C100, v))
    return out


def _post_json(url: str, obj: Dict[str, Any], timeout: float = 4.0) -> Dict[str, Any]:
    """POST a JSON object and return the decoded JSON reply."""
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point: run the network in real time and POST uplinks."""
    ap = argparse.ArgumentParser(description="AquaSense-WSN network simulator (spec §9.1 uplinks)")
    ap.add_argument("--url", default="http://127.0.0.1:%d/api/data" % config.PORT)
    ap.add_argument("--interval", type=float, default=SF_MS / 1000.0,
                    help="wall-clock seconds per simulated superframe (default 3)")
    ap.add_argument("--scenario", choices=["none", "demo"], default="none")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--duration", type=float, default=0, help="stop after N wall seconds (0 = forever)")
    ap.add_argument("--once", action="store_true", help="print one uplink JSON and exit")
    args = ap.parse_args(argv)

    net = Network(seed=args.seed)
    if args.once:
        net.step()
        print(json.dumps(net.uplink(), indent=1))
        return 0
    cmd_url = args.url.rsplit("/api/", 1)[0] + "/api/command"
    sim_start_sf = net.sf
    fired: set = set()
    local_id = -1
    wall0 = time.time()
    print("[sim] posting to %s every %.1fs (scenario=%s)" % (args.url, args.interval, args.scenario), flush=True)
    last_light = None
    while True:
        tick = time.time()
        if args.scenario == "demo":            # episodes apply to the superframe about to run
            phase_next = ((net.sf - sim_start_sf) * SF_MS / 1000.0) % DEMO_PERIOD_S
            for start, end, name in DEMO_EPISODES:
                if net.set_episode(name, start <= phase_next < end):
                    print("[sim] scenario -> %s episode %s" % (
                        name.upper(), "start" if start <= phase_next < end else "end"), flush=True)
        net.step()
        if args.scenario == "demo":
            sim_s = (net.sf - sim_start_sf) * SF_MS / 1000.0
            for _i, cmd in due_demo_commands(sim_s, fired):
                cmd = demo_command(net, cmd)
                try:
                    r = _post_json(cmd_url, cmd)
                    print("[sim] scenario -> %s%s (id %s)" % (
                        cmd["c"], " v=%d" % cmd["v"] if "v" in cmd else "", r.get("id")), flush=True)
                except (urllib.error.URLError, OSError, ValueError) as exc:
                    net.accept_commands([dict(cmd, id=local_id)])
                    local_id -= 1
                    print("[sim] scenario -> %s injected locally (%s)" % (cmd["c"], exc), flush=True)
        up = net.uplink()
        if up["light"]["state"] != last_light:
            last_light = up["light"]["state"]
            print("[N4 LIGHT] %s: %s" % (last_light, up["light"]["reason"]), flush=True)
        try:
            reply = _post_json(args.url, up)
            cmds = reply.get("commands") or []
            net.accept_commands(cmds)
            n1 = up["nodes"][0]
            print("[sim] sf=%d v%d %s N1 %s pdr=%d/%d %s" % (
                up["sf"], up["schedule"]["ver"], up["schedule"]["slots"], n1["route"], n1["rx_count"],
                n1["max_seq"] - n1["first_seq"] + 1,
                ("cmds " + ",".join(c["c"] for c in cmds)) if cmds else ""), flush=True)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            print("[sim] POST failed: %s" % exc, flush=True)
        if args.duration and time.time() - wall0 >= args.duration:
            return 0
        time.sleep(max(0.0, args.interval - (time.time() - tick)))


if __name__ == "__main__":
    sys.exit(main())
