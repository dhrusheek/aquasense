"""docs/diagrams/wiring_N1.png … wiring_N4.png — per-node wiring (spec §1, docs/HARDWARE_SETUP.md).

ESP32 DevKit V1 (30-pin, ESP32-WROOM-32) drawn with the labels printed on the real board (D34, D27,
3V3 …), antenna at the top and USB at the bottom; the pins in use are highlighted with their GPIO.
Wire colours: red = 3V3, black = GND, yellow = analog, green = digital, grey = probe cable.
N1 and N3 are board-only figures (on-chip temperature sensor, no wiring).
Run:  ../../.venv/bin/python gen_wiring.py
"""
import numpy as np
from matplotlib import patheffects as pe
from matplotlib.patches import Circle

from _style import (ACCENT, ACCENT_SOFT, BORDER, FILL, INK, LINE, MUTED, WIRE_BLACK, WIRE_GREEN, WIRE_GREY,
                    WIRE_RED, WIRE_YELLOW, arrow, box, canvas, card, save, title)

# printed silkscreen labels, top (antenna) -> bottom (USB)
LEFT = ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"]
RIGHT = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2", "D4", "D2", "D15", "GND", "3V3"]
TOP, PITCH = 80.0, 4.4
BX0, BX1 = 64.0, 92.0       # board x-range
GREY_USB = "#4a5560"


def pin_y(i):
    return TOP - i * PITCH


def draw_board(ax, used):
    """Draw the DevKit. `used` maps a pin key ("D34", "GND_L", "3V3" …) to the label shown for it.
    Returns {key: (x_dot, y)} for every pin (keys with and without the _L/_R side suffix)."""
    box(ax, BX0, 13, BX1 - BX0, 73, fc="white", ec=INK, lw=1.0, r=1.5, z=1)
    box(ax, 72.5, 62, 11, 22, "ESP32-\nWROOM-32\n(metal can)", fc=FILL, ec=BORDER, size=6.2, color=MUTED, z=2)
    box(ax, 75.5, 10.5, 5, 3.6, "USB", fc=FILL, ec=INK, size=5.5, color=INK, z=3, r=0.5)
    ax.text((BX0 + BX1) / 2, 88, "ESP32 DevKit V1 (30-pin)", ha="center", fontsize=8, fontweight="bold",
            color=INK)
    ax.text(BX0 - 0.6, 84.6, "left header", ha="right", fontsize=5.4, color=MUTED)
    ax.text(BX1 + 0.6, 84.6, "right header", ha="left", fontsize=5.4, color=MUTED)
    pos = {}
    for side, names in (("L", LEFT), ("R", RIGHT)):
        for i, n in enumerate(names):
            y = pin_y(i)
            x = BX0 + 1.6 if side == "L" else BX1 - 1.6
            key = n + "_" + side
            lab = used.get(key, used.get(n))
            on = lab is not None
            ax.add_patch(Circle((x, y), 0.85, fc=ACCENT if on else "white", ec=ACCENT if on else MUTED,
                                lw=0.8, zorder=4))
            tx = x + 1.7 if side == "L" else x - 1.7
            ax.text(tx, y, lab if on else n, ha="left" if side == "L" else "right", va="center",
                    fontsize=6.0 if on else 6.3, color=INK if on else MUTED,
                    fontweight="bold" if on else "normal", zorder=4,
                    bbox=dict(fc=ACCENT_SOFT, ec="none", pad=0.6) if on else None)
            pos[n] = (x, y)
            pos[key] = (x, y)
    ax.add_patch(Circle((79, 20.5), 0.9, fc=ACCENT, ec="none", zorder=4))
    ax.text(79, 17.6, "onboard LED · GPIO2\nON = awake, OFF = sleep slot", ha="center", va="top",
            fontsize=5.4, color=MUTED, zorder=4)
    return pos


def wire(ax, pts, color, lw=2.0, halo=False, ends=True):
    xs, ys = zip(*pts)
    kw = {}
    if halo:   # white outline so a crossing reads as "passes over, not connected"
        kw["path_effects"] = [pe.Stroke(linewidth=lw + 2.6, foreground="white"), pe.Normal()]
    ax.plot(xs, ys, color=color, lw=lw, solid_capstyle="round", solid_joinstyle="round", zorder=5, **kw)
    if ends:
        for p in (pts[0], pts[-1]):
            ax.add_patch(Circle(p, 0.55, fc=color, ec="white", lw=0.4, zorder=6))


