"""AquaSense-WSN dashboard server configuration.

Every constant here mirrors docs/PROTOCOL_SPEC.md (the shared contract). Values that may need
changing on a lab machine (port, log directory) can be overridden with environment variables so
that tests and the smoke script never touch the real data directory:

    AQUASENSE_PORT      overrides PORT      (default 5050; macOS AirPlay Receiver occupies :5000)
    AQUASENSE_LOG_DIR   overrides LOG_DIR
"""
from __future__ import annotations

import os
from typing import Dict, FrozenSet, List, Tuple

# --- HTTP server (spec §9.2 "Server config") ---------------------------------------------------
PORT: int = int(os.environ.get("AQUASENSE_PORT", "5050"))
HOST: str = "0.0.0.0"

# --- Timing (spec §5, §9.2, §11) ---------------------------------------------------------------
SUPERFRAME_MS: int = 3000          # TDMA_SLOT_MS (500) x TDMA_SLOTS (6)
TDMA_SLOT_MS: int = 500
TDMA_SLOTS: int = 6
OFFLINE_AFTER_S: float = 10.0      # derived.online = False when the last uplink is older than this
SERIES_LEN: int = 120              # samples per time series returned by /api/state
HISTORY_SERIES_LEN: int = 600      # samples kept for /api/history
UPLINK_RING_LEN: int = 600         # last uplinks kept in memory
THROUGHPUT_WINDOW_S: float = 30.0  # spec §11 throughput window

# --- Persistence -----------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
LOG_DIR: str = os.environ.get("AQUASENSE_LOG_DIR", os.path.join(_HERE, "data"))
UPLINK_LOG_FILE: str = "uplink_log.jsonl"
METRICS_CSV_FILE: str = "metrics.csv"

# --- BLE localization (spec §2, §8) ------------------------------------------------------------
RSSI_1M: float = -59.0
PATH_LOSS_N: float = 2.2

#: Ground-truth table layout in cm (spec §8). N1 is the localization target.
NODE_POS: Dict[str, Tuple[float, float]] = {
    "N1": (50.0, 30.0),
    "N2": (0.0, 0.0),
    "N3": (120.0, 0.0),
    "N4": (60.0, 90.0),
}

# --- Node table (spec §1) ------------------------------------------------------------------------
NODE_META: List[Dict[str, object]] = [
    {"id": "N1", "num": 1, "role": "Sensor node", "sensor": "ESP32 die temperature", "unit": "degC x100"},
    {"id": "N2", "num": 2, "role": "Sensor / Relay node", "sensor": "Turbidity (LM393 module)", "unit": "raw ADC"},
    {"id": "N3", "num": 3, "role": "Cluster head / Aggregator / Router / Scheduler",
     "sensor": "ESP32 die temperature", "unit": "degC x100"},
    {"id": "N4", "num": 4, "role": "Sink / Gateway", "sensor": "Pond status light (2 LEDs)", "unit": ""},
]

# --- Pond status light at the sink N4 (spec §1.2, §9.3) ---------------------------------------
# Two LEDs only, red and green: there is no yellow LED and no "yellow" state (GPIO26 is unused).
#: Every ``light.state`` value the sink may report, in the §9.3 priority order:
#: test (red, then green) > off (none) > stale (green blinking) > red (steady, water turbid) >
#: hot (red blinking, N1 enclosure over TEMP_WARN) > green (steady, all nominal).
LIGHT_STATES: Tuple[str, ...] = ("test", "off", "stale", "red", "hot", "green")
#: N4 GPIOs of the two LEDs (spec §1 wiring, uplink ``light.pins``).
LIGHT_PINS: Dict[str, int] = {"green": 25, "red": 27}
LIGHT_STALE_SF: int = 3            # no AGG and no direct DATA for this many superframes -> "stale"
LIGHT_TEST_MS: int = 1000          # LIGHT_TEST: red -> green, this long per colour (2 s in total)
LIGHT_BLINK_MS: int = 500          # blink half-period of "stale" (green) and "hot" (red)
LIGHT_HISTORY_LEN: int = 30        # derived.light_history keeps the newest 30 state changes

# --- Logical topology (spec §2 "simulated radio range") ---------------------------------------
ALLOWED: Dict[int, Tuple[int, ...]] = {1: (2, 3), 2: (1, 3, 4), 3: (1, 2, 4), 4: (2, 3)}
#: Undirected allowed links, each as a sorted (a, b) tuple.
ALLOWED_LINKS: List[Tuple[int, int]] = sorted({tuple(sorted((a, b))) for a, nb in ALLOWED.items() for b in nb})  # type: ignore[misc]

# --- Default TDMA schedule, version 1 (spec §5) ------------------------------------------------
DEFAULT_SLOTS: List[int] = [3, 1, 2, 3, 0, 255]
SLOT_CONTROL: int = 0
SLOT_UNUSED: int = 255

# --- Commands accepted by POST /api/command (spec §9.1) ---------------------------------------
COMMANDS: FrozenSet[str] = frozenset({
    "LINK_FAIL", "LINK_RESTORE", "CONTENTION_TEST", "SCHED_UPDATE",
    "RESET_STATS", "NODE_KILL", "NODE_WAKE", "LIGHT_TEST", "TEMP_WARN",
})
DEFAULT_LINK_FAIL_DUR_S: int = 40
DEFAULT_NODE_KILL_DUR_S: int = 30

# --- N1 over-temperature alert (spec §1.2, §3 CTRL ``v``, §9.1 ``TEMP_WARN{a:1, v}``) -----------
#: N1 raises ``th`` = 1 when its die temperature (°C x100) is >= this threshold; RESET_STATS restores it.
TEMP_WARN_DEFAULT_C100: int = 6000   # 60.00 °C (firmware TEMP_WARN_C100)
TEMP_WARN_MIN_C100: int = 0          # accepted range of TEMP_WARN.v (°C x100)
TEMP_WARN_MAX_C100: int = 15000

#: Payload-size estimate for one STAT frame (bytes) used by the throughput metric (see state.py).
STAT_BYTES_ESTIMATE: int = 40


def is_allowed_link(a: int, b: int) -> bool:
    """Return True if the undirected link a-b is in the allowlist (spec §2)."""
    return b in ALLOWED.get(a, ())
