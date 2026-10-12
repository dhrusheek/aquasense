"""AquaSense-WSN dashboard server (Flask) — spec §9.

Endpoints
---------
POST /api/data              sink uplink (§9.1)  -> {"ok": true, "commands": [...]}
GET  /api/state             last uplink + derived block (§9.2)
POST /api/command           {c, a, b, dur} or {c:"TEMP_WARN", a:1, v} -> queued for the sink (§9.1 "Commands")
GET  /api/commands/recent   last 50 commands with queued/delivered status
GET  /api/history           full series + schedule/route history
GET  /api/export.csv        per-superframe metric rows (data/metrics.csv)
GET  /api/health            liveness probe
GET  /                      static/index.html (frontend, owned by the UI agent)

Run:  ../.venv/bin/python app.py  [--port 5050] [--host 0.0.0.0]
"""
from __future__ import annotations

import argparse
import io
import logging
import os
import re
import socket
import subprocess
import sys
import time
from typing import Any, List

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

import config
from state import CSV_COLUMNS, STORE, validate_command, validate_uplink

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(HERE, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
log = logging.getLogger("aquasense")


@app.after_request
def _cors(resp: Response) -> Response:
    """Permissive CORS + no-cache headers (same origin in practice; harmless for ESP32 clients)."""
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def _json_body() -> Any:
    """Parse the request body as JSON even without a Content-Type header (Arduino HTTPClient)."""
    data = request.get_json(force=True, silent=True)
    if data is None and request.data:
        raw = request.data.decode("utf-8", "replace").strip()
        if raw.startswith("JSON:"):
            raw = raw[5:]
        try:
            import json
            data = json.loads(raw)
        except ValueError:
            data = None
    return data


# -- §9.1 uplink -----------------------------------------------------------------------------------
@app.route("/api/data", methods=["POST", "OPTIONS"])
def api_data() -> Any:
    """Receive one sink uplink (§9.1), store it and reply with pending commands."""
    if request.method == "OPTIONS":
        return ("", 204)
    up = _json_body()
    err = validate_uplink(up)
    if err:
        return jsonify({"ok": False, "error": err, "commands": []}), 400
    derived = STORE.ingest(up)
    cmds = STORE.pop_commands()
    _log_uplink(up, derived, cmds)
    return jsonify({"ok": True, "commands": cmds})


def _log_uplink(up: dict, derived: dict, cmds: List[dict]) -> None:
    """One concise console line per uplink."""
    m = derived.get("metrics", {})
    nodes = up.get("nodes") or []
    active = sum(1 for n in nodes if isinstance(n, dict) and n.get("status") == "active")
    pdr = " ".join("%s=%s" % (k, v) for k, v in sorted(m.get("pdr", {}).items()))
    routes = " ".join(str(n.get("route")) for n in nodes
                      if isinstance(n, dict) and n.get("num") in (1, 2, 3))
    sch = up.get("schedule") or {}
    print("[uplink] %s %-9s sf=%-5s active=%d/%d sched=v%s pdr[%s] routes[%s] tput=%sbps%s" % (
        time.strftime("%H:%M:%S"), up.get("source"), up.get("sf"), active, len(nodes),
        sch.get("ver"), pdr, routes, m.get("throughput_bps", {}).get("total"),
        (" cmds->%s" % ",".join("%s#%d%s" % (c["c"], c["id"], "(v=%d)" % c["v"] if "v" in c else "")
                                for c in cmds)) if cmds else ""),
        flush=True)


# -- §9.2 state ------------------------------------------------------------------------------------
@app.route("/api/state", methods=["GET"])
def api_state() -> Any:
    """Last uplink + derived block (§9.2); empty skeleton with derived.online=false before data."""
    return jsonify(STORE.get_state())


@app.route("/api/command", methods=["POST", "OPTIONS"])
def api_command() -> Any:
    """Validate and queue a dashboard command for the sink (§9.1 Commands).

    TEMP_WARN carries ``v`` (N1 alert threshold, °C x100, 0..15000); it is kept in the queued item
    and therefore reaches the sink in the ``commands[]`` of the next POST /api/data reply.
    """
    if request.method == "OPTIONS":
        return ("", 204)
    cmd, err = validate_command(_json_body())
    if err:
        return jsonify({"ok": False, "error": err}), 400
    item = STORE.queue_command(cmd)  # type: ignore[arg-type]
    print("[command] queued %s" % item, flush=True)
    return jsonify({"ok": True, "id": item["id"], "command": item})


@app.route("/api/commands/recent", methods=["GET"])
def api_commands_recent() -> Any:
    """Last 50 commands (newest last) with status queued/delivered."""
    return jsonify({"ok": True, "commands": STORE.recent_commands()})


@app.route("/api/history", methods=["GET"])
def api_history() -> Any:
    """Full series + schedule/route history."""
    return jsonify(STORE.get_history())


@app.route("/api/export.csv", methods=["GET"])
def api_export_csv() -> Any:
    """Download metrics.csv (header only if nothing has been logged yet)."""
    path = STORE.metrics_csv_path()
    name = "aquasense_metrics_%s.csv" % time.strftime("%Y%m%d_%H%M%S")
    if os.path.exists(path):
        return send_file(path, mimetype="text/csv", as_attachment=True, download_name=name,
                         max_age=0)
    buf = io.BytesIO((",".join(CSV_COLUMNS) + "\n").encode())
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=name)