def pins_on(ax, x, pins, side):
    """Header pins on the edge x of a card; side 'R' puts the label left of the pin, 'L' right of it."""
    out = {}
    for lab, py in pins:
        ax.add_patch(Circle((x, py), 0.85, fc="white", ec=INK, lw=0.8, zorder=4))
        ax.text(x - 1.8 if side == "R" else x + 1.8, py, lab, ha="right" if side == "R" else "left",
                va="center", fontsize=6.6, fontweight="bold", color=INK, zorder=4)
        out[lab] = (x, py)
    return out


def table(ax, x, y, rows, w=54, cols=(0, 11, 27, 33), head="Connections"):
    """Pin table: rows of (part pin, ESP32 pin, wire colour or None, note)."""
    ax.text(x, y, head, fontsize=8, fontweight="bold", color=INK, va="top")
    hdr = ["Part", "ESP32 pin", "Wire", "Jumper / note"]
    cx = [x + c for c in cols]
    yy = y - 4.2
    for c, h in zip(cx, hdr):
        ax.text(c, yy, h, fontsize=6.4, color=MUTED, va="center", fontweight="bold")
    ax.plot([x, x + w], [yy - 1.6, yy - 1.6], color=BORDER, lw=0.6)
    for r in rows:
        yy -= 4.0
        ax.text(cx[0], yy, r[0], fontsize=6.5, color=INK, va="center")
        ax.text(cx[1], yy, r[1], fontsize=6.5, color=INK, va="center", fontweight="bold")
        if r[2]:
            ax.plot([cx[2], cx[2] + 4], [yy, yy], color=r[2], lw=2.2, solid_capstyle="round")
        ax.text(cx[3], yy, r[3], fontsize=6.1, color=MUTED, va="center")
        ax.plot([x, x + w], [yy - 2, yy - 2], color=BORDER, lw=0.4)
    return yy


def note(ax, x, y, w, h, head, body, soft=True):
    card(ax, x, y, w, h, head, body, fc=ACCENT_SOFT if soft else FILL, ec=ACCENT if soft else BORDER, lw=0.8,
         hs=7.4, bs=6.2, z=2)


def zigzag_h(ax, x0, x1, y, amp=0.8, n=10, lab=None):
    xs = np.linspace(x0 + 0.8, x1 - 0.8, 2 * n + 1)
    ys = [y] + [y + (amp if i % 2 else -amp) for i in range(1, 2 * n)] + [y]
    ax.plot([x0, x0 + 0.8], [y, y], color=INK, lw=1.0, zorder=6)
    ax.plot(xs, ys, color=INK, lw=1.0, zorder=6)
    ax.plot([x1 - 0.8, x1], [y, y], color=INK, lw=1.0, zorder=6)
    if lab:
        ax.text((x0 + x1) / 2, y - 1.9, lab, ha="center", va="top", fontsize=5.2, color=INK, zorder=6)


# ============================================================ N1 (on-chip temperature + TEMP_WARN)
def grid(ax, x, y, head, hdr, rows, cols, w, dots=None):
    """Generic text table; dots[i] = colour of a small LED dot drawn before the last cell of row i."""
    ax.text(x, y, head, fontsize=8, fontweight="bold", color=INK, va="top")
    cx = [x + c for c in cols]
    yy = y - 4.2
    for c, h in zip(cx, hdr):
        ax.text(c, yy, h, fontsize=6.4, color=MUTED, va="center", fontweight="bold")
    ax.plot([x, x + w], [yy - 1.6, yy - 1.6], color=BORDER, lw=0.6)
    for i, r in enumerate(rows):
        yy -= 4.0
        for j, (c, t) in enumerate(zip(cx, r)):
            off = 0.0
            if dots and j == len(r) - 1 and dots[i]:
                ax.add_patch(Circle((c + 0.9, yy), 0.9, fc=dots[i], ec=INK, lw=0.5, zorder=4))
                off = 2.6
            ax.text(c + off, yy, t, fontsize=6.4, color=INK, va="center", fontweight="bold" if j == 0 else "normal")
        ax.plot([x, x + w], [yy - 2, yy - 2], color=BORDER, lw=0.4)
    return yy


