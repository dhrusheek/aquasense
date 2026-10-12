"""docs/diagrams/architecture.png — AquaSense-WSN system architecture (spec §1, §2, §3, §6, §9).

Run:  ../../.venv/bin/python gen_architecture.py
"""
from _style import (ACCENT, ACCENT_SOFT, BORDER, FILL, INK, MUTED, WARN, arrow, box, canvas, card,
                    panel, save, title)

fig, ax = canvas(14, 9.0, (0, 170), (0, 109))
title(ax, 3, 106.5, "AquaSense-WSN  ·  System architecture",
      "4 × ESP32-WROOM-32  ·  BLE for discovery / RSSI / localization  ·  Wi-Fi ESP-NOW for all network "
      "traffic  ·  laptop dashboard", dy=4.6)

# ---------------------------------------------------------------- BLE layer
panel(ax, 3, 70, 117, 28, "BLE LAYER  ·  ble_loc.h",
      "every node advertises 'WSN-N<k>' every 100 ms and actively scans (interval 100 ms / window 50 ms)")
mini = {1: (20, 77.5), 2: (8, 74.5), 3: (35, 74.5), 4: (26, 87)}
mp = {k: box(ax, x - 3.4, y - 2.1, 6.8, 4.2, "N%d" % k, fc=ACCENT_SOFT, ec=ACCENT, size=8,
             weight="bold", r=1, z=3) for k, (x, y) in mini.items()}
for a, b in [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)]:
    (x1, y1), (x2, y2) = mini[a], mini[b]
    arrow(ax, x1, y1, x2, y2, color=ACCENT, lw=0.7, ls=(0, (2, 1.6)), style="<|-|>", ms=6,
          patchA=mp[a], patchB=mp[b])
ax.text(39, 87, "adv + scan\nbetween all pairs\n(incl. N1–N4)", fontsize=6.6, color=MUTED, va="center")

steps = [
    ("RSSI", "scan callback\nraw dBm per\nneighbour"),
    ("EMA", "r = 0.7·r + 0.3·rssi"),
    ("Distance", "d = 10^((−59−r)/22)\nm → cm, 5–1000"),
    ("Nearest node", "argmax r\n→ STAT.near"),
    ("Localization", "at N4: weighted\ncentroid, w = 1/d²\n3 anchors"),
    ("Error", "|est − true| cm\n→ view 2"),
]
x0, w, gap = 50.5, 10.6, 0.9
for i, (h, s) in enumerate(steps):
    x = x0 + i * (w + gap)
    card(ax, x, 73.5, w, 10.5, h, s, hs=7.6, bs=6.2)
    if i:
        arrow(ax, x - gap, 78.7, x, 78.7, color=ACCENT, lw=0.9, ms=6, z=4)
ax.text(52, 89.6, "RSSI_1M = −59 dBm, n = 2.2  →  STAT.ble [[n, rssi, dist_cm]]  →  sink  →  uplink "
        "'localization'", fontsize=7, color=INK, va="center")

# ---------------------------------------------------------------- Wi-Fi / ESP-NOW layer
panel(ax, 3, 19, 117, 48, "WI-FI / ESP-NOW LAYER  ·  mac.h  tdma.h  routing.h  aggregation.h  sink.h",
      "2.4 GHz, one channel adopted from the hotspot  ·  CSMA/CA + ACK  ·  6 × 500 ms TDMA  ·  "
      "cost-based multi-hop routing")
W, H = 27, 8.5
nodes = {
    1: (8, 45, "N1  ·  Sensor node", "on-chip temp + TEMP_WARN alert\nslot 1: DATA + STAT"),
    2: (8, 24, "N2  ·  Sensor / Relay", "Turbidity A → GPIO34, D → GPIO27\nslot 2: DATA, forwards N1 (alt)"),
    3: (51, 35, "N3  ·  Cluster head", "on-chip temperature sensor\nscheduler · aggregator · router"),
    4: (89.5, 35, "N4  ·  Sink / Gateway", "status light GPIO25/27\nUSB + Wi-Fi STA · PDR · loc."),
}
patch = {}
for k, (x, y, h, s) in nodes.items():
    hub = k in (3, 4)
    patch[k] = card(ax, x, y, W, H, h, s, fc=ACCENT_SOFT if hub else FILL, ec=ACCENT if hub else BORDER,
                    lw=0.9)


def ctr(k):
    return nodes[k][0] + W / 2, nodes[k][1] + H / 2


def lab(x, y, t, color=INK):
    ax.text(x, y, t, fontsize=6.8, color=color, ha="center", va="center", zorder=6,
            bbox=dict(fc="white", ec="none", pad=0.8))


def link(a, b, kind, rad=0.0):
    (x1, y1), (x2, y2) = ctr(a), ctr(b)
    if kind == "primary":
        arrow(ax, x1, y1, x2, y2, color=ACCENT, lw=2.2, ms=10, rad=rad, patchA=patch[a], patchB=patch[b])
    elif kind == "alt":
        arrow(ax, x1, y1, x2, y2, color=ACCENT, lw=1.1, ls=(0, (4, 2.5)), ms=8, rad=rad,
              patchA=patch[a], patchB=patch[b])
    else:
        arrow(ax, x1, y1, x2, y2, color=WARN, lw=0.9, ls=(0, (1, 2)), style="-", rad=rad,
              patchA=patch[a], patchB=patch[b])


