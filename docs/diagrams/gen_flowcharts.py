"""docs/diagrams/flowchart.png (17-step integrated demonstration, guideline §5) and
docs/diagrams/mac_flowchart.png (CSMA/CA procedure of spec §4).

Run:  ../../.venv/bin/python gen_flowcharts.py
"""
from matplotlib.patches import Circle, Polygon

from _style import (ACCENT, ACCENT_SOFT, BORDER, FILL, INK, MUTED, WARN, arrow, box, canvas, save,
                    title)

STEPS = [
    ("BLE Discovery", "adv 'WSN-N<k>' every 100 ms + active scan", "ble_loc.h", "view 2"),
    ("RSSI Measurement", "per-neighbour RSSI, EMA 0.7 / 0.3", "ble_loc.h", "view 2"),
    ("Localization", "d = 10^((−59 − r)/22); weighted centroid at N4", "ble_loc.h · sink.h", "view 2"),
    ("Wi-Fi Initialization", "STA mode, hotspot channel, ESP-NOW, sniffer", "mac.h", "view 1"),
    ("Dynamic Schedule Assignment", "N3 broadcasts SCHED v1  [3,1,2,3,0,255]", "tdma.h", "view 4"),
    ("Channel Sensing", "idle for DIFS 2 ms (3 ms busy window)", "mac.h", "view 3"),
    ("Random Backoff", "n = random(0, cw) slots, frozen while busy", "mac.h", "view 3"),
    ("Scheduled Transmission", "TX only in own 500 ms slot, sleep elsewhere", "tdma.h", "view 4"),
    ("Unicast Communication", "DATA → next hop, ACK ≤ 40 ms, ≤ 3 retries", "mac.h", "view 5"),
    ("Data Aggregation", "N3: one AGG per superframe, reduction %", "aggregation.h", "view 6"),
    ("Multi-Hop Routing", "N1→N3→N4, N2→N3→N4 by route cost", "routing.h", "view 7"),
    ("Sink", "N4: PDR, delay, §9.1 JSON → dashboard", "sink.h", "view 8"),
    ("Link Failure", "dashboard: LINK_FAIL N1–N3 for 40 s (CTRL)", "routing.h", "view 7"),
    ("Failure Detection", "2 failed sends or 9 s without HELLO → LINK_DOWN", "routing.h", "view 7"),
    ("Alternate Route Selection", "argmin cost without the failed link → via N2", "routing.h", "view 7"),
    ("Route Recovery", "HELLOs resume → LINK_UP → ROUTE RESTORED", "routing.h", "view 7"),
    ("Performance Analysis", "PDR, loss, delay, throughput, retx, loc err, reduction", "sink.h · server",
     "view 8"),
]
PHASE = {0: "BLE", 3: "WI-FI MAC + TDMA", 9: "NETWORK", 12: "FAILURE + RECOVERY", 16: "ANALYSIS"}