def wiring_n1():
    fig, ax = canvas(12, 7.6, (0, 160), (0, 101))
    title(ax, 3, 98.5, "Wiring  ·  N1 sensor node (on-chip temperature, no wiring)",
          "no external part · temperatureRead() on the ESP32 die = pond-edge enclosure temperature · "
          "TEMP_WARN alert · sensors.h", dy=4.4)
    draw_board(ax, {"D2": "D2 · LED"})
    note(ax, 104, 67, 52, 13, "On-chip temperature sensor, no wiring",
         "TEMP_WARN alert threshold set from the dashboard.\n"
         "Value sent = round(temperatureRead() × 100), e.g. 4778\n"
         "= 47.78 °C; −1 if the read returns NaN.\n"
         "th = 1 when v ≥ TEMP_WARN (default 6000 = 60.00 °C).")
    arrow(ax, 104, 73.4, 84.2, 73.4, color=ACCENT, lw=1.2, style="-|>", ms=9)
    note(ax, 104, 43, 52, 18, "How the alert reaches N1 and the light",
         "Dashboard form \"N1 over-temperature alert threshold\"\n"
         "(view 1 or view 6) → server → N4 → broadcast CTRL\n"
         "TEMP_WARN{a:1, v} in the next CONTROL slot (relayed by N3, N2)\n"
         "→ N1 stores v, reports it back in STAT tw.\n"
         "th = 1 → N4 status light blinks red: \"N1 enclosure hot\".\n"
         "RESET_STATS (view 8) or a reboot restores 60.00 °C.", soft=False)
    note(ax, 104, 20, 52, 18, "Caveats (stated on the dashboard and in the report)",
         "• Uncalibrated: reads the die, several °C above the room,\n"
         "  with an offset per chip; read it as a trend.\n"
         "• Self-heating: climbs for a few minutes after power-on as\n"
         "  Wi-Fi + BLE warm the die; wait ~5 min before the demo.\n"
         "• Some chips return a constant 53.33 °C (raw 128): the flag then\n"
         "  only reacts to the threshold being moved (use 53.00 °C).", soft=False)
    table(ax, 4, 86, [("die sensor", "inside chip", ACCENT, "nothing to connect"),
                      ("USB", "micro-USB", GREY_USB, "power + Serial 115200"),
                      ("—", "GPIO2 (D2)", ACCENT, "onboard LED (awake)")], w=56)
    grid(ax, 4, 62, "TEMP_WARN demo (live N1 reading e.g. 47.78 °C)",
         ["Step", "Threshold", "N1 th", "Status light"],
         [("1  default", "60.00 °C  (v 6000)", "0", "green · all nominal"),
          ("2  set below reading", "45.00 °C  (v 4500)", "1", "red blink · N1 enclosure hot"),
          ("3  set back / RESET_STATS", "60.00 °C  (v 6000)", "0", "green · all nominal")],
         cols=(0, 18, 31, 37), w=58, dots=[WIRE_GREEN, WIRE_RED, WIRE_GREEN])
    ax.text(4, 38, "Serial fallback (type into N4's Serial Monitor, 115200 baud):\n"
            "CMD:{\"c\":\"TEMP_WARN\",\"a\":1,\"v\":4500}    → light blinks red\n"
            "CMD:{\"c\":\"TEMP_WARN\",\"a\":1,\"v\":6000}    → light green",
            fontsize=6.4, color=INK, va="top", linespacing=1.5)
    ax.text(4, 25, "Serial check on N1 (your temperature differs):\n"
            "at boot:  [N1 SENS] ESP32 die temperature sensor (uncalibrated),\n"
            "               now 47.78 C, TEMP_WARN 60.00 C\n"
            "on the command:  [N1 CTRL] TEMP_WARN 45.00 C (was 60.00 C)",
            fontsize=6.2, color=MUTED, va="top", linespacing=1.5)
    save(fig, "wiring_N1.png")


