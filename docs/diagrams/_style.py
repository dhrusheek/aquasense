"""Shared drawing style for the AquaSense-WSN diagrams (matplotlib, 300 dpi, white background).

One accent colour (teal, same as the dashboard), neutral greys, thin lines, sans-serif text.
Every gen_*.py script imports this module and writes its PNG next to itself.
"""
from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

ACCENT = "#0e9aa7"      # teal accent (dashboard brand colour)
ACCENT_SOFT = "#e3f4f5"
INK = "#1f2933"         # primary text / lines
MUTED = "#6b7785"       # secondary text
LINE = "#9aa5b1"        # neutral connector
FILL = "#f6f8fa"        # neutral box fill
BORDER = "#c9d1d9"
WARN = "#c2410c"        # used sparingly for failure / blocked
WIRE_RED = "#d64545"
WIRE_BLACK = "#222222"
WIRE_YELLOW = "#e0a800"
WIRE_GREEN = "#2f9e5a"     # LED / D-output wire
WIRE_GREY = "#8a949e"      # probe cable jumpers

plt.rcParams.update({
    # Arial for text (regular + bold), Arial Unicode MS / DejaVu Sans as glyph fallback (arrows, Ω, ², …)
    "font.family": ["Arial", "Arial Unicode MS", "DejaVu Sans"],
    "font.size": 9,
    "axes.edgecolor": BORDER,
    "savefig.facecolor": "white",
    "figure.facecolor": "white",
})


def canvas(w_in: float, h_in: float, xlim=(0, 100), ylim=(0, 100)):
    """Blank figure with data coordinates xlim × ylim and no axes."""
    fig = plt.figure(figsize=(w_in, h_in))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, text="", *, fc=FILL, ec=BORDER, lw=0.8, r=1.2, color=INK,
        size=9, weight="normal", ha="center", va="center", z=2, ls="-"):
    """Rounded box with (x, y) = lower-left corner; text is centred unless ha/va say otherwise."""
    p = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=%g" % r,
                       fc=fc, ec=ec, lw=lw, zorder=z, ls=ls)
    ax.add_patch(p)
    if text:
        tx = x + w / 2 if ha == "center" else (x + 1.2 if ha == "left" else x + w - 1.2)
        ty = y + h / 2 if va == "center" else (y + h - 1.2 if va == "top" else y + 1.2)
        ax.text(tx, ty, text, ha=ha, va=va, color=color, fontsize=size, fontweight=weight,
                zorder=z + 1, linespacing=1.35)
    return p


def arrow(ax, x1, y1, x2, y2, *, color=LINE, lw=0.9, ls="-", style="-|>", ms=8, rad=0.0, z=1,
          shrinkA=0, shrinkB=0, patchA=None, patchB=None, conn=None):
    """Thin arrow from (x1, y1) to (x2, y2); patchA/patchB clip the line at box borders."""
    a = FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=ms, color=color,
                        lw=lw, ls=ls, zorder=z, shrinkA=shrinkA, shrinkB=shrinkB,
                        patchA=patchA, patchB=patchB,
                        connectionstyle=conn or "arc3,rad=%g" % rad)
    ax.add_patch(a)
    return a


def title(ax, x, y, text, sub=None, size=13, dy=4.0):
    """Diagram title (bold) with an optional muted subtitle dy data units under it."""
    ax.text(x, y, text, ha="left", va="top", fontsize=size, fontweight="bold", color=INK)
    if sub:
        ax.text(x, y - dy, sub, ha="left", va="top", fontsize=8.5, color=MUTED)


def save(fig, name: str) -> str:
    """Save as 300 dpi PNG next to this module and close the figure."""
    path = os.path.join(HERE, name)
    fig.savefig(path, dpi=300, facecolor="white")
    plt.close(fig)
    print("wrote", path)
    return path


def panel(ax, x, y, w, h, label=None, sub=None, *, r=2.0):
    """Large white section panel drawn underneath everything (zorder 0) with an accent caps label."""
    box(ax, x, y, w, h, fc="white", ec=BORDER, lw=0.8, r=r, z=0)
    if label:
        ax.annotate(label, (x, y + h), xytext=(8, -8), textcoords="offset points", fontsize=8,
                    color=ACCENT, fontweight="bold", va="top")
    if sub:
        ax.annotate(sub, (x, y + h), xytext=(8, -21), textcoords="offset points", fontsize=7.3,
                    color=MUTED, va="top")


def card(ax, x, y, w, h, head, body="", *, fc=FILL, ec=BORDER, lw=0.8, hs=8, bs=6.8, z=3, r=1.4):
    """Box with a bold heading line and a muted body below it, both left-aligned at the top."""
    p = box(ax, x, y, w, h, fc=fc, ec=ec, lw=lw, r=r, z=z)
    ax.annotate(head, (x, y + h), xytext=(6, -6), textcoords="offset points", fontsize=hs,
                fontweight="bold", color=INK, va="top", zorder=z + 1)
    if body:
        ax.annotate(body, (x, y + h), xytext=(6, -6 - hs - 4), textcoords="offset points", fontsize=bs,
                    color=MUTED, va="top", zorder=z + 1, linespacing=1.35)
    return p
