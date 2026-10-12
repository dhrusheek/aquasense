#!/usr/bin/env python3
"""Record a scripted simulator run as /api/state frames for the static (Cloudflare Pages) build.

Runs the real network simulator headlessly (no sleeping, no HTTP) against the real Store, so every
frame is exactly what GET /api/state would have returned, and writes one JSON file the dashboard
replays in a loop:  web/public/sim_frames.json

    cd server && ../.venv/bin/python record_replay.py [--out ../web/public/sim_frames.json]

Each frame also carries "scenario": the name of the episode that was running when it was taken.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from typing import Any, Dict, List, Tuple

import config
import simulator
from simulator import Network, demo_command
from state import Store

SF_S = config.SUPERFRAME_MS / 1000.0

# (start second, command or episode, label). Seconds are simulated time since boot.
TIMELINE: List[Tuple[float, Dict[str, Any], str]] = [
    (6, {"c": "LIGHT_TEST"}, "Status light self-test"),
    (30, {"_episode": "turbid", "on": True}, "Turbid water at N2"),
    (48, {"_episode": "turbid", "on": False}, "Water clears"),
    (60, {"c": "LINK_FAIL", "a": 1, "b": 3, "dur": 40}, "Link N1-N3 fails, traffic reroutes via N2"),
    (100, {"c": "LINK_RESTORE", "a": 1, "b": 3}, "Link N1-N3 restored"),
    (115, {"c": "CONTENTION_TEST"}, "N1 and N2 transmit at the same instant"),
    (130, {"c": "SCHED_UPDATE"}, "Schedule update requested"),
    (150, {"c": "TEMP_WARN", "a": 1, "v": "live-100"}, "N1 over-temperature alert"),
    (170, {"c": "TEMP_WARN", "a": 1, "v": config.TEMP_WARN_DEFAULT_C100}, "Alert threshold back to default"),
    (190, {"c": "NODE_KILL", "a": 2, "dur": 45}, "N2 goes offline"),
    (240, {"c": "NODE_WAKE", "a": 2}, "N2 back online"),
    (260, {"c": "NODE_KILL", "a": 3, "dur": 30}, "Cluster head N3 goes offline, N4 takes over scheduling"),
    (296, {"c": "NODE_WAKE", "a": 3}, "N3 back online"),
    (315, {"c": "NODE_KILL", "a": 1, "dur": 25}, "N1 goes offline"),
    (345, {"c": "NODE_WAKE", "a": 1}, "N1 back online"),
    (360, {"c": "LINK_FAIL", "a": 2, "b": 3, "dur": 30}, "Link N2-N3 fails"),
    (362, {"_episode": "turbid", "on": True}, "Turbid water while a link is down"),
    (392, {"c": "LINK_RESTORE", "a": 2, "b": 3}, "Link N2-N3 restored"),
    (400, {"_episode": "turbid", "on": False}, "Back to normal"),
]
TOTAL_S = 430.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "web", "public", "sim_frames.json"))
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    net = Network(seed=args.seed)
    store = Store(log_dir=tempfile.mkdtemp(prefix="aq_replay_"), persist=False)
    start_sf = net.sf
    wall = 1_800_000_000.0
    fired = set()
    scenario = "Normal operation"
    cid = 1000
    frames: List[Dict[str, Any]] = []

    while True:
        sim_s = (net.sf - start_sf) * SF_S
        if sim_s > TOTAL_S:
            break
        for i, (at, cmd, label) in enumerate(TIMELINE):
            if i in fired or sim_s < at:
                continue
            fired.add(i)
            scenario = label
            if "_episode" in cmd:
                net.set_episode(cmd["_episode"], cmd["on"])
            else:
                c = demo_command(net, cmd)
                cid += 1
                net.accept_commands([dict(c, id=cid)])
        net.step()
        up = net.uplink()
        wall += SF_S
        store.ingest(up, now=wall)
        st = store.get_state(now=wall)
        st["scenario"] = scenario
        frames.append(st)

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(frames, f, separators=(",", ":"))
    print("wrote %d frames (%.0f s of network time), %.1f MB -> %s"
          % (len(frames), len(frames) * SF_S, os.path.getsize(out) / 1e6, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