# ============================================================ N2 (turbidity)
def wiring_n2():
    fig, ax = canvas(12, 7.6, (0, 160), (0, 101))
    title(ax, 3, 98.5, "Wiring  ·  N2 turbidity probe + LM393 adapter board",
          "V→3V3 · G→GND · A→GPIO34 (ADC1_CH6) · D→GPIO27 (INPUT_PULLUP) · probe 1–4 → board 1–4 · sensors.h",
          dy=4.4)
    pos = draw_board(ax, {"D34": "D34 · GPIO34", "D27": "D27 · GPIO27", "GND_L": "GND", "3V3": "3V3",
                          "D2": "D2 · LED"})
    # adapter board: both headers on the same edge, as on the real board (4 3 2 1 above V D A G)
    card(ax, 14, 26, 20, 42, "LM393 board", "turbidity adapter\n2 SMD LEDs:\npower + D",
         fc=FILL, ec=INK, lw=1.0, hs=7.4, bs=5.8, z=2)
    bl = pins_on(ax, 34, [("4", 64), ("3", 60), ("2", 56), ("1", 52)], "R")
    br = pins_on(ax, 34, [("V", 44), ("D", 40), ("A", 36), ("G", 32)], "R")
    ax.plot([29.2, 29.2], [49.5, 66.5], color=BORDER, lw=0.6, zorder=3)
    ax.text(28.6, 58, "probe\nside", ha="right", va="center", fontsize=5.0, color=MUTED, zorder=3)
    ax.text(28.6, 38, "ESP32\nside", ha="right", va="center", fontsize=5.0, color=MUTED, zorder=3)
    ax.add_patch(Circle((17.6, 29.6), 1.4, fc=ACCENT_SOFT, ec=INK, lw=0.8, zorder=4))
    ax.plot([16.8, 18.4], [30.4, 28.8], color=INK, lw=0.9, zorder=5)
    ax.text(19.6, 29.6, "trimmer\n= D threshold", fontsize=5.2, color=INK, va="center", zorder=5)
    # probe (socket pins drawn 1 at the top so the four jumpers nest without crossing)
    card(ax, 3, 73, 19, 16, "Turbidity probe", "4-pin socket on top\nIR LED + receiver\nin the two prongs",
         fc=FILL, ec=INK, lw=1.0, hs=7.2, bs=5.6, z=2)
    pp = pins_on(ax, 22, [("1", 86), ("2", 83), ("3", 80), ("4", 77)], "R")
    for n, xv in (("4", 36.5), ("3", 38.0), ("2", 39.5), ("1", 41.0)):
        wire(ax, [bl[n], (xv, bl[n][1]), (xv, pp[n][1]), pp[n]], WIRE_GREY, lw=1.6)
    ax.text(3, 71.4, "probe 1–4 → board 1–4: 4 × F-F, straight through", fontsize=5.6, color=MUTED, va="top")
    # module -> ESP32
    wire(ax, [br["A"], (56, 36), (56, pos["D34"][1]), pos["D34"]], WIRE_YELLOW)
    wire(ax, [br["D"], (52, 40), (52, pos["D27"][1]), pos["D27"]], WIRE_GREEN, halo=True)
    wire(ax, [br["G"], (60, 32), (60, pos["GND_L"][1]), pos["GND_L"]], WIRE_BLACK)
    wire(ax, [br["V"], (44, 44), (44, 90.6), (100.5, 90.6), (100.5, pos["3V3"][1]), pos["3V3"]], WIRE_RED)
    ax.text(44.6, 86.5, "V → 3V3 (bottom of the right header)", fontsize=5.8, color=WIRE_RED)
    ax.text(3, 22, "All four module wires are female-female jumpers\n(module pins and DevKit pins are both male).\n"
            "Power: USB 5 V from the laptop or a power bank.", fontsize=6.0, color=MUTED, va="top")
    table(ax, 103, 88, [("V", "3V3", WIRE_RED, "F-F · never VIN / 5 V"),
                        ("G", "GND (left)", WIRE_BLACK, "F-F · common ground"),
                        ("A", "GPIO34 (D34)", WIRE_YELLOW, "F-F · ADC1_CH6, 11 dB"),
                        ("D", "GPIO27 (D27)", WIRE_GREEN, "F-F · INPUT_PULLUP, LOW = turbid"),
                        ("probe 1–4", "board 1–4", WIRE_GREY, "4 × F-F, straight through"),
                        ("—", "GPIO2 (D2)", ACCENT, "onboard LED (awake)")], w=55)
    note(ax, 103, 41.5, 55, 14.5, "Why 3V3 and not VIN (deliberate)",
         "The module is rated 5 V. At 5 V, A reaches 4.5 V and D swings\n"
         "to 5 V: both above the ESP32's 3.3 V pin limit, and we own no\n"
         "spare resistors for a divider. At 3.3 V the LM393 (2–36 V) and the\n"
         "IR pair still work with a smaller swing: clear water ≈ 1900–2900\n"
         "counts, turbid far lower. Raw ADC is reported, not NTU.")
    note(ax, 103, 20, 55, 18.5, "Calibrate the trimmer, check the probe cable",
         "1. Probe in clear water: turn the trimmer until the D LED just\n"
         "   goes off (D HIGH, th = 0, dashboard N2 = clear).\n"
         "2. Tap water + a pinch of milk or soil: D LED on (D LOW, th = 1),\n"
         "   N2 chip flips to turbid, N4 light turns red.\n"
         "3. Orientation: a finger in the gap between the prongs must change\n"
         "   the raw value. No change at all → reverse the probe cable\n"
         "   (no damage at 3.3 V).", soft=False)
    save(fig, "wiring_N2.png")


