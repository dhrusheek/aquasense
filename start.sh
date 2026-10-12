#!/usr/bin/env bash
# AquaSense-WSN: start everything for a demo.
#
#   ./start.sh                 server + USB bridge to the sink (N4) + open the dashboard
#   ./start.sh --port /dev/cu.usbserial-5   skip auto-detection of the sink's serial port
#   ./start.sh --sim           server + network simulator instead of the hardware
#   ./start.sh --no-open       do not open the browser
#   ./start.sh --rescan        forget the remembered sink port and look for it again
#
# Leaves the dashboard at http://127.0.0.1:5050/ . Ctrl-C stops what this script started
# (a server that was already running is left alone). Logs go to logs/.
set -u
cd "$(dirname "$0")"
ROOT="$(pwd)"
PY="$ROOT/.venv/bin/python"
URL="http://127.0.0.1:5050/"
LOGS="$ROOT/logs"
MODE="hardware"; PORT=""; OPEN=1; RESCAN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --sim) MODE="sim" ;;
    --no-open) OPEN=0 ;;
    --rescan) RESCAN=1 ;;
    --port) shift; PORT="${1:-}" ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

[ -x "$PY" ] || { echo "Python venv not found at .venv (expected $PY)."; exit 1; }
mkdir -p "$LOGS"
PIDS=()
cleanup() {
  echo
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  echo "Stopped."
}
trap cleanup EXIT
trap 'exit 0' INT TERM

healthy() { curl -s -m 2 "${URL}api/health" >/dev/null 2>&1; }

# 1. Dashboard server ---------------------------------------------------------------------------
if healthy; then
  echo "[1/3] Server already running at $URL (left as it is)."
else
  echo "[1/3] Starting the dashboard server ..."
  (cd "$ROOT/server" && exec "$PY" app.py --port 5050) >"$LOGS/server.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 40); do healthy && break; sleep 0.25; done
  healthy || { echo "      Server did not come up. See logs/server.log"; exit 1; }
  echo "      Server up. Log: logs/server.log"
fi

# 2. Data source: USB bridge to the sink, or the simulator ----------------------------------------
if [ "$MODE" = "sim" ]; then
  echo "[2/3] Starting the network simulator (no hardware) ..."
  (cd "$ROOT/server" && exec "$PY" simulator.py --scenario demo) >"$LOGS/simulator.log" 2>&1 &
  PIDS+=($!)
  echo "      Simulator running. Log: logs/simulator.log"
elif pgrep -f "serial_bridge.py" >/dev/null 2>&1; then
  echo "[2/3] A USB bridge is already running (left as it is)."
else
  # Probing resets every plugged-in ESP32, so remember the sink's port and reuse it next time.
  CACHE="$LOGS/sink_port"
  [ "$RESCAN" = "1" ] && rm -f "$CACHE"
  if [ -z "$PORT" ] && [ -f "$CACHE" ] && [ -e "$(cat "$CACHE")" ]; then
    PORT="$(cat "$CACHE")"
    echo "[2/3] Using the sink port remembered from last time: $PORT (--rescan to look again)."
  fi
  if [ -z "$PORT" ]; then
    echo "[2/3] Looking for the sink (N4) on USB. This resets each ESP32 once ..."
    PORT="$("$PY" - <<'PYEOF'
import sys, time
import serial
from serial.tools import list_ports

def is_sink(dev, seconds=7.0):
    """True when the board on `dev` prints N4's log prefix or its JSON uplink line."""
    try:
        s = serial.Serial()
        s.port, s.baudrate, s.timeout = dev, 115200, 0.2
        s.dtr = False; s.rts = False
        s.open()
        s.rts = True; time.sleep(0.15); s.rts = False     # reset so it prints its boot banner
        end, buf = time.time() + seconds, b""
        while time.time() < end:
            buf += s.read(4096)
            if b"[N4 " in buf or b"JSON:" in buf:
                s.close(); return True
            for other in (b"[N1 ", b"[N2 ", b"[N3 "):
                if other in buf:
                    s.close(); return False
        s.close()
    except (serial.SerialException, OSError):
        pass
    return False

ports = [p.device for p in list_ports.comports()
         if "usbserial" in p.device or "usbmodem" in p.device or "SLAB" in p.device or "wchusb" in p.device]
for dev in ports:
    if is_sink(dev):
        print(dev); sys.exit(0)
sys.exit(1)
PYEOF
)"
  fi
  if [ -z "$PORT" ]; then
    echo "      No sink found on USB. Plug N4 in (or pass --port), or use --sim."
    echo "      The server keeps running; the dashboard will show Offline until data arrives."
  else
    echo "$PORT" > "$CACHE"
    echo "      Sink found on $PORT. Starting the USB bridge ..."
    (cd "$ROOT/server" && exec "$PY" -u serial_bridge.py --port "$PORT") >"$LOGS/bridge.log" 2>&1 &
    PIDS+=($!)
    echo "      Bridge running. Log: logs/bridge.log"
  fi
fi

# 3. Browser ------------------------------------------------------------------------------------
if [ "$OPEN" = "1" ]; then
  echo "[3/3] Opening $URL"
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  else echo "      Open $URL in a browser."; fi
else
  echo "[3/3] Dashboard: $URL"
fi

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo "Everything was already running; nothing for this script to keep alive."
  trap - EXIT; exit 0
fi
echo "Running. Press Ctrl-C to stop what this script started."
echo "If a node shows Inactive after a restart, press its EN button: each node picks its radio"
echo "channel only at boot (the hotspot's channel, or channel 1 when the hotspot is off)."
# Report the first uplink so it is obvious the data path works.
for _ in $(seq 1 60); do
  n="$(curl -s -m 2 "${URL}api/health" | "$PY" -c 'import sys,json; d=json.load(sys.stdin); print(d.get("uplinks",0) if d.get("online") else 0)' 2>/dev/null || echo 0)"
  [ "${n:-0}" -gt 0 ] && { echo "Dashboard is online and receiving data."; break; }
  sleep 1
done
wait