@app.route("/api/health", methods=["GET"])
def api_health() -> Any:
    """Liveness probe."""
    st = STORE.get_state()
    return jsonify({"ok": True, "time": time.time(), "uplinks": st["derived"]["uplink_count"],
                    "online": st["derived"]["online"], "source": st["derived"]["source"]})


@app.route("/", methods=["GET"])
def index() -> Any:
    """Serve the dashboard (static/index.html)."""
    if not os.path.exists(os.path.join(STATIC_DIR, "index.html")):
        return Response("<h1>AquaSense-WSN</h1><p>static/index.html not found yet. "
                        "API is live at <a href='/api/state'>/api/state</a>.</p>", mimetype="text/html")
    return send_from_directory(STATIC_DIR, "index.html", max_age=0)


@app.route("/design-check", methods=["GET"])
def design_check() -> Any:
    """UI component check page (hero, cards, form states, dialog, toast). Not part of the demo flow."""
    return send_from_directory(STATIC_DIR, "design-check.html", max_age=0)


# -- startup helpers -------------------------------------------------------------------------------
def lan_ips() -> List[str]:
    """Best-effort list of this laptop's IPv4 LAN addresses (for the firmware's UPLINK_URL)."""
    ips: List[str] = []

    def add(ip: str) -> None:
        if ip and not ip.startswith("127.") and not ip.startswith("169.254.") and ip not in ips:
            ips.append(ip)

    try:  # default-route address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except OSError:
        pass
    cmd = ["ipconfig"] if sys.platform.startswith("win") else ["ifconfig"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
        for ip in re.findall(r"(?:inet |IPv4[^:]*:\s*)(\d+\.\d+\.\d+\.\d+)", out):
            add(ip)
    except (OSError, subprocess.SubprocessError):
        pass
    return ips


def main() -> None:
    """Parse CLI args, print the UPLINK_URL candidates and run the threaded Flask server."""
    ap = argparse.ArgumentParser(description="AquaSense-WSN dashboard server")
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PORT)
    args = ap.parse_args()
    logging.getLogger("werkzeug").setLevel(logging.WARNING)  # one line per uplink, not per GET
    print("=" * 72)
    print(" AquaSense-WSN dashboard server")
    print("   dashboard : http://127.0.0.1:%d/" % args.port)
    for ip in lan_ips():
        print("   firmware  : #define UPLINK_URL \"http://%s:%d/api/data\"" % (ip, args.port))
    print("   data dir  : %s" % STORE.log_dir)
    if sys.platform == "darwin" and args.port == 5000:
        print("   NOTE (macOS): AirPlay Receiver also uses :5000 - disable it in System Settings >")
        print("   General > AirDrop & Handoff if the ESP32 gets HTTP 403, or use the default --port 5050.")
    print("=" * 72, flush=True)
    app.run(host=args.host, port=args.port, threaded=True, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
