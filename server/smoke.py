"""Smoke test: start the Flask app in a thread, post simulated uplinks, hit every endpoint.

Run from server/:  ../.venv/bin/python smoke.py      (exit code 0 = pass)
Uses a temporary LOG_DIR so the real data/ directory is untouched.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import urllib.request
from typing import Any, Tuple

TMP = tempfile.mkdtemp(prefix="aquasense_smoke_")
os.environ["AQUASENSE_LOG_DIR"] = TMP
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402
logging.getLogger("werkzeug").setLevel(logging.WARNING)

import app as appmod  # noqa: E402
import simulator  # noqa: E402


def req(base: str, path: str, body: Any = None) -> Tuple[int, bytes]:
    """GET (or POST JSON when body is given); returns (status, raw body)."""
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + path, data=data, method="POST" if data else "GET",
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main() -> int:
    """Run all checks; print a summary line per check."""
    srv = make_server("127.0.0.1", 0, appmod.app, threaded=True)
    base = "http://127.0.0.1:%d" % srv.server_port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    ok = True

    def check(name: str, cond: bool) -> None:
        nonlocal ok
        ok = ok and cond
        print("[%s] %s" % ("PASS" if cond else "FAIL", name))

    st, raw = req(base, "/api/state")
    s0 = json.loads(raw)
    check("empty /api/state 200 + skeleton", st == 200 and s0["derived"]["online"] is False
          and len(s0["nodes"]) == 4)
    st, raw = req(base, "/api/command", {"c": "LINK_FAIL", "a": 1, "b": 3, "dur": 20})
    check("POST /api/command 200 + id", st == 200 and json.loads(raw)["ok"] and "id" in json.loads(raw))
    st, raw = req(base, "/api/command", {"c": "LIGHT_TEST"})
    check("POST /api/command LIGHT_TEST 200", st == 200 and json.loads(raw)["command"]["c"] == "LIGHT_TEST")
    st, raw = req(base, "/api/command", {"c": "TEMP_WARN", "a": 1, "v": 4500})
    tw = json.loads(raw)
    check("POST /api/command TEMP_WARN 200 + v", st == 200 and tw["command"]["c"] == "TEMP_WARN"
          and tw["command"]["v"] == 4500 and tw["command"]["a"] == 1)
    for bad in (-1, 15001, "hot", 45.5):
        st, _ = req(base, "/api/command", {"c": "TEMP_WARN", "a": 1, "v": bad})
        check("TEMP_WARN v=%r -> 400" % (bad,), st == 400)
    st, _ = req(base, "/api/command", {"c": "TEMP_WARN", "a": 1})
    check("TEMP_WARN without v -> 400", st == 400)
    st, _ = req(base, "/api/command", {"c": "BOGUS"})
    check("invalid command -> 400", st == 400)
    st, _ = req(base, "/api/data", {"nodes": []})
    check("invalid uplink -> 400", st == 400)

    net = simulator.Network(seed=3)
    got_cmds = []
    for _ in range(3):
        net.step()
        st, raw = req(base, "/api/data", net.uplink())
        rep = json.loads(raw)
        check("POST /api/data 200 ok", st == 200 and rep["ok"] is True and "commands" in rep)
        got_cmds += rep["commands"]
        net.accept_commands(rep["commands"])
    check("queued command delivered in reply", any(c["c"] == "LINK_FAIL" for c in got_cmds))
    check("LIGHT_TEST delivered in reply", any(c["c"] == "LIGHT_TEST" for c in got_cmds))
    check("TEMP_WARN delivered in reply with v", any(c["c"] == "TEMP_WARN" and c.get("v") == 4500
                                                     for c in got_cmds))

    st, raw = req(base, "/api/state")
    s = json.loads(raw)
    d = s["derived"]
    check("/api/state 200 online", st == 200 and d["online"] is True and d["source"] == "simulator")
    for k in ("received_at", "age_s", "metrics", "series", "demo_flow", "schedule_history", "route_history",
              "light_history"):
        check("derived.%s present" % k, k in d)
    for k in ("pdr", "packet_loss", "lost_total", "rx_total", "delay_ms", "throughput_bps",
              "retransmissions", "loc_err_cm", "reduction_pct"):
        check("metrics.%s present" % k, k in d["metrics"])
    check("series has 3 samples", len(d["series"]["t"]) == 3 and len(d["series"]["pdr_N1"]) == 3)
    for k in ("nodes", "schedule", "aggregation", "localization", "links", "mac_log", "msg_log",
              "events", "counters", "contention_test", "light"):
        check("uplink.%s present" % k, k in s)
    check("light.state is a §9.3 state", s["light"]["state"] in ("test", "off", "stale", "red", "hot", "green"))
    check("light.pins = two LEDs (green 25, red 27)", s["light"]["pins"] == {"green": 25, "red": 27})
    check("nodes[].threshold: bool for N1/N2, null for N3/N4",
          [type(n.get("threshold")).__name__ for n in s["nodes"]] == ["bool", "bool", "NoneType", "NoneType"])
    check("light_history recorded", len(d["light_history"]) >= 1)
    check("N1 sensor = ESP32 die temperature / degC x100",
          (s["nodes"][0]["sensor"], s["nodes"][0]["unit"]) == ("ESP32 die temperature", "degC x100"))
    check("nodes[].temp_warn: int for N1, null for N2..N4",
          isinstance(s["nodes"][0]["temp_warn"], int) and [n["temp_warn"] for n in s["nodes"][1:]] == [None] * 3)

    # simulator "hot" episode end-to-end: TEMP_WARN just below the live N1 reading -> light hot (red blinking)
    cmd = simulator.demo_command(net, {"c": "TEMP_WARN", "a": 1, "v": "live-100"})
    st, raw = req(base, "/api/command", cmd)
    check("demo TEMP_WARN (live - 100) queued", st == 200 and json.loads(raw)["command"]["v"] == cmd["v"])
    for _ in range(3):
        net.step()
        st, raw = req(base, "/api/data", net.uplink())
        net.accept_commands(json.loads(raw)["commands"])
    s = json.loads(req(base, "/api/state")[1])
    check("simulator: N1 temp_warn reported back via STAT.tw", s["nodes"][0]["temp_warn"] == cmd["v"])
    check("simulator: N1 threshold true + light hot 'N1 enclosure hot'",
          s["nodes"][0]["threshold"] is True and s["light"]["state"] == "hot"
          and s["light"]["reason"] == "N1 enclosure hot")
    check("light_history has the hot state", any(h["state"] == "hot" for h in s["derived"]["light_history"]))
    req(base, "/api/command", {"c": "TEMP_WARN", "a": 1, "v": 6000})
    for _ in range(3):
        net.step()
        st, raw = req(base, "/api/data", net.uplink())
        net.accept_commands(json.loads(raw)["commands"])
    s = json.loads(req(base, "/api/state")[1])
    check("simulator: TEMP_WARN 6000 -> back to green", s["nodes"][0]["temp_warn"] == 6000
          and s["light"]["state"] == "green")

    st, raw = req(base, "/api/commands/recent")
    check("/api/commands/recent", st == 200 and all(c["status"] == "delivered" for c in json.loads(raw)["commands"]))
    st, raw = req(base, "/api/history")
    h = json.loads(raw)
    check("/api/history", st == 200 and {"series", "schedule_history", "route_history"} <= set(h))
    st, raw = req(base, "/api/export.csv")
    check("/api/export.csv (header + 9 rows)", st == 200 and len(raw.decode().strip().splitlines()) == 10)
    st, raw = req(base, "/api/health")
    check("/api/health", st == 200 and json.loads(raw)["ok"])
    st, _ = req(base, "/")
    check("GET / 200", st == 200)
    srv.shutdown()
    print("SMOKE %s (log dir %s)" % ("OK" if ok else "FAILED", TMP))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
