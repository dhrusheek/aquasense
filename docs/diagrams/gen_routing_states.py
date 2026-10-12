"""docs/diagrams/routing_states.png — link failure detection / alternate route / recovery state diagram
(spec §6, routing.h), with the route-cost formula.

Run:  ../../.venv/bin/python gen_routing_states.py
"""
from _style import ACCENT, ACCENT_SOFT, BORDER, FILL, INK, MUTED, WARN, arrow, box, canvas, save, title

fig, ax = canvas(13, 8.4, (0, 130), (0, 84))
title(ax, 3, 81.5, "Adaptive routing  ·  failure detection and route recovery",
      "per-neighbour state in routing.h · example: LINK_FAIL N1–N3 from the dashboard (CTRL), as in the demo",
      dy=3.8)

W, H = 30, 13
ST = {
    "up": (5, 57, "LINK UP", "primary route  N1→N3→N4\ncost 20 · p = \"1>3>4\"", ACCENT_SOFT, ACCENT),
    "down": (50, 57, "LINK DOWN", "neighbour N3: linkUp = false\nevent \"LINK_DOWN N3\"", "#fdf0ea", WARN),
    "upd": (95, 57, "ROUTE UPDATE", "recompute cost of all neighbours\nimmediate HELLO with new h", FILL, BORDER),
    "alt": (95, 30, "ALTERNATE ROUTE", "N1→N2→N3→N4 · cost 30\np = \"1>2>3>4\", PDR keeps rising", ACCENT_SOFT, ACCENT),
    "rest": (50, 30, "RESTORED", "N3 linkUp = true · next hop back to N3 · cost 30→20\nevent \"ROUTE RESTORED\"", ACCENT_SOFT, ACCENT),
}
P = {}
for k, (x, y, h, s, fc, ec) in ST.items():
    P[k] = box(ax, x, y, W, H, fc=fc, ec=ec, lw=1.1 if k != "upd" else 0.8, r=2.2, z=2,
               ls=(0, (3, 2)) if k == "upd" else "-")
    ax.text(x + W / 2, y + H - 3.2, h, ha="center", va="center", fontsize=9, fontweight="bold",
            color=WARN if k == "down" else INK, zorder=3)
    ax.text(x + W / 2, y + 4.2, s, ha="center", va="center", fontsize=6.6, color=MUTED, zorder=3,
            linespacing=1.35)


def lab(x, y, t, color=INK, ha="center"):
    ax.text(x, y, t, ha=ha, va="center", fontsize=6.7, color=color, zorder=5, linespacing=1.35,
            bbox=dict(fc="white", ec="none", pad=0.8))


k = dict(color=INK, lw=1.0, ms=9)
arrow(ax, 35, 63.5, 50, 63.5, **k)
lab(42.5, 67.8, "consecFail ≥ 2\n(2 frames in a row\nexhausted 3 retries)\nOR no HELLO 9 s", WARN)
arrow(ax, 80, 63.5, 95, 63.5, **k)
lab(87.5, 67.2, "linkUp\nchanged")
arrow(ax, 110, 57, 110, 43, **k)
lab(119.5, 50, "argmin cost\nwithout the\nfailed link", ha="center")
arrow(ax, 95, 36.5, 80, 36.5, **k)
lab(87.5, 41.5, "HELLOs resume\n(2 HELLOs heard)\nor unicast OK")
ax.plot([50, 20, 20], [36.5, 36.5, 57], color=INK, lw=1.0, zorder=1)
arrow(ax, 20, 52, 20, 57, **k)
lab(31, 41.5, "primary cost\nlower again")
# LINK_RESTORE / timer note
ax.text(5, 31.5, "Trigger in the demo: dashboard\n\"Simulate link failure N1–N3 (40 s)\"\n"
        "→ N1 and N3 drop each other's frames,\nno ACKs → ACK_TIMEOUT → TX_FAIL.\n"
        "\"Restore\" or the 40 s timer ends it.", fontsize=6.4, color=MUTED, va="center", linespacing=1.35)

# cost formula panel
box(ax, 3, 2, 124, 22, fc=FILL, ec=BORDER, r=1.8, z=0)
ax.text(5, 22, "ROUTE COST  (lower is better, computed for every neighbour that is known, link up, "
        "hops < 255 and ALLOWED)", fontsize=7.4, color=ACCENT, fontweight="bold", va="top")
ax.text(5, 17.4, "cost = 10 · (hops + 1)\n"
        "     + (100 − ackRatePct) / 5\n"
        "     + max(0, −70 − wifiRssi) / 2\n"
        "     + 20  if member (N1/N2) and next ≠ N3 while N3 is reachable",
        fontsize=7.6, color=INK, va="top", family="DejaVu Sans Mono", linespacing=1.5)
ax.text(5, 3.6, "next hop = argmin cost · alternate = 2nd best · hopsToSink = hops(next) + 1",
        fontsize=6.8, color=MUTED, va="center")
rows = [("term", "meaning"), ("10·(hops+1)", "hop count via that neighbour"),
        ("(100−ack%)/5", "packet loss on the link (ACK window 20)"),
        ("RSSI penalty", "link quality below −70 dBm"),
        ("+20", "aggregation-aware: members prefer the cluster head")]
for i, (a, b) in enumerate(rows):
    y = 20.0 - i * 3.2
    ax.text(78, y, a, fontsize=6.8, color=INK if i else MUTED, va="center", fontweight="bold" if i == 0 else "normal",
            family="DejaVu Sans Mono" if i else None)
    ax.text(96, y, b, fontsize=6.8, color=INK if i else MUTED, va="center", fontweight="bold" if i == 0 else "normal")
ax.text(78, 3.6, "N1: via N3 = 20 · via N2 = 30   ·   N2: via N3 = 20 · direct N4 = 10 + 20 = 30",
        fontsize=6.8, color=INK, va="center")
save(fig, "routing_states.png")
