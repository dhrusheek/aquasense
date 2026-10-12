#!/usr/bin/env bash
# Start the AquaSense-WSN dashboard server (http://<laptop-ip>:5050/).
# Extra args are passed through, e.g.  ./run.sh --port 5050
cd "$(dirname "$0")"
PY=../.venv/bin/python
[ -x "$PY" ] || PY=python3
exec "$PY" app.py "$@"
