"""USB serial bridge: N4 sink <-> dashboard server (spec §9.1, fallback when the hotspot fails).

* Lines from N4 that start with ``JSON:`` are POSTed (without the prefix) to the server.
* Every command in the server's reply is written back to N4 as ``CMD:{...}\\n``.
* Every other line is echoed to stdout (firmware debug log).
* The port is re-opened automatically after unplug / errors.

Usage:
  python serial_bridge.py --list
  python serial_bridge.py --port /dev/cu.usbserial-XXXX [--baud 115200]
                          [--url http://127.0.0.1:5050/api/data]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

import config

try:
    import serial                      # pyserial
    from serial.tools import list_ports
except ImportError:  # pragma: no cover
    print("pyserial missing: ../.venv/bin/pip install pyserial")
    raise


def list_serial_ports() -> None:
    """Print every serial port (helps find the ESP32's /dev/cu.usbserial-* or COMx)."""
    ports = list(list_ports.comports())
    if not ports:
        print("no serial ports found")
    for p in ports:
        print("%-28s %s %s" % (p.device, p.description, p.hwid))


def post_uplink(url: str, payload: str, timeout: float = 4.0) -> List[Dict[str, Any]]:
    """POST one uplink JSON string to the server (§9.1) and return the reply's commands."""
    req = urllib.request.Request(url, data=payload.encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        reply = json.loads(r.read().decode("utf-8") or "{}")
    return list(reply.get("commands") or [])


def run(port: str, baud: int, url: str) -> None:
    """Main loop with automatic reconnect."""
    while True:
        try:
            with serial.Serial(port, baud, timeout=1) as ser:
                print("[bridge] connected %s @ %d -> %s" % (port, baud, url), flush=True)
                buf = b""
                while True:
                    chunk = ser.read(ser.in_waiting or 1)
                    if not chunk:
                        continue
                    buf += chunk
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        line = raw.decode("utf-8", "replace").strip("\r ")
                        if not line.startswith("JSON:"):
                            if line:
                                print(line, flush=True)
                            continue
                        payload = line[5:].strip()
                        try:
                            json.loads(payload)
                        except ValueError:
                            print("[bridge] malformed JSON line (%d bytes) dropped" % len(payload), flush=True)
                            continue
                        try:
                            cmds = post_uplink(url, payload)
                        except (urllib.error.URLError, OSError, ValueError) as exc:
                            print("[bridge] POST failed: %s" % exc, flush=True)
                            continue
                        print("[bridge] uplink forwarded (%d bytes), %d command(s)" % (len(payload), len(cmds)),
                              flush=True)
                        for c in cmds:
                            ser.write(("CMD:%s\n" % json.dumps(c, separators=(",", ":"))).encode())
                            ser.flush()
                            print("[bridge] -> CMD:%s" % json.dumps(c), flush=True)
        except (serial.SerialException, OSError) as exc:
            print("[bridge] serial error: %s - retrying in 2 s" % exc, flush=True)
            time.sleep(2)
        except KeyboardInterrupt:
            print("\n[bridge] bye")
            return


def main() -> int:
    """CLI entry point."""
    ap = argparse.ArgumentParser(description="AquaSense-WSN USB serial bridge")
    ap.add_argument("--port", help="serial port, e.g. /dev/cu.usbserial-0001 or COM5")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--url", default="http://127.0.0.1:%d/api/data" % config.PORT)
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    args = ap.parse_args()
    if args.list or not args.port:
        list_serial_ports()
        if not args.port:
            print("\nusage: python serial_bridge.py --port <PORT> [--baud 115200] [--url ...]")
        return 0
    run(args.port, args.baud, args.url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