def demo_flowchart():
    fig, ax = canvas(12, 12.6, (0, 120), (0, 126))
    title(ax, 4, 123, "AquaSense-WSN  ·  Integrated demonstration flow (17 steps)",
          "guideline §5 · each step: firmware module that implements it and the dashboard view that shows it "
          "(view 9 ticks them off live)", dy=3.6)
    cols = [(9, 0, 9), (65, 9, 17)]
    W, H, P, TOP = 46, 8.4, 11.2, 110.5
    centers = {}
    for cx, a, b in cols:
        for j, i in enumerate(range(a, b)):
            y = TOP - j * P - H
            hl = i >= 12 and i <= 15
            box(ax, cx, y, W, H, fc=ACCENT_SOFT if hl else FILL, ec=ACCENT if hl else BORDER, lw=0.8,
                r=1.2, z=2)
            ax.add_patch(Circle((cx + 4, y + H / 2), 2.3, fc=ACCENT, ec="none", zorder=3))
            ax.text(cx + 4, y + H / 2, str(i + 1), ha="center", va="center", fontsize=8, color="white",
                    fontweight="bold", zorder=4)
            name, desc, mod, view = STEPS[i]
            ax.text(cx + 8, y + H - 2.2, name, fontsize=8.6, fontweight="bold", color=INK, va="center", zorder=4)
            ax.text(cx + 8, y + 2.4, desc, fontsize=6.7, color=MUTED, va="center", zorder=4)
            ax.text(cx + W - 1.3, y + H - 2.2, mod, fontsize=6.6, color=ACCENT, ha="right", va="center",
                    family="DejaVu Sans Mono", zorder=4)
            ax.text(cx + W - 1.3, y + 2.4, view, fontsize=6.4, color=INK, ha="right", va="center", zorder=4,
                    bbox=dict(fc="white", ec=BORDER, lw=0.5, boxstyle="round,pad=0.25"))
            if i in PHASE:
                ax.text(cx - 1.2, y + H - 0.4, PHASE[i], fontsize=5.8, color=MUTED, ha="right", va="top",
                        rotation=90, fontweight="bold")
            centers[i] = (cx + W / 2, y, y + H)
            if i > a:
                arrow(ax, cx + W / 2, centers[i - 1][1], cx + W / 2, y + H, color=INK, lw=0.9, ms=7)
    # start pill
    box(ax, 9, 112.6, W, 4.4, "Start: hotspot → server → N4 → N3 → N1 / N2", fc="white", ec=INK, r=2.2,
        size=7.4, z=2)
    arrow(ax, 32, 112.6, 32, TOP, color=INK, lw=0.9, ms=7)
    # col 1 → col 2 connector through the gutter
    x1, ybot, _ = centers[8]
    ax.plot([x1, x1, 60, 60, 88], [ybot, ybot - 2.6, ybot - 2.6, 114.5, 114.5], color=INK, lw=0.9, zorder=1)
    arrow(ax, 88, 114.5, 88, TOP, color=INK, lw=0.9, ms=7)
    # loop-back note + end pill
    x2, yb2, _ = centers[16]
    box(ax, 65, yb2 - 7.4, W, 4.4, "End: export CSV · report · viva", fc="white", ec=INK, r=2.2, size=7.4, z=2)
    arrow(ax, x2, yb2, x2, yb2 - 3.0, color=INK, lw=0.9, ms=7)
    ax.text(65, 4.5, "Highlighted steps 13–16 are triggered from the dashboard (view 7 buttons) or by the "
            "simulator's demo scenario.", fontsize=6.8, color=MUTED, va="center")
    ax.text(65, 1.8, "Modules: firmware/wsn_node/*.h · server = server/app.py + state.py", fontsize=6.8,
            color=MUTED, va="center")
    save(fig, "flowchart.png")


# ================================================================== MAC flowchart
def diamond(ax, cx, cy, w, h, text, size=7.2):
    ax.add_patch(Polygon([(cx, cy + h / 2), (cx + w / 2, cy), (cx, cy - h / 2), (cx - w / 2, cy)],
                         closed=True, fc="white", ec=ACCENT, lw=1.0, zorder=2))
    ax.text(cx, cy, text, ha="center", va="center", fontsize=size, color=INK, zorder=3, linespacing=1.3)


def proc(ax, cx, cy, w, h, text, *, fc=FILL, ec=BORDER, color=INK, size=7.2, weight="normal", r=1.2):
    box(ax, cx - w / 2, cy - h / 2, w, h, text, fc=fc, ec=ec, r=r, size=size, color=color, weight=weight)


def lbl(ax, x, y, t, ha="left"):
    ax.text(x, y, t, fontsize=6.8, color=ACCENT, fontweight="bold", ha=ha, va="center", zorder=5,
            bbox=dict(fc="white", ec="none", pad=0.5))