# ============================================================ N3 (on-chip temperature)
def wiring_n3():
    fig, ax = canvas(12, 7.6, (0, 160), (0, 101))
    title(ax, 3, 98.5, "Wiring  ·  N3 cluster head (on-chip temperature)",
          "no external part · temperatureRead() on the ESP32 die = enclosure / electronics temperature · sensors.h",
          dy=4.4)
    draw_board(ax, {"D2": "D2 · LED"})
    note(ax, 104, 68, 52, 13, "On-chip temperature sensor, no wiring",
         "The sensor is inside the ESP32 chip under the metal can.\n"
         "Value sent = round(temperatureRead() × 100), e.g. 4812\n"
         "= 48.12 °C; −1 if the read returns NaN.")
    arrow(ax, 104, 73.4, 84.2, 73.4, color=ACCENT, lw=1.2, style="-|>", ms=9)
    note(ax, 104, 44, 52, 19, "How to demonstrate it",
         "1. Open view 6 (Data Aggregation): the n3 input shows °C.\n"
         "2. Warm-up: right after power-on the value climbs for a few\n"
         "   minutes as Wi-Fi + BLE heat the die (self-heating).\n"
         "3. Hold a fingertip, or a cool dry metal spoon, on the metal can\n"
         "   for 20 s: the value moves within a few superframes.\n"
         "Serial: [N3 SENS] ESP32 die temperature sensor (uncalibrated), now …", soft=False)
    note(ax, 104, 20, 52, 19, "Caveats (stated on the dashboard and in the report)",
         "• Uncalibrated: reads the die, several °C above the room\n"
         "  (self-heating from Wi-Fi + BLE), with an offset per chip.\n"
         "• Some chips return a constant 53.33 °C (raw 128): the value\n"
         "  never moves; a chip limitation, not a wiring fault.\n"
         "• It is the electronics temperature, not water temperature.", soft=False)
    table(ax, 4, 86, [("die sensor", "inside chip", ACCENT, "nothing to connect"),
                      ("USB", "micro-USB", GREY_USB, "power + Serial 115200"),
                      ("—", "GPIO2 (D2)", ACCENT, "onboard LED (awake)")], w=56)
    ax.text(4, 60, "N3 is the scheduler and time master: keep it on USB power\n"
            "(laptop port or power bank). It prints\n"
            "MASTER N3: initial schedule v1 slots=[3,1,2,3,0,255]\n"
            "about 4.5 s after boot.", fontsize=6.4, color=MUTED, va="top")
    save(fig, "wiring_N3.png")


# ============================================================ N4 (sink + pond status light)
COL0, CPITCH = 8, 2.1           # breadboard number of the first drawn column, x pitch


def bx(n):
    return 6.5 + (n - COL0) * CPITCH


ROWY = {"f": 45.0, "g": 42.0, "h": 39.0, "i": 36.0, "j": 33.0}
RAIL_M, RAIL_P = 28.0, 24.8


