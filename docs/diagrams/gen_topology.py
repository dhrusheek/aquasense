"""docs/diagrams/network_topology.png — physical table layout at true scale (spec §2, §8).

NODE_POS (cm): N2 (0,0), N3 (120,0), N4 (60,90), N1 (50,30). Links = the ALLOWED table of config.h.
Run:  ../../.venv/bin/python gen_topology.py
"""
import math

import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyBboxPatch

from _style import ACCENT, ACCENT_SOFT, BORDER, INK, MUTED, WARN, save

POS = {"N1": (50, 30), "N2": (0, 0), "N3": (120, 0), "N4": (60, 90)}
ROLE = {"N1": "target · on-chip temp", "N2": "anchor · turbidity / relay",
        "N3": "anchor · cluster head (on-chip temp)", "N4": "anchor · sink + status light"}
ALLOWED = [("N1", "N2"), ("N1", "N3"), ("N2", "N3"), ("N2", "N4"), ("N3", "N4")]
PRIMARY = {("N1", "N3"), ("N2", "N3"), ("N3", "N4")}

fig = plt.figure(figsize=(10, 8))
ax = fig.add_axes([0.08, 0.08, 0.66, 0.78])
ax.set_xlim(-30, 150)
ax.set_ylim(-30, 120)
ax.set_aspect("equal")
for s in ax.spines.values():
    s.set_visible(False)
ax.grid(True, color="#eef1f4", lw=0.6)
ax.set_xticks(range(-30, 151, 30))
ax.set_yticks(range(-30, 121, 30))
ax.tick_params(colors=MUTED, labelsize=7, length=0)
ax.set_xlabel("x (cm)", fontsize=8, color=MUTED)
ax.set_ylabel("y (cm)", fontsize=8, color=MUTED)
ax.add_patch(FancyBboxPatch((-20, -20), 160, 130, boxstyle="round,pad=0,rounding_size=4", fc="none",
                            ec=BORDER, lw=0.9, ls=(0, (4, 3)), zorder=0))
ax.text(-18, 106, "lab table (all boards in real radio range)", fontsize=7, color=MUTED, va="center")

# true-distance circles from the anchors to the target (what BLE ranging estimates)
for a in ("N2", "N3", "N4"):
    d = math.dist(POS[a], POS["N1"])
    ax.add_patch(Circle(POS[a], d, fc="none", ec=ACCENT, lw=0.5, ls=(0, (1, 2.5)), alpha=0.7, zorder=1))

for a, b in ALLOWED:
    (x1, y1), (x2, y2) = POS[a], POS[b]
    prim = (a, b) in PRIMARY
    ax.plot([x1, x2], [y1, y2], color=ACCENT, lw=2.2 if prim else 1.1,
            ls="-" if prim else (0, (4, 2.5)), zorder=2, solid_capstyle="round")
    d = math.dist(POS[a], POS[b])
    f = 0.35 if (a, b) == ("N1", "N2") else 0.5     # N1–N2 label nearer N2, clear of the N1 caption
    mx, my = x2 + (x1 - x2) * f, y2 + (y1 - y2) * f
    ax.text(mx, my, "%s–%s  %.0f cm" % (a, b, d), fontsize=6.8, color=INK, ha="center", va="center",
            zorder=5, bbox=dict(fc="white", ec="none", pad=1.0))
# blocked N1-N4
(x1, y1), (x2, y2) = POS["N1"], POS["N4"]
ax.plot([x1, x2], [y1, y2], color=WARN, lw=1.0, ls=(0, (1, 2)), zorder=2)
ax.text(57, 55, "N1–N4  %.0f cm\nout of range (policy)" % math.dist(POS["N1"], POS["N4"]), fontsize=6.8,
        color=WARN, ha="left", va="center", zorder=5, bbox=dict(fc="white", ec="none", pad=1.0))

off = {"N1": (0, -12), "N2": (0, -12), "N3": (0, -12), "N4": (0, 11)}
for n, (x, y) in POS.items():
    tgt = n == "N1"
    ax.add_patch(Circle((x, y), 6, fc=ACCENT if tgt else ACCENT_SOFT, ec=ACCENT, lw=1.2, zorder=6))
    ax.text(x, y, n, ha="center", va="center", fontsize=9, fontweight="bold",
            color="white" if tgt else INK, zorder=7)
    dx, dy = off[n]
    ax.text(x + dx, y + dy, "%s  (%d, %d)\n%s" % (n, x, y, ROLE[n]), ha="center", va="center",
            fontsize=7, color=INK, zorder=7, linespacing=1.3, bbox=dict(fc="white", ec="none", pad=0.8))

fig.text(0.08, 0.955, "AquaSense-WSN  ·  Network topology at true scale", fontsize=13, fontweight="bold",
         color=INK, va="top")
fig.text(0.08, 0.915, "NODE_POS from config.h / server config.py (spec §8). Every board is within real "
         "radio range; the ALLOWED table makes N1–N4 unreachable so N1 must multi-hop.",
         fontsize=8, color=MUTED, va="top")

# side legend
lx = 0.77
items = [("Primary route link", dict(color=ACCENT, lw=2.2)),
         ("Allowed, alternate link", dict(color=ACCENT, lw=1.1, ls=(0, (4, 2.5)))),
         ("Not allowed (policy)", dict(color=WARN, lw=1.0, ls=(0, (1, 2)))),
         ("True anchor→target distance", dict(color=ACCENT, lw=0.6, ls=(0, (1, 2.5))))]
fig.text(lx, 0.83, "LEGEND", fontsize=8, fontweight="bold", color=ACCENT)
for i, (t, kw) in enumerate(items):
    y = 0.79 - i * 0.04
    fig.add_artist(plt.Line2D([lx, lx + 0.035], [y, y], transform=fig.transFigure, **kw))
    fig.text(lx + 0.045, y, t, fontsize=7.4, color=INK, va="center")
txt = ("Routes (spec §6)\n"
       "  primary  N1→N3→N4   cost 20\n"
       "  primary  N2→N3→N4   cost 20\n"
       "  alternate N1→N2→N3→N4   30\n"
       "  alternate N2→N4         30\n\n"
       "Localization (spec §8)\n"
       "  target  N1 (filled)\n"
       "  anchors N2, N3, N4\n"
       "  est = Σ wᵢ·Pᵢ / Σ wᵢ,  wᵢ = 1/dᵢ²\n"
       "  error = |est − true| cm\n\n"
       "Place the boards on the table at\n"
       "these positions (cm from N2).")
fig.text(lx, 0.6, txt, fontsize=7.3, color=INK, va="top", linespacing=1.45, family="DejaVu Sans Mono")
save(fig, "network_topology.png")