def mac_flowchart():
    fig, ax = canvas(10, 13.5, (0, 100), (0, 135))
    title(ax, 3, 132.5, "CSMA/CA with ACK, timeout and retransmission",
          "macSend(frame, destMac, needAck) in mac.h · spec §4 · every outgoing frame uses it", dy=3.6)
    X = 45
    proc(ax, X, 120, 34, 5, "macSend(frame)", fc="white", ec=INK, weight="bold", r=2.4)
    proc(ax, X, 111, 38, 5.5, "retries = 0 ,  cw = CW_MIN = 4")
    diamond(ax, X, 99, 40, 11, "1  CHANNEL SENSING\nidle for DIFS = 2 ms?\n(no frame sniffed in last 3 ms)",
            size=6.8)
    proc(ax, 82, 99, 26, 8, "CS_BUSY\nbusy++ , keep sensing", ec=BORDER)
    proc(ax, X, 86, 40, 6, "2  RANDOM BACKOFF\nn = random(0, cw) slots   ( bo += n )", size=7)
    diamond(ax, X, 74, 30, 9, "n = 0 ?")
    proc(ax, 82, 74, 26, 10, "wait 1 slot (1 ms)\nidle → n − 1\nbusy → FREEZE n\n(DEFER, def++)", size=6.8)
    proc(ax, X, 62, 40, 6, "3  TRANSMIT  esp_now_send()\nfirst try: tx++   ·   retry: retx++", size=7)
    diamond(ax, X, 51, 30, 9, "unicast?\n(needAck)")
    proc(ax, 11, 51, 18, 6, "broadcast\nreturn OK", fc=FILL, size=6.8)
    diamond(ax, X, 38.5, 34, 11, "4  ACK WAIT\nACK{q} within\n40 ms?", size=6.8)
    proc(ax, 11, 38.5, 18, 8, "ACK_OK\nok++ , ackOk++\nreturn OK", fc=ACCENT_SOFT, ec=ACCENT, size=6.8)
    proc(ax, X, 26, 44, 7, "ACK_TIMEOUT  →  to++ , ackFail++ , retries++\ncw = min(2·cw, 32)   "
         "(binary exponential backoff)", size=6.8)
    diamond(ax, X, 14.5, 38, 10, "retries > 3  or\nprocedure > 400 ms ?", size=6.8)
    proc(ax, X, 4.3, 56, 6, "TX_FAIL  →  return FAIL  →  routing: consecFail++  (2 in a row → LINK_DOWN)",
         fc="#fdf0ea", ec=WARN, color=WARN, size=6.8)

    k = dict(color=INK, lw=0.9, ms=7)
    arrow(ax, X, 117.5, X, 113.75, **k)
    arrow(ax, X, 108.25, X, 104.5, **k)
    # D1 no -> CS_BUSY -> back
    arrow(ax, X + 20, 99, 69, 99, **k); lbl(ax, 66, 100.6, "no", "center")
    ax.plot([82, 82, X], [103, 106.4, 106.4], color=INK, lw=0.9)
    arrow(ax, X + 0.01, 106.4, X, 104.5, **k)
    arrow(ax, X, 93.5, X, 89, **k); lbl(ax, X + 1.5, 91.3, "yes")
    arrow(ax, X, 83, X, 78.5, **k)
    # D2 no -> wait slot -> back
    arrow(ax, X + 15, 74, 69, 74, **k); lbl(ax, 64.5, 75.6, "no", "center")
    ax.plot([82, 82, X], [79, 80.6, 80.6], color=INK, lw=0.9)
    arrow(ax, X, 69.5, X, 65, **k); lbl(ax, X + 1.5, 67.3, "yes")
    arrow(ax, X, 59, X, 55.5, **k)
    arrow(ax, X - 15, 51, 20, 51, **k); lbl(ax, 25, 52.6, "no", "center")
    arrow(ax, X, 46.5, X, 44, **k); lbl(ax, X + 1.5, 45.2, "yes")
    arrow(ax, X - 17, 38.5, 20, 38.5, **k); lbl(ax, 24, 40.1, "yes", "center")
    arrow(ax, X, 33, X, 29.5, **k); lbl(ax, X + 1.5, 31.2, "no")
    arrow(ax, X, 22.5, X, 19.5, **k)
    arrow(ax, X, 9.5, X, 7.3, **k); lbl(ax, X + 1.5, 8.4, "yes")
    # retry loop
    ax.plot([X + 19, 97, 97, 82.2], [14.5, 14.5, 106.4, 106.4], color=ACCENT, lw=1.0, ls=(0, (4, 2)))
    lbl(ax, 72, 16.1, "no → retry (new backoff with doubled cw)", "center")
    ax.text(97.8, 60, "retransmission loop", rotation=90, fontsize=6.6, color=ACCENT, va="center")
    # parameters box
    ax.text(3, 26, "Parameters (config.h)\nMAC_SLOT_US 1000\nMAC_DIFS_US 2000\nMAC_CW_MIN 4\n"
            "MAC_CW_MAX 32\nMAC_ACK_TIMEOUT_MS 40\nMAC_MAX_RETRIES 3\nMAC_CS_BUSY_US 3000\n"
            "MAC_TX_DEADLINE_MS 400", fontsize=6.2, color=MUTED, va="top", family="DejaVu Sans Mono",
            linespacing=1.4)
    save(fig, "mac_flowchart.png")


if __name__ == "__main__":
    demo_flowchart()
    mac_flowchart()