def breadboard(ax):
    box(ax, 2.5, 21.5, 54, 30, fc="#fbfbfa", ec=BORDER, lw=0.9, r=1.0, z=1)
    for n in range(COL0, 31):
        for r, y in ROWY.items():
            ax.add_patch(Circle((bx(n), y), 0.42, fc="white", ec=LINE, lw=0.5, zorder=2))
        for y in (RAIL_M, RAIL_P):
            ax.add_patch(Circle((bx(n), y), 0.42, fc="white", ec=LINE, lw=0.5, zorder=2))
        if n % 5 == 0 or n in (11, 14, 24, 25, 28):
            ax.text(bx(n), 47.6, str(n), ha="center", va="center", fontsize=4.8, color=INK if n % 5 else MUTED,
                    zorder=7, bbox=dict(fc="#fbfbfa", ec="none", pad=0.4))
    for r, y in ROWY.items():
        ax.text(4.0, y, r, ha="center", va="center", fontsize=5.6, color=MUTED, fontweight="bold")
    ax.plot([bx(COL0) - 1, bx(30) + 1], [RAIL_M + 1.3] * 2, color=WIRE_BLACK, lw=0.6, zorder=2)
    ax.plot([bx(COL0) - 1, bx(30) + 1], [RAIL_P - 1.3] * 2, color=WIRE_RED, lw=0.6, zorder=2)
    ax.text(4.0, RAIL_M, "−", ha="center", va="center", fontsize=8, color=INK, fontweight="bold")
    ax.text(4.0, RAIL_P, "+", ha="center", va="center", fontsize=7, color=WIRE_RED, fontweight="bold")
    ax.text(29, 22.4, "lower half (rows f–j) shown, rows a–e unused · − rail = GND (one long strip) · + rail unused", ha="center", fontsize=5.2,
            color=MUTED)


def led_group(ax, a, colour, name):
    """LED anode a·i, cathode (a+1)·i, resistor a·h–(a+4)·h, GPIO jumper (a+4)·f, cathode jumper (a+1)·j → − rail."""
    xa, xc, xr = bx(a), bx(a + 1), bx(a + 4)
    # cathode jumper
    ax.plot([xc, xc], [ROWY["j"], RAIL_M], color=WIRE_BLACK, lw=1.6, zorder=5, solid_capstyle="round")
    for p in ((xc, ROWY["j"]), (xc, RAIL_M)):
        ax.add_patch(Circle(p, 0.45, fc=WIRE_BLACK, ec="white", lw=0.3, zorder=6))
    # resistor
    zigzag_h(ax, xa, xr, ROWY["h"], amp=0.7, n=6)
    for p in ((xa, ROWY["h"]), (xr, ROWY["h"])):
        ax.add_patch(Circle(p, 0.42, fc=INK, ec="none", zorder=6))
    # LED (top view): body between the two legs
    yb = ROWY["i"] - 0.1
    ax.plot([xa, xa], [ROWY["i"], yb], color=INK, lw=0.8, zorder=6)
    ax.add_patch(Circle(((xa + xc) / 2, yb), 1.25, fc=colour, ec=INK, lw=0.6, zorder=7))
    ax.text(xa - 0.4, ROWY["i"] - 1.9, "+", ha="center", fontsize=6, color=INK, fontweight="bold", zorder=7)
    ax.text(xc - 0.7, 30.4, name, ha="right", va="center", fontsize=4.9, color=INK, zorder=7)
    return (xr, ROWY["f"])


