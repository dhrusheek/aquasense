#!/usr/bin/env bash
# Start the network simulator with the self-running demo scenario (server must be running).
# Extra args are passed through, e.g.  ./run_sim.sh --url http://127.0.0.1:5050/api/data
cd "$(dirname "$0")"
PY=../.venv/bin/python
[ -x "$PY" ] || PY=python3
exec "$PY" simulator.py --scenario demo "$@"
