"""docs/diagrams/tdma_superframe.png — 6 × 500 ms superframe, a dynamic update, awake/sleep bars (spec §5).

Run:  ../../.venv/bin/python gen_tdma.py
"""
from matplotlib.patches import Rectangle

from _style import ACCENT, ACCENT_SOFT, BORDER, FILL, INK, MUTED, canvas, save, title

X0, SW = 24.0, 17.6          # timeline start, slot width (data units per 500 ms)
V1 = [3, 1, 2, 3, 0, 255]
V2 = [3, 1, 2, 3, 0, 1]
TEXT = {
    0: ("BEACON", "SCHED bcast · N3\n(N2 re-bcast +60 ms)"),
    1: ("N1", "DATA + STAT\n→ next hop"),
    2: ("N2", "DATA + STAT\n+ queued N1 frames"),
    3: ("N3", "AGG + STAT\n→ N4"),
    4: ("CONTROL", "CSMA contention\nHELLO · CTRL · test"),
    5: ("UNUSED", "all nodes sleep"),
}


def slot_cell(ax, i, y, h, owner, highlight=False):
    x = X0 + i * SW
    if owner == 255:
        fc, hatch, ec = "white", "////", BORDER
    elif owner == 0:
        fc, hatch, ec = FILL, None, BORDER
    elif i == 0:
        fc, hatch, ec = ACCENT, None, ACCENT
    else:
        fc, hatch, ec = ACCENT_SOFT, None, ACCENT
    ax.add_patch(Rectangle((x, y), SW, h, fc=fc, ec=ec, lw=1.6 if highlight else 0.7, hatch=hatch, zorder=2))
    if highlight:
        ax.add_patch(Rectangle((x, y), SW, h, fc="none", ec=INK, lw=1.6, zorder=3))
    if i == 0:
        head, sub = TEXT[0]
        col = "white"
    elif owner == 255:
        head, sub = TEXT[5]
        col = MUTED
    elif owner == 0:
        head, sub = TEXT[4]
        col = INK
    elif i == 5:
        head, sub = "N1  (retx slot)", "resends DATA that failed\nin slot 1 + flushes queue"
        col = INK
    else:
        head, sub = TEXT[i]
        col = INK
    ax.text(x + SW / 2, y + h - 2.2, head, ha="center", va="center", fontsize=8, fontweight="bold",
            color=col, zorder=4, bbox=dict(fc="white", ec="none", pad=0.4) if owner == 255 else None)
    ax.text(x + SW / 2, y + h / 2 - 1.6, sub, ha="center", va="center", fontsize=6.2,
            color="white" if i == 0 else MUTED, zorder=4, linespacing=1.3,
            bbox=dict(fc="white", ec="none", pad=0.4) if owner == 255 else None)


def row(ax, y, h, sched, label, sub, hl=None):
    ax.text(X0 - 2, y + h / 2 + 1.6, label, ha="right", va="center", fontsize=8.4, fontweight="bold", color=INK)
    ax.text(X0 - 2, y + h / 2 - 2.0, sub, ha="right", va="center", fontsize=6.6, color=MUTED, linespacing=1.3)
    for i, o in enumerate(sched):
        slot_cell(ax, i, y, h, o, highlight=(i == hl))


def awake_set(node, sched, next_hop):
    s = set()
    for i, o in enumerate(sched):
        if o == 255:
            continue
        if node in (3, 4):                       # mains / USB powered: awake except UNUSED
            s.add(i)
        elif i == 0 or o == 0 or o == node or next_hop.get(o) == node:
            s.add(i)
    return s


fig, ax = canvas(14, 8.2, (0, 140), (0, 82))
title(ax, 3, 79.5, "Dynamic TDMA superframe and sleep / wake",
      "TDMA_SLOT_MS 500 × TDMA_SLOTS 6 = 3000 ms · N3 is scheduler + time master (N4 backup after 3 silent "
      "superframes) · tdma.h", dy=3.8)

# time axis
for i in range(7):
    x = X0 + i * SW
    ax.plot([x, x], [6, 66.5], color="#e6eaee", lw=0.6, zorder=0)
    ax.text(x, 68, "%d ms" % (i * 500), ha="center", fontsize=6.6, color=MUTED)
for i in range(6):
    ax.text(X0 + i * SW + SW / 2, 64.2, "slot %d" % i, ha="center", fontsize=7, color=INK, fontweight="bold")

row(ax, 47, 14, V1, "Schedule v1", "why: \"initial\"\nslots [3,1,2,3,0,255]")
row(ax, 30, 14, V2, "Schedule v2", "why: \"retx slot for N1\"\nslots [3,1,2,3,0,1]", hl=5)
ax.annotate("rule 3: N1 ACK-timeout ratio > 20 %\n→ UNUSED slot 5 becomes N1's 2nd slot;\n"
            "released again below 5 % (\"retx slot released\")",
            xy=(X0 + 5.5 * SW, 30), xytext=(X0 + 3.9 * SW, 28.6), fontsize=6.4, color=INK, ha="center", va="top",
            arrowprops=dict(arrowstyle="-|>", color=INK, lw=0.7, connectionstyle="angle,angleA=0,angleB=90"), zorder=6,
            bbox=dict(fc="white", ec=BORDER, lw=0.5, boxstyle="round,pad=0.4"))


# awake / sleep bars (schedule v1, primary routes)
nh = {1: 3, 2: 3, 3: 4}
ax.text(3, 23.5, "Awake / sleep  (schedule v1, primary routes)", fontsize=8.4, fontweight="bold", color=INK)
for r, node in enumerate([1, 2, 3, 4]):
    y = 17.2 - r * 3.9
    aw = awake_set(node, V1, nh)
    ax.text(X0 - 2, y + 1.3, "N%d" % node, ha="right", va="center", fontsize=7.6, fontweight="bold", color=INK)
    for i in range(6):
        on = i in aw
        ax.add_patch(Rectangle((X0 + i * SW + 0.25, y), SW - 0.5, 2.6, fc=ACCENT if on else "#e9edf1",
                               ec="none", zorder=2))
    duty = len(aw) / 6 * 100
    ax.text(X0 + 6 * SW + 1.2, y + 1.3, "duty %.0f %%" % duty, va="center", fontsize=6.8, color=INK)
ax.add_patch(Rectangle((3, 7.0), 3, 1.8, fc=ACCENT, ec="none"))
ax.text(6.8, 7.9, "awake (LED on)", fontsize=6.4, color=INK, va="center")
ax.add_patch(Rectangle((3, 4.2), 3, 1.8, fc="#e9edf1", ec="none"))
ax.text(6.8, 5.1, "sleep: no TX, BLE scan\npaused, LED off", fontsize=6.0, color=MUTED, va="center", linespacing=1.2)
ax.text(X0, 1.6, "A node is awake in slot 0, in its own slots, in CONTROL slots and in slots owned by its children "
        "(nodes whose next hop it is). N3 and N4 are USB powered: awake except UNUSED. "
        "TX starts at slot start + random(0–20 ms) guard.", fontsize=6.4, color=MUTED, va="center")
save(fig, "tdma_superframe.png")