def wiring_n4():
    fig, ax = canvas(12, 7.6, (0, 160), (0, 101))
    title(ax, 3, 98.5, "Wiring  ·  N4 sink / gateway + pond status light",
          "green → GPIO25 · red → GPIO27, each through its resistor, cathodes to the GND rail · "
          "GPIO26 unused (no yellow LED) · sink.h", dy=4.4)
    pos = draw_board(ax, {"D25": "D25 · GPIO25", "D27": "D27 · GPIO27",
                          "GND_L": "GND", "D2": "D2 · LED"})
    breadboard(ax)
    jg = led_group(ax, 10, WIRE_GREEN, "green")
    jr = led_group(ax, 24, WIRE_RED, "red")
    # GPIO jumpers (M-F): male end in column a+4 row f, female end on the DevKit pin. Leftmost = highest route.
    wire(ax, [jg, (jg[0], 60.5), (61.5, 60.5), (61.5, pos["D25"][1]), pos["D25"]], WIRE_GREEN)
    wire(ax, [jr, (jr[0], 55.5), (57.5, 55.5), (57.5, pos["D27"][1]), pos["D27"]], WIRE_RED)
    # GND jumper (M-F): − rail column 30 to the DevKit GND (left header)
    wire(ax, [(bx(30), RAIL_M), (bx(30) + 2.5, RAIL_M), (bx(30) + 2.5, 20), (61, 20), (61, pos["GND_L"][1]),
              pos["GND_L"]], WIRE_BLACK)
    ax.text(3, 18.2, "LED long leg (anode, +) in row i next to the resistor; short leg / flat rim (cathode) in the\n"
            "next column. Resistors: any value 100 Ω–1 kΩ (220 Ω ≈ 6 mA, 1 kΩ ≈ 1.3 mA at 3.3 V).",
            fontsize=5.8, color=MUTED, va="top")
    ax.text(3, 11.5, "Holes:  green 10i/11i, R 10h–14h, jumper 14f · red 24i/25i, R 24h–28h, jumper 28f ·\n"
            "cathode jumpers 11j, 25j → − rail · GND jumper 30− → GND · columns 15–23 stay empty",
            fontsize=5.8, color=INK, va="top")
    table(ax, 4, 88, [("green LED", "GPIO25 (D25)", WIRE_GREEN, "M-F: male in 14f"),
                      ("red LED", "GPIO27 (D27)", WIRE_RED, "M-F: male in 28f"),
                      ("− rail", "GND (left)", WIRE_BLACK, "M-F: male in − rail"),
                      ("cathodes", "− rail", WIRE_BLACK, "2 × M-M: 11j, 25j")], w=56,
          cols=(0, 11, 27, 33))
    # right column: hotspot, light rules, USB
    card(ax, 104, 72, 52, 12, "Laptop mobile hotspot (2.4 GHz)",
         "SSID LAPTOP-HOTSPOT · pass 12345678\nHTTP POST http://192.168.137.1:5050/api/data every 3 s",
         fc=FILL, ec=INK, lw=1.0)
    arrow(ax, 88, 82, 104, 78, color=ACCENT, lw=1.2, ls=(0, (4, 2.5)), style="<|-|>", ms=8, rad=-0.15)
    ax.text(97.5, 77.2, "Wi-Fi STA", ha="center", fontsize=6.0, color=ACCENT)
    rows = [("green", WIRE_GREEN, "all nominal"),
            ("red", WIRE_RED, "water turbid: turbidity threshold (D), N2 flag = 1"),
            ("red blink", WIRE_RED, "hot: N1 enclosure hot (N1 flag = 1), water not turbid"),
            ("green blink", WIRE_GREEN, "stale: no data for 3 superframes (9 s)"),
            ("off", None, "waiting for first data"),
            ("test", ACCENT, "Test light: red → green, 1 s each")]
    ax.text(104, 67, "Status light (spec §9.3), two LEDs, one lit at a time", fontsize=7.4, fontweight="bold", color=INK,
            va="top")
    yy = 62.0
    for st, c, why in rows:
        if c:
            ax.add_patch(Circle((106, yy), 1.0, fc=c, ec=INK, lw=0.5, zorder=4))
        else:
            ax.add_patch(Circle((106, yy), 1.0, fc="white", ec=MUTED, lw=0.6, zorder=4))
        ax.text(108.5, yy, st, fontsize=6.4, fontweight="bold", color=INK, va="center")
        ax.text(121, yy, why, fontsize=6.1, color=MUTED, va="center")
        yy -= 4.0
    ax.text(104, yy + 1.0, "priority top→bottom: test, off, stale, red, hot, green\n"
            "flags: freshest per node, from an AGG or a direct DATA (N2 via 2>4)\n"
            "serial: [N4 LIGHT] green: all nominal", fontsize=5.9, color=MUTED, va="top")
    card(ax, 104, 6, 52, 12, "Laptop USB port",
         "5 V power + Serial 115200 baud\nJSON:{…} uplink lines → serial_bridge.py (fallback)",
         fc=FILL, ec=INK, lw=1.0)
    wire(ax, [(78, 10.5), (78, 3.5), (100, 3.5), (100, 12), (104, 12)], GREY_USB, lw=3.0, ends=False)
    ax.text(90, 1.6, "USB cable (data-capable)", ha="center", fontsize=6.0, color=MUTED)
    save(fig, "wiring_N4.png")


if __name__ == "__main__":
    wiring_n1()
    wiring_n2()
    wiring_n3()
    wiring_n4()
