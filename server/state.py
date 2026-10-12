"""Thread-safe in-memory store for the AquaSense-WSN dashboard (spec §9, §11).

The module owns the ONLY mutable server state: a single :class:`Store` instance exposed as
``STORE``. Flask request threads call :meth:`Store.ingest` (sink uplink, §9.1),
:meth:`Store.get_state` (browser poll, §9.2) and the command-queue methods (§9.1 server reply).

Derived metrics follow spec §11 exactly where the uplink carries the inputs; where the spec leaves
room (throughput byte accounting, time-series timestamps, statistics windows) the interpretation is
documented next to the code and summarised in ``INTERPRETATIONS`` at the bottom of this file.
"""
from __future__ import annotations

import copy
import csv
import json
import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any, Deque, Dict, List, Optional, Tuple

import config

ORIGINS: Tuple[str, ...] = ("N1", "N2", "N3")          # data origins measured at the sink (§11)
ALL_NODES: Tuple[str, ...] = ("N1", "N2", "N3", "N4")

SERIES_KEYS: Tuple[str, ...] = (
    "t", "sf", "pdr_N1", "pdr_N2", "pdr_N3", "delay_N1", "delay_N2", "delay_N3",
    "throughput", "retx_total", "loc_err_N1", "reduction",
    "value_N1", "value_N2", "value_N3",
)

DEMO_STEPS: Tuple[str, ...] = (
    "BLE Discovery", "RSSI Measurement", "Localization", "Wi-Fi Initialization",
    "Dynamic Schedule Assignment", "Channel Sensing", "Random Backoff", "Scheduled Transmission",
    "Unicast Communication", "Data Aggregation", "Multi-Hop Routing", "Sink", "Link Failure",
    "Failure Detection", "Alternate Route Selection", "Route Recovery", "Performance Analysis",
)

CSV_COLUMNS: Tuple[str, ...] = (
    "received_at", "source", "sf", "net_time", "sched_ver", "sched_why",
    "pdr_N1", "pdr_N2", "pdr_N3", "loss_N1", "loss_N2", "loss_N3", "lost_total", "rx_total",
    "delay_N1", "delay_N2", "delay_N3", "throughput_bps", "throughput_Bps",
    "retx_N1", "retx_N2", "retx_N3", "retx_N4", "retx_total",
    "loc_err_N1", "reduction_packets", "reduction_bytes",
    "route_N1", "route_N2", "route_N3", "value_N1", "value_N2", "value_N3", "light_state",
)

#: Estimated size (bytes) of a raw DATA frame that reaches the sink WITHOUT aggregation
#: (e.g. N1 data routed 1>2>4 while N3 is down). Only used by the throughput estimate.
DATA_BYTES_ESTIMATE: int = 60


# ------------------------------------------------------------------------------------------------
# small helpers
# ------------------------------------------------------------------------------------------------
def _num(x: Any) -> Optional[float]:
    """Return x as float if it is a real number (bool excluded), else None."""
    if isinstance(x, bool) or x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _r(x: Optional[float], nd: int = 2) -> Optional[float]:
    """Round helper that keeps None."""
    return None if x is None else round(x, nd)