link(1, 3, "primary"); lab(42, 47.6, "DATA  c=20")
link(2, 3, "primary"); lab(46, 31.0, "DATA  c=20")
link(3, 4, "primary"); lab(83.3, 41.6, "AGG + STAT")
link(1, 2, "alt"); lab(21.5, 38.8, "alt  c=30")
link(2, 4, "alt", rad=0.3); lab(66, 22.6, "alt  N2→N4  c=30")
link(1, 4, "blocked", rad=-0.2)
lab(70, 58.5, "N1–N4 out of range (policy): frames dropped and counted as oor", WARN)

# ---------------------------------------------------------------- uplink column
panel(ax, 124, 19, 43, 79, "UPLINK & DASHBOARD")
col = [(82, "Laptop mobile hotspot", "2.4 GHz  ·  SSID LAPTOP-HOTSPOT\nN4 joins as Wi-Fi station"),
       (65, "Flask server  :5050", "server/app.py\nPOST /api/data  ·  GET /api/state"),
       (48, "Browser dashboard", "Overview + views 1–9 (rubric)\nlight / dark  ·  offline")]
for y, h, s in col:
    card(ax, 127, y, 37, 8.5, h, s)
arrow(ax, 147, 82, 147, 73.5, color=INK, lw=0.9, ms=7)
ax.text(148.5, 77.75, "HTTP POST every 3 s", fontsize=6.4, color=MUTED, va="center")
arrow(ax, 147, 65, 147, 56.5, color=INK, lw=0.9, ms=7)
ax.text(148.5, 60.75, "poll /api/state (1 s)", fontsize=6.4, color=MUTED, va="center")
arrow(ax, 141, 56.5, 141, 65, color=ACCENT, lw=0.9, ms=7)
ax.text(139.5, 60.75, "button → command", fontsize=6.4, color=ACCENT, va="center", ha="right")
card(ax, 127, 26, 37, 11, "Fallback: USB serial",
     "N4 prints  JSON:{…}  every superframe;\nserial_bridge.py POSTs it to the server\n"
     "and writes  CMD:{…}  lines back (115200)", ec=BORDER)

# N4 -> hotspot (Wi-Fi STA) and N4 -> USB bridge, as orthogonal connectors
ax.plot([116.5, 122, 122, 127], [41.5, 41.5, 86.25, 86.25], color=INK, lw=1.0, zorder=1)
arrow(ax, 125, 86.25, 127, 86.25, color=INK, lw=1.0, ms=7)
ax.text(122.4, 64, "Wi-Fi STA · §9.1 JSON", fontsize=6.4, color=INK, rotation=90, ha="left", va="center")
ax.plot([116.5, 120, 120, 127], [37, 37, 31.5, 31.5], color=INK, lw=0.9, ls=(0, (3, 2)), zorder=1)
arrow(ax, 125, 31.5, 127, 31.5, color=INK, lw=0.9, ms=7)
ax.text(119.6, 33.5, "USB", fontsize=6.4, color=INK, ha="right", va="center")

# ---------------------------------------------------------------- legend
box(ax, 3, 2, 164, 14, fc=FILL, ec=BORDER, r=1.6, z=0)
ax.text(5, 14, "LEGEND", fontsize=7.5, color=ACCENT, fontweight="bold", va="top")
for i, (k, t) in enumerate([("p", "Primary route  N1→N3→N4,  N2→N3→N4"),
                            ("a", "Alternate route  N1→N2→N3→N4,  N2→N4"),
                            ("b", "Not allowed (simulated range, N1–N4)")]):
    y = 10.3 - i * 3.3
    sty = {"p": dict(color=ACCENT, lw=2.2), "a": dict(color=ACCENT, lw=1.1, ls=(0, (4, 2.5))),
           "b": dict(color=WARN, lw=0.9, ls=(0, (1, 2)))}[k]
    ax.plot([5, 12], [y, y], **sty)
    ax.text(13.5, y, t, fontsize=7, color=INK, va="center")
ax.text(60, 13.2, "BROADCAST  ·  peer FF:FF:FF:FF:FF:FF, not ACKed", fontsize=7.2, fontweight="bold",
        color=INK, va="center")
for i, t in enumerate(["HELLO  every node, CONTROL slot: hops, next hop, cost, neighbour list",
                       "SCHED  N3 (N4 backup), slot 0, N2 re-broadcasts: slot table, ver, why",
                       "CTRL  N4 from the dashboard, relayed by N3/N2: LINK_FAIL, SCHED_UPDATE …"]):
    ax.text(60, 9.9 - i * 3.0, t, fontsize=6.7, color=MUTED, va="center")
ax.text(117, 13.2, "UNICAST  ·  learned peer MAC, CSMA/CA + ACK", fontsize=7.2, fontweight="bold",
        color=INK, va="center")
for i, t in enumerate(["DATA  N1/N2 reading, hop by hop, path field e.g. 1>2>3",
                       "AGG  N3 → N4, one frame per superframe (window stats)",
                       "STAT  per-node counters  ·  ACK  link-layer ack (q, at)"]):
    ax.text(117, 9.9 - i * 3.0, t, fontsize=6.7, color=MUTED, va="center")

save(fig, "architecture.png")