def _now_iso() -> str:
    """Local wall-clock timestamp, second resolution (spec §9.2 ``received_at`` example)."""
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _node_map(uplink: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """Index ``uplink.nodes`` by id ("N1".."N4"); tolerates entries that only carry ``num``."""
    out: Dict[str, Dict[str, Any]] = {}
    for n in uplink.get("nodes") or []:
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        if not nid and _num(n.get("num")) is not None:
            nid = "N%d" % int(n["num"])
        if isinstance(nid, str):
            out[nid] = n
    return out


def _all_event_strings(uplink: Dict[str, Any]) -> List[Tuple[str, str]]:
    """Every event-like string in an uplink as (node, text): events[], nodes[].events, mac_log[]."""
    out: List[Tuple[str, str]] = []
    for e in uplink.get("events") or []:
        if isinstance(e, dict):
            out.append((str(e.get("node", "")), str(e.get("msg", ""))))
        elif isinstance(e, str):
            out.append(("", e))
    for nid, n in _node_map(uplink).items():
        for e in n.get("events") or []:
            out.append((nid, str(e)))
    for e in uplink.get("mac_log") or []:
        if isinstance(e, dict):
            out.append((str(e.get("node", "")), str(e.get("ev", ""))))
    return out


def _int_or_none(x: Any) -> Optional[int]:
    """Return x as int when it is an integral number (bool excluded), else None."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    if isinstance(x, float) and (x != x or x != int(x)):
        return None
    return int(x)


def default_light() -> Dict[str, Any]:
    """§9.1 ``light`` object used when an uplink carries none (older firmware / simulator)."""
    return {"state": "off", "reason": "no uplink", "since": None, "pins": dict(config.LIGHT_PINS)}


def _normalise_uplink(uplink: Dict[str, Any]) -> Dict[str, Any]:
    """Shallow copy of an uplink with the §9.1 fields added after v1 filled in.

    * ``light`` (§9.1, §9.3): defaulted when absent so old uplinks still validate and render;
      missing keys of a partial object are completed from :func:`default_light`.
    * ``nodes[].threshold`` (§1.2 ``th`` flag of the latest DATA, N1/N2 only): passed through;
      0/1 integers become booleans, anything else (absent, null) becomes ``None``.
    * ``nodes[].temp_warn`` (§9.1, N1's current TEMP_WARN threshold in °C x100 from STAT ``tw``):
      passed through as an int; absent, null or non-integer values become ``None``.
    Every other field is passed through untouched (the caller's object is never mutated).
    """
    up = dict(uplink)
    light = up.get("light")
    if isinstance(light, dict):
        merged = default_light()
        merged.update(light)
        if not isinstance(merged.get("pins"), dict):
            merged["pins"] = dict(config.LIGHT_PINS)
        merged["state"] = str(merged.get("state") or "off").lower()
        up["light"] = merged
    else:
        up["light"] = default_light()
    nodes = []
    for n in up.get("nodes") or []:
        n = dict(n)
        th = n.get("threshold")
        if isinstance(th, bool) or th is None:
            n["threshold"] = th
        elif isinstance(th, (int, float)) and th in (0, 1):
            n["threshold"] = bool(th)
        else:
            n["threshold"] = None
        n["temp_warn"] = _int_or_none(n.get("temp_warn"))
        nodes.append(n)
    up["nodes"] = nodes
    return up


class _RunningStat:
    """last/avg/min/max accumulator (spec §9.2 delay_ms and loc_err_cm objects)."""

    __slots__ = ("last", "total", "n", "min", "max")

    def __init__(self) -> None:
        self.last: Optional[float] = None
        self.total = 0.0
        self.n = 0
        self.min: Optional[float] = None
        self.max: Optional[float] = None

    def add(self, v: float) -> None:
        """Add one sample."""
        self.last = v
        self.total += v
        self.n += 1
        self.min = v if self.min is None else min(self.min, v)
        self.max = v if self.max is None else max(self.max, v)

    def as_dict(self) -> Dict[str, Optional[float]]:
        """Return {last, avg, min, max} rounded to 1 decimal."""
        return {"last": _r(self.last, 1), "avg": _r(self.total / self.n if self.n else None, 1),
                "min": _r(self.min, 1), "max": _r(self.max, 1)}


# ------------------------------------------------------------------------------------------------
# command validation (spec §9.1 "Commands")
# ------------------------------------------------------------------------------------------------
def validate_command(body: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate a POST /api/command body ``{c, a, b, dur}`` or ``{c:"TEMP_WARN", a:1, v}`` (spec §9.1).

    Returns ``(normalised_command, None)`` or ``(None, error_message)``. The normalised command
    always carries all four keys ``c, a, b, dur`` (unused ones = 0) so the firmware can read them
    unconditionally; TEMP_WARN additionally carries ``v`` (N1 alert threshold, °C x100,
    ``TEMP_WARN_MIN_C100..TEMP_WARN_MAX_C100``); ``id`` is added when queued.
    """
    if not isinstance(body, dict):
        return None, "body must be a JSON object"
    c = str(body.get("c", "")).strip().upper()
    if c not in config.COMMANDS:
        return None, "unknown command %r; allowed: %s" % (c, ", ".join(sorted(config.COMMANDS)))

    def _int(key: str, default: int = 0) -> Optional[int]:
        v = body.get(key, default)
        if v is None or v == "":
            return default
        try:
            return int(str(v).strip().lstrip("Nn"))
        except (TypeError, ValueError):
            return None

    a, b, dur = _int("a"), _int("b"), _int("dur")
    if a is None or b is None or dur is None:
        return None, "a, b, dur must be integers"
    if c in ("LINK_FAIL", "LINK_RESTORE"):
        if not config.is_allowed_link(a, b):
            return None, "a-b must be an allowed link: %s" % config.ALLOWED_LINKS
        if c == "LINK_FAIL":
            dur = dur or config.DEFAULT_LINK_FAIL_DUR_S
            if not 1 <= dur <= 3600:
                return None, "dur must be 1..3600 s"
        else:
            dur = 0
    elif c in ("NODE_KILL", "NODE_WAKE"):
        # N4 is the sink: killing it would stop the uplink itself, so only 1..3 are accepted.
        if a not in (1, 2, 3):
            return None, "a must be a node number 1..3 (the sink N4 cannot be killed)"
        b = 0
        if c == "NODE_KILL":
            dur = dur or config.DEFAULT_NODE_KILL_DUR_S
            if not 1 <= dur <= 3600:
                return None, "dur must be 1..3600 s"
        else:
            dur = 0
    elif c == "TEMP_WARN":
        # N1 is the only node with an over-temperature alert (spec §1.2); a defaults to 1.
        if a not in (0, 1):
            return None, "a must be 1 (TEMP_WARN applies to N1 only)"
        v = body.get("v")
        if isinstance(v, str):
            try:
                v = int(v.strip())
            except ValueError:
                return None, "v must be an integer (°C x100)"
        if isinstance(v, float) and v == v and v == int(v):
            v = int(v)
        if isinstance(v, bool) or not isinstance(v, int):
            return None, "v must be an integer (°C x100), e.g. 4500 for 45.00 °C"
        if not config.TEMP_WARN_MIN_C100 <= v <= config.TEMP_WARN_MAX_C100:
            return None, "v must be %d..%d (°C x100)" % (config.TEMP_WARN_MIN_C100, config.TEMP_WARN_MAX_C100)
        return {"c": c, "a": 1, "b": 0, "dur": 0, "v": v}, None
    else:
        a = b = dur = 0
    return {"c": c, "a": a, "b": b, "dur": dur}, None


def validate_uplink(obj: Any) -> Optional[str]:
    """Minimal shape check of a §9.1 uplink; returns an error string or None if acceptable."""
    if not isinstance(obj, dict):
        return "uplink must be a JSON object"
    nodes = obj.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return "uplink.nodes must be a non-empty list"
    if not all(isinstance(n, dict) for n in nodes):
        return "uplink.nodes entries must be objects"
    for key in ("schedule", "aggregation", "localization", "counters", "light"):
        if key in obj and obj[key] is not None and not isinstance(obj[key], dict):
            return "uplink.%s must be an object" % key
    return None


# ------------------------------------------------------------------------------------------------
# empty skeleton (spec §9.1 shape with neutral values) — the UI must never crash
# ------------------------------------------------------------------------------------------------
def empty_uplink() -> Dict[str, Any]:
    """Return a well-formed §9.1 uplink with no data (used before the first real uplink)."""
    nodes = []
    for m in config.NODE_META:
        nodes.append({
            **m, "status": "inactive", "last_seen_s": None, "mac_addr": None, "uptime_s": 0,
            "value": None, "seq": None, "value_ts": None, "threshold": None, "temp_warn": None, "route": "", "next_hop": 0, "hops": 255,
            "alt_next_hop": 0, "route_cost": None, "alt_cost": None, "delay_ms": None,
            "wifi_rssi": None, "ble_rssi": None, "rx_count": 0, "first_seq": 0, "max_seq": 0,
            "lost": 0, "tx_count": 0, "fwd_count": 0, "oor": 0,
            "mac": {"tx": 0, "retx": 0, "ok": 0, "to": 0, "busy": 0, "bo": 0, "col": 0, "def": 0},
            "tdma": {"slot": -1, "ver": 0, "awake_ms": 0, "sleep_ms": 0, "duty": 0.0},
            "ble": [], "nearest": None, "events": [],
        })
    return {
        "source": None, "sink": "N4", "net_time": 0, "sf": 0, "uptime_s": 0, "sched_master": 3,
        "sink_ip": None, "sink_mac": None, "channel": None,
        "nodes": nodes,
        "schedule": {"ver": 0, "sf": 0, "slot_ms": config.TDMA_SLOT_MS,
                     "slots": list(config.DEFAULT_SLOTS), "t0": 0, "master": 3, "why": "",
                     "history": []},
        "aggregation": {"window": 0, "in": 0, "bytes_in": 0, "bytes_out": 0, "reduction_pct": 0.0,
                        "n1": None, "n2": None, "n3": None, "path": "", "delay_ms": None,
                        "cum": {"in": 0, "out": 0, "bytes_in": 0, "bytes_out": 0,
                                "reduction_packets_pct": 0.0, "reduction_bytes_pct": 0.0}},
        "localization": {"params": {"rssi_1m": config.RSSI_1M, "n": config.PATH_LOSS_N},
                         "positions_true": {k: list(v) for k, v in config.NODE_POS.items()},
                         "matrix": [], "targets": [], "nearest": {}},
        "links": [{"a": "N%d" % a, "b": "N%d" % b, "up": False, "wifi_rssi": None,
                   "ble_rssi": None, "ack_pct": None, "blocked": False}
                  for a, b in config.ALLOWED_LINKS],
        "mac_log": [], "msg_log": [], "events": [],
        "counters": {"bcast": {"HELLO": 0, "SCHED": 0, "CTRL": 0},
                     "ucast": {"DATA": 0, "AGG": 0, "STAT": 0, "ACK": 0}},
        "contention_test": None,
        "light": default_light(),
    }


def _empty_series() -> Dict[str, Deque[Any]]:
    """Fresh ring buffers for every series key (spec §9.2 ``series``)."""
    return {k: deque(maxlen=config.HISTORY_SERIES_LEN) for k in SERIES_KEYS}


# ------------------------------------------------------------------------------------------------
# the store
# ------------------------------------------------------------------------------------------------
class Store:
    """All mutable server state behind one re-entrant lock."""

    def __init__(self, log_dir: Optional[str] = None, persist: bool = True) -> None:
        self._lock = threading.RLock()
        self.log_dir = log_dir or config.LOG_DIR
        self.persist = persist
        self.last_uplink: Optional[Dict[str, Any]] = None
        self.last_rx_wall: Optional[float] = None
        self.last_received_at: Optional[str] = None
        self.uplinks: Deque[Dict[str, Any]] = deque(maxlen=config.UPLINK_RING_LEN)
        self.uplink_count = 0
        # command queue (spec §9.1 server reply)
        self._next_cmd_id = 1
        self._pending: List[Dict[str, Any]] = []
        self._recent: Deque[Dict[str, Any]] = deque(maxlen=50)
        # histories survive RESET_STATS (they describe what happened, not statistics)
        self.schedule_history: List[Dict[str, Any]] = []
        self.route_history: List[Dict[str, Any]] = []
        self._sched_seen: set = set()
        self._last_routes: Dict[str, str] = {}
        self._pending_reasons: List[List[Any]] = []
        self._reason_t: Dict[str, float] = {}
        self.light_history: List[Dict[str, Any]] = []      # §9.3 state changes, newest last
        self._last_light_state: Optional[str] = None
        self._reset_accumulators()

    # -- accumulators ----------------------------------------------------------------------------
    def _reset_accumulators(self) -> None:
        """Reset every derived statistic (on start-up and on RESET_STATS)."""
        self._delay: Dict[str, _RunningStat] = {k: _RunningStat() for k in ORIGINS}
        self._loc: Dict[str, _RunningStat] = {k: _RunningStat() for k in ALL_NODES}
        self._last_seq: Dict[str, Any] = {}
        self._last_rx: Dict[str, float] = {}
        self._last_agg_window: Any = None
        self._last_loc_sf: Any = None
        self._tput: Deque[Tuple[float, Dict[str, float]]] = deque()
        self._tput_first: Optional[float] = None
        self.series = _empty_series()
        self._sticky = {"link_down": False, "link_fail": False, "restored": False, "alt_route": False}
        self.derived: Dict[str, Any] = self._blank_derived()

    @staticmethod
    def _blank_derived() -> Dict[str, Any]:
        """Derived block with no data (spec §9.2 keys always present)."""
        return {
            "received_at": None, "age_s": None, "online": False, "source": None,
            "metrics": {"pdr": {}, "packet_loss": {}, "lost_total": 0, "rx_total": 0,
                        "delay_ms": {}, "throughput_bps": {"total": 0.0},
                        "throughput_Bps": {"total": 0.0},
                        "retransmissions": {"total": 0}, "timeouts": {"total": 0},
                        "loc_err_cm": {}, "reduction_pct": {"packets": None, "bytes": None}},
            "series": {k: [] for k in SERIES_KEYS},
            "demo_flow": {k: False for k in DEMO_STEPS},
            "schedule_history": [], "route_history": [], "light_history": [],
        }

    # -- §9.1 ingest -----------------------------------------------------------------------------
    def ingest(self, uplink: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
        """Store one sink uplink (§9.1), update derived metrics (§9.2/§11), persist it.

        Returns the freshly computed derived block.
        """
        now = time.time() if now is None else now
        uplink = _normalise_uplink(uplink)
        with self._lock:
            received_at = _now_iso()
            self.last_uplink = uplink
            self.last_rx_wall = now
            self.last_received_at = received_at
            self.uplinks.append({"received_at": received_at, "uplink": uplink})
            self.uplink_count += 1
            nodes = _node_map(uplink)

            self._track_schedule(uplink, received_at)
            self._track_routes(uplink, nodes, received_at)
            self._track_light(uplink, received_at)
            metrics = self._compute_metrics(uplink, nodes, now)
            self._append_series(uplink, nodes, metrics, now)
            demo = self._demo_flow(uplink, nodes, metrics, online=True)

            self.derived = {
                "received_at": received_at, "age_s": 0.0, "online": True,
                "source": uplink.get("source"),
                "metrics": metrics,
                "series": None,  # filled lazily by get_state (sliced copy)
                "demo_flow": demo,
                "schedule_history": self.schedule_history,
                "route_history": self.route_history,
                "light_history": self.light_history,
            }
            if self.persist:
                self._persist(uplink, received_at, metrics, nodes)
            return self._derived_view(now)

    # -- §5 / §9.2 schedule_history ---------------------------------------------------------------
    def _track_schedule(self, uplink: Dict[str, Any], received_at: str) -> None:
        """Accumulate (ver, why, t) entries from schedule.history and from ver changes (§5)."""
        sch = uplink.get("schedule") or {}
        entries = list(sch.get("history") or [])
        if _num(sch.get("ver")) is not None:
            entries.append({"ver": sch.get("ver"), "why": sch.get("why", ""),
                            "t": sch.get("t0", uplink.get("net_time")), "slots": sch.get("slots")})
        for e in entries:
            if not isinstance(e, dict):
                continue
            key = (e.get("ver"), str(e.get("why", "")))
            if key in self._sched_seen:
                continue
            self._sched_seen.add(key)
            row = {"ver": e.get("ver"), "why": e.get("why", ""), "t": e.get("t"),
                   "received_at": received_at}
            if e.get("slots") is not None:
                row["slots"] = e.get("slots")
            self.schedule_history.append(row)
        self.schedule_history.sort(key=lambda r: (_num(r.get("ver")) or 0))
        del self.schedule_history[:-200]

    # -- §6 / §9.2 route_history -----------------------------------------------------------------
    _ROUTE_KEYS = ("ROUTE RESTORED", "ROUTE", "LINK_DOWN", "LINK_UP")

    def _track_routes(self, uplink: Dict[str, Any], nodes: Dict[str, Dict[str, Any]],
                      received_at: str) -> None:
        """Detect per-node route string changes between consecutive uplinks (§6, §9.2).

        The sink sees a node's new route (from the DATA/AGG path field) one superframe BEFORE that
        node's STAT frame delivers the routing event text, so the reason is resolved lazily: the
        first routing event of that node that is newer than the one used for the previous change
        (see ``_resolve_route_reasons``). FIX: the old code attached the previous change's reason.
        """
        for nid in ORIGINS:
            n = nodes.get(nid)
            if not n:
                continue
            route = n.get("route")
            if not isinstance(route, str) or not route:
                continue
            prev = self._last_routes.get(nid)
            self._last_routes[nid] = route
            if prev is None or prev == route:
                continue
            entry = {
                "t": uplink.get("net_time"), "received_at": received_at, "node": nid,
                "from": prev, "to": route, "reason": "resolving…",
            }
            self.route_history.append(entry)
            self._pending_reasons.append([entry, 3])      # try for up to 3 more uplinks
            self._sticky["alt_route"] = True
            del self.route_history[:-200]
        self._resolve_route_reasons(uplink)

    def _resolve_route_reasons(self, uplink: Dict[str, Any]) -> None:
        """Fill in the reason of pending route changes from the newest routing event that is newer
        than the one already consumed for that node; after 3 uplinks fall back to a derived text."""
        still: List[List[Any]] = []
        for entry, left in self._pending_reasons:
            nid = entry["node"]
            last_t = self._reason_t.get(nid, -1)
            best = None
            for e in uplink.get("events") or []:
                if not isinstance(e, dict) or e.get("node") != nid:
                    continue
                msg = str(e.get("msg", ""))
                t = _num(e.get("t"))
                if t is None or t <= last_t or not any(k in msg for k in self._ROUTE_KEYS):
                    continue
                rank = next(i for i, k in enumerate(self._ROUTE_KEYS) if k in msg)
                key = (t, -rank)
                if best is None or key > best[0]:
                    best = (key, msg, t)
            if best is not None:
                entry["reason"] = best[1]
                self._reason_t[nid] = best[2]
            elif left > 0:
                still.append([entry, left - 1])
            else:
                hops_from, hops_to = entry["from"].count(">"), entry["to"].count(">")
                entry["reason"] = ("primary route restored" if hops_to < hops_from
                                   else "alternate route selected (link failure)")
        self._pending_reasons = still

    # -- §9.3 light_history -----------------------------------------------------------------------
    def _track_light(self, uplink: Dict[str, Any], received_at: str) -> None:
        """Record every change of the pond status light state between uplinks (§9.3).

        ``t`` is the sink's ``light.since`` (network time of the change) when reported, else the
        uplink's ``net_time``. The first uplink records the initial state. Newest 30 are kept.
        """
        light = uplink.get("light") or {}
        state = str(light.get("state") or "off")
        if state == self._last_light_state:
            return
        self._last_light_state = state
        since = light.get("since")
        t = since if _num(since) is not None else uplink.get("net_time")
        self.light_history.append({"t": t, "state": state, "reason": str(light.get("reason") or ""),
                                   "received_at": received_at})
        del self.light_history[:-config.LIGHT_HISTORY_LEN]

    # -- §11 metrics -----------------------------------------------------------------------------
    def _compute_metrics(self, uplink: Dict[str, Any], nodes: Dict[str, Dict[str, Any]],
                         now: float) -> Dict[str, Any]:
        """Compute the §9.2 ``metrics`` block from one uplink plus accumulated history."""
        pdr: Dict[str, float] = {}
        loss: Dict[str, float] = {}
        lost_total = 0
        rx_total = 0
        # PDR / loss per origin (§11): rx_unique / (max_seq - first_seq + 1) * 100
        for nid in ORIGINS:
            n = nodes.get(nid) or {}
            rx, fs, ms = _num(n.get("rx_count")), _num(n.get("first_seq")), _num(n.get("max_seq"))
            if rx is None or fs is None or ms is None:
                continue
            expected = ms - fs + 1
            if expected <= 0 or rx <= 0:
                continue
            p = min(100.0, rx / expected * 100.0)
            pdr[nid] = round(p, 2)
            loss[nid] = round(100.0 - p, 2)
            lost = _num(n.get("lost"))
            lost_total += int(lost if lost is not None else max(0.0, expected - rx))
            rx_total += int(rx)

        # End-to-end delay per origin (§11). N1/N2 from nodes[].delay_ms, N3 from
        # aggregation.delay_ms. A sample is taken only when a NEW packet arrived (seq / AGG window
        # changed) so a repeated uplink of the same packet is not double counted.
        agg = uplink.get("aggregation") or {}
        for nid in ORIGINS:
            n = nodes.get(nid) or {}
            if nid == "N3":
                d = _num(agg.get("delay_ms"))
                if d is None:
                    d = _num(n.get("delay_ms"))
                marker = agg.get("window", n.get("seq"))
            else:
                d = _num(n.get("delay_ms"))
                marker = n.get("seq")
            if d is None or d < 0:
                continue
            key = "delay_" + nid
            if marker is not None and self._last_seq.get(key) == marker:
                continue
            self._last_seq[key] = marker
            self._delay[nid].add(d)
        delay = {k: s.as_dict() for k, s in self._delay.items() if s.n}

        # Throughput (§11): sum of payload bytes delivered at the sink in the last 30 s / 30.
        delivered = self._estimate_delivered_bytes(uplink, nodes)
        self._tput.append((now, delivered))
        if self._tput_first is None:
            self._tput_first = now
        while self._tput and self._tput[0][0] < now - config.THROUGHPUT_WINDOW_S:
            self._tput.popleft()
        sf_s = config.SUPERFRAME_MS / 1000.0
        # Before 30 s of data exist, divide by the elapsed span (+1 superframe, because the first
        # uplink already carries one superframe's worth of bytes) so the rate is not under-reported.
        span = min(config.THROUGHPUT_WINDOW_S, max(sf_s, now - self._tput_first + sf_s))
        sums: Dict[str, float] = {k: 0.0 for k in ORIGINS}
        for _, d in self._tput:
            for k, v in d.items():
                sums[k] = sums.get(k, 0.0) + v
        tput_Bps = {k: round(v / span, 1) for k, v in sums.items()}
        tput_Bps["total"] = round(sum(sums.values()) / span, 1)
        tput_bps = {k: round(v * 8, 1) for k, v in tput_Bps.items()}

        # Retransmissions / timeouts (§11): nodes[*].mac.retx and .to (cumulative node counters)
        retx: Dict[str, int] = {}
        tos: Dict[str, int] = {}
        for nid in ALL_NODES:
            mac = (nodes.get(nid) or {}).get("mac")
            if isinstance(mac, dict):
                if _num(mac.get("retx")) is not None:
                    retx[nid] = int(mac["retx"])
                if _num(mac.get("to")) is not None:
                    tos[nid] = int(mac["to"])
        retx["total"] = sum(retx.values())
        tos["total"] = sum(tos.values())

        # Localization error (§8, §11): localization.targets[*].err_cm, one sample per superframe
        loc = uplink.get("localization") or {}
        sf = uplink.get("sf")
        if sf is None or sf != self._last_loc_sf:
            self._last_loc_sf = sf
            for t in loc.get("targets") or []:
                if isinstance(t, dict) and t.get("id") in self._loc:
                    e = _num(t.get("err_cm"))
                    if e is not None and t.get("est") is not None:
                        self._loc[t["id"]].add(e)
        loc_err = {k: s.as_dict() for k, s in self._loc.items() if s.n}

        # Data reduction (§7, §11): prefer the sink's cumulative values, else compute them
        cum = agg.get("cum") or {}
        rp, rb = _num(cum.get("reduction_packets_pct")), _num(cum.get("reduction_bytes_pct"))
        if rp is None:
            ci, co = _num(cum.get("in")), _num(cum.get("out"))
            rp = (ci - co) / ci * 100.0 if ci and co is not None else _num(agg.get("reduction_pct"))
        if rb is None:
            bi, bo = _num(cum.get("bytes_in")), _num(cum.get("bytes_out"))
            rb = (bi - bo) / bi * 100.0 if bi and bo is not None else None

        return {
            "pdr": pdr, "packet_loss": loss, "lost_total": lost_total, "rx_total": rx_total,
            "delay_ms": delay, "throughput_bps": tput_bps, "throughput_Bps": tput_Bps,
            "retransmissions": retx, "timeouts": tos, "loc_err_cm": loc_err,
            "reduction_pct": {"packets": _r(rp, 1), "bytes": _r(rb, 1)},
        }

    def _estimate_delivered_bytes(self, uplink: Dict[str, Any],
                                  nodes: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
        """Estimate payload bytes delivered at the sink since the previous uplink (§11 throughput).

        The uplink does not report raw byte counts per origin, so the server ESTIMATES:

            payload_bytes_delivered = aggregation.bytes_out          (once per NEW AGG window)
                                    + 40 bytes per node STAT received (N1..N3, status active and
                                                                       last_seen_s <= 1 superframe)
                                    + 60 bytes per raw DATA delivered without aggregation
                                      (rx_count increase of N1/N2 in an uplink whose AGG did not
                                       contain that origin, e.g. route 1>2>4 while N3 is down)

        AGG bytes are split equally between the origins it carries (n1/n2 with cnt>0, n3 with a
        valid value). STAT bytes are attributed to the STAT's sender.
        """
        out: Dict[str, float] = {k: 0.0 for k in ORIGINS}
        agg = uplink.get("aggregation") or {}
        window = agg.get("window")
        in_agg: set = set()
        if window is not None and window != self._last_agg_window and (_num(agg.get("in")) or 0) > 0:
            self._last_agg_window = window
            carried = []
            for key, nid in (("n1", "N1"), ("n2", "N2")):
                part = agg.get(key)
                if isinstance(part, dict) and (_num(part.get("cnt")) or 0) > 0:
                    carried.append(nid)
            n3 = agg.get("n3")
            if isinstance(n3, dict) and _num(n3.get("v")) is not None and n3.get("v") != -1:
                carried.append("N3")
            carried = carried or ["N3"]
            share = (_num(agg.get("bytes_out")) or 0.0) / len(carried)
            for nid in carried:
                out[nid] += share
                in_agg.add(nid)
        for nid in ORIGINS:
            n = nodes.get(nid) or {}
            last_seen = _num(n.get("last_seen_s"))
            if n.get("status") == "active" and (last_seen is None or
                                                last_seen <= config.SUPERFRAME_MS / 1000.0):
                out[nid] += config.STAT_BYTES_ESTIMATE
            rx = _num(n.get("rx_count"))
            prev = self._last_rx.get(nid)
            if rx is not None:
                if nid in ("N1", "N2") and nid not in in_agg and prev is not None and rx > prev:
                    out[nid] += (rx - prev) * DATA_BYTES_ESTIMATE
                self._last_rx[nid] = rx
        return out

    # -- §9.2 series -----------------------------------------------------------------------------
    def _append_series(self, uplink: Dict[str, Any], nodes: Dict[str, Dict[str, Any]],
                       m: Dict[str, Any], now: float) -> None:
        """Append one sample per key of §9.2 ``series`` (null where a value is unavailable)."""
        s = self.series

        def dl(nid: str) -> Optional[float]:
            if nid == "N3":
                v = _num((uplink.get("aggregation") or {}).get("delay_ms"))
                return v if v is not None else _num((nodes.get("N3") or {}).get("delay_ms"))
            return _num((nodes.get(nid) or {}).get("delay_ms"))

        loc_n1 = None
        for t in (uplink.get("localization") or {}).get("targets") or []:
            if isinstance(t, dict) and t.get("id") == "N1":
                loc_n1 = _num(t.get("err_cm"))
        s["t"].append(datetime.fromtimestamp(now).strftime("%H:%M:%S"))
        s["sf"].append(uplink.get("sf"))
        for nid in ORIGINS:
            s["pdr_" + nid].append(m["pdr"].get(nid))
            s["delay_" + nid].append(dl(nid))
            s["value_" + nid].append(_num((nodes.get(nid) or {}).get("value")))
        s["throughput"].append(m["throughput_bps"].get("total"))
        s["retx_total"].append(m["retransmissions"].get("total"))
        s["loc_err_N1"].append(loc_n1)
        s["reduction"].append(m["reduction_pct"].get("packets"))

    # -- §9.2 demo_flow --------------------------------------------------------------------------
    def _demo_flow(self, uplink: Dict[str, Any], nodes: Dict[str, Dict[str, Any]],
                   m: Dict[str, Any], online: bool) -> Dict[str, bool]:
        """Auto-detect the 17 integrated-demonstration steps (guideline §5, spec §9.2)."""
        evs = _all_event_strings(uplink)
        texts = [t for _, t in evs]
        node_list = list(nodes.values())
        loc = uplink.get("localization") or {}
        sch = uplink.get("schedule") or {}
        cnt = uplink.get("counters") or {}
        agg = uplink.get("aggregation") or {}
        links = [l for l in (uplink.get("links") or []) if isinstance(l, dict)]

        def macv(n: Dict[str, Any], k: str) -> float:
            mac = n.get("mac")
            return (_num(mac.get(k)) or 0.0) if isinstance(mac, dict) else 0.0

        if any("LINK_DOWN" in t for t in texts):
            self._sticky["link_down"] = True
        if self._sticky["link_down"] or any(l.get("blocked") for l in links):
            self._sticky["link_fail"] = True
        if any("ROUTE RESTORED" in t for t in texts):
            self._sticky["restored"] = True

        def hops_of(n: Dict[str, Any]) -> int:
            r = n.get("route")
            if isinstance(r, str) and r:
                return len([p for p in r.split(">") if p]) - 1
            h = _num(n.get("hops"))
            return int(h) if h is not None and h < 255 else 0

        metric_count = sum([
            bool(m["pdr"]), bool(m["packet_loss"]), bool(m["delay_ms"]),
            (m["throughput_bps"].get("total") or 0) > 0, len(m["retransmissions"]) > 1,
            bool(m["loc_err_cm"]), m["reduction_pct"].get("packets") is not None,
        ])
        return {
            "BLE Discovery": any(n.get("ble") for n in node_list),
            "RSSI Measurement": any(isinstance(b, dict) and _num(b.get("rssi")) is not None
                                    for n in node_list for b in (n.get("ble") or [])),
            "Localization": any(isinstance(t, dict) and t.get("est") is not None
                                for t in loc.get("targets") or []),
            "Wi-Fi Initialization": online,
            "Dynamic Schedule Assignment": (_num(sch.get("ver")) or 0) >= 1,
            "Channel Sensing": any(macv(n, "busy") > 0 for n in node_list)
                               or any(t.startswith("CS_") for t in texts),
            "Random Backoff": any(macv(n, "bo") > 0 for n in node_list)
                              or any("BACKOFF" in t for t in texts),
            "Scheduled Transmission": any(
                (_num((n.get("tdma") or {}).get("slot")) if isinstance(n.get("tdma"), dict) else None) is not None
                and (_num(n["tdma"].get("slot")) or 0) >= 0 and (_num(n.get("rx_count")) or 0) > 0
                for n in node_list),
            "Unicast Communication": (_num((cnt.get("ucast") or {}).get("DATA")) or 0) > 0,
            "Data Aggregation": (_num((agg.get("cum") or {}).get("in")) or 0) > 0,
            "Multi-Hop Routing": any(hops_of(n) >= 2 for n in node_list),
            "Sink": online,
            "Link Failure": self._sticky["link_fail"],
            "Failure Detection": self._sticky["link_down"],
            "Alternate Route Selection": self._sticky["alt_route"],
            "Route Recovery": self._sticky["restored"],
            "Performance Analysis": metric_count >= 4,
        }

    # -- persistence -----------------------------------------------------------------------------
    def _persist(self, uplink: Dict[str, Any], received_at: str, m: Dict[str, Any],
                 nodes: Dict[str, Dict[str, Any]]) -> None:
        """Append the uplink to uplink_log.jsonl and one metrics row to metrics.csv."""
        try:
            os.makedirs(self.log_dir, exist_ok=True)
            with open(os.path.join(self.log_dir, config.UPLINK_LOG_FILE), "a", encoding="utf-8") as f:
                f.write(json.dumps({"received_at": received_at, **uplink}, separators=(",", ":")) + "\n")
            path = self.metrics_csv_path()
            new = not os.path.exists(path) or os.path.getsize(path) == 0
            sch = uplink.get("schedule") or {}
            loc_n1 = (m["loc_err_cm"].get("N1") or {}).get("last")
            row: Dict[str, Any] = {
                "received_at": received_at, "source": uplink.get("source"), "sf": uplink.get("sf"),
                "net_time": uplink.get("net_time"), "sched_ver": sch.get("ver"),
                "sched_why": sch.get("why"), "lost_total": m["lost_total"], "rx_total": m["rx_total"],
                "throughput_bps": m["throughput_bps"].get("total"),
                "throughput_Bps": m["throughput_Bps"].get("total"),
                "retx_total": m["retransmissions"].get("total"), "loc_err_N1": loc_n1,
                "reduction_packets": m["reduction_pct"].get("packets"),
                "reduction_bytes": m["reduction_pct"].get("bytes"),
                "light_state": (uplink.get("light") or {}).get("state"),
            }
            for nid in ORIGINS:
                row["pdr_" + nid] = m["pdr"].get(nid)
                row["loss_" + nid] = m["packet_loss"].get(nid)
                row["delay_" + nid] = (m["delay_ms"].get(nid) or {}).get("last")
                row["route_" + nid] = (nodes.get(nid) or {}).get("route")
                row["value_" + nid] = (nodes.get(nid) or {}).get("value")
            for nid in ALL_NODES:
                row["retx_" + nid] = m["retransmissions"].get(nid)
            with open(path, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=list(CSV_COLUMNS), extrasaction="ignore")
                if new:
                    w.writeheader()
                w.writerow(row)
        except OSError as exc:  # never let disk problems break the live dashboard
            print("[state] persistence error: %s" % exc)

    def metrics_csv_path(self) -> str:
        """Absolute path of metrics.csv (GET /api/export.csv)."""
        return os.path.join(self.log_dir, config.METRICS_CSV_FILE)

    # -- §9.2 read side --------------------------------------------------------------------------
    def _derived_view(self, now: float, series_len: int = config.SERIES_LEN) -> Dict[str, Any]:
        """Copy of the derived block with live age/online and sliced series."""
        d = dict(self.derived)
        if self.last_rx_wall is not None:
            age = max(0.0, now - self.last_rx_wall)
            d["age_s"] = round(age, 1)
            d["online"] = age < config.OFFLINE_AFTER_S
            flow = dict(d["demo_flow"])
            flow["Wi-Fi Initialization"] = flow["Sink"] = d["online"]
            d["demo_flow"] = flow
        d["series"] = {k: list(v)[-series_len:] for k, v in self.series.items()}
        d["metrics"] = copy.deepcopy(d["metrics"])
        d["schedule_history"] = list(self.schedule_history)
        d["route_history"] = list(self.route_history)
        d["light_history"] = [dict(r) for r in self.light_history]
        d["uplink_count"] = self.uplink_count
        d["commands_pending"] = len(self._pending)
        return d

    def get_state(self, now: Optional[float] = None) -> Dict[str, Any]:
        """GET /api/state: last uplink (or empty skeleton) + ``derived`` (spec §9.2)."""
        now = time.time() if now is None else now
        with self._lock:
            base = dict(self.last_uplink) if self.last_uplink is not None else empty_uplink()
            base["derived"] = self._derived_view(now)
            return base

    def get_history(self) -> Dict[str, Any]:
        """GET /api/history: full series (up to HISTORY_SERIES_LEN) + schedule/route history."""
        with self._lock:
            return {
                "series": {k: list(v) for k, v in self.series.items()},
                "schedule_history": list(self.schedule_history),
                "route_history": list(self.route_history),
                "light_history": [dict(r) for r in self.light_history],
                "uplink_count": self.uplink_count,
            }

    def recent_uplinks(self, n: int = 50) -> List[Dict[str, Any]]:
        """Return the newest n stored uplinks (with received_at)."""
        with self._lock:
            return list(self.uplinks)[-n:]

    # -- §9.1 command queue ----------------------------------------------------------------------
    def queue_command(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        """Queue a validated command for the sink; assigns an incrementing ``id``.

        RESET_STATS additionally resets the server-side derived statistics immediately
        (histories are kept).
        """
        with self._lock:
            item = {"c": cmd["c"], "a": int(cmd.get("a", 0)), "b": int(cmd.get("b", 0)),
                    "dur": int(cmd.get("dur", 0)), "id": self._next_cmd_id}
            if "v" in cmd:                       # TEMP_WARN argument (spec §3 CTRL ``v``)
                item["v"] = int(cmd["v"])
            self._next_cmd_id += 1
            self._pending.append(item)
            self._recent.append({**item, "queued_at": _now_iso(), "status": "queued",
                                 "delivered_at": None})
            if item["c"] == "RESET_STATS":
                self._reset_accumulators()
            return dict(item)

    def pop_commands(self) -> List[Dict[str, Any]]:
        """Return and clear all pending commands (delivered in the POST /api/data reply)."""
        with self._lock:
            out, self._pending = self._pending, []
            ids = {c["id"] for c in out}
            ts = _now_iso()
            for r in self._recent:
                if r["id"] in ids:
                    r["status"] = "delivered"
                    r["delivered_at"] = ts
            return out

    def recent_commands(self) -> List[Dict[str, Any]]:
        """Newest-last list of the last 50 commands with queued/delivered status."""
        with self._lock:
            return [dict(r) for r in self._recent]


#: The process-wide singleton used by app.py.
STORE = Store()

#: Contract interpretations made by this server (also listed in the hand-over report).
INTERPRETATIONS: Tuple[str, ...] = (
    "Node MAC address is sent as 'mac_addr' because 'mac' is the counters object (duplicate key in §9.1).",
    "metrics.throughput_bps = bits/s (bytes/s x 8); metrics.throughput_Bps = bytes/s.",
    "series.t = local 'HH:MM:SS' of server reception; series.throughput = total bits/s.",
    "Commands always carry c,a,b,dur,id (unused = 0); NODE_KILL/NODE_WAKE only for a=1..3; "
    "TEMP_WARN is forced to a=1 and adds v (int, 0..15000 = °C x100); no other command carries v.",
    "nodes[].temp_warn is passed through as an int (N1's STAT.tw), anything else becomes null.",
    "Uplinks without 'light' get {state:'off', reason:'no uplink', since:null, pins}; "
    "nodes[].threshold 0/1 is normalised to a boolean, anything else to null.",
    "derived.light_history = light state changes between uplinks, t = light.since (else net_time).",
)
