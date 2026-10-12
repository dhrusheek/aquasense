// What the pond can see of the page (spec 09): opaque "pads" (cards, trays, sidebar, top bar) that
// hide anything under them, and "text rects" (copy on the bare ground) that the fish and the glints
// must never cross. Sampled from the DOM twice a second; the geometry helpers below are pure.

export interface Rect { x: number; y: number; w: number; h: number }

/** Viewport size and character-cell metrics, plus the clock in seconds. */
export interface Ctx { w: number; h: number; cellW: number; cellH: number; now: number }

export interface Obstacles { pads: Rect[]; text: Rect[] }

export const PAD_SEL = '.surface-card, .surface-tray, [data-slot=sidebar-container], header[data-slot=top-bar], [data-sonner-toaster] li';
const TEXT_SEL = '[data-slot=view-header], #view-title, p, h1, h2, h3, li';
const MAX_TEXT = 200;

function toRect(el: Element, vw: number, vh: number): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The box of the glyphs in `el` (not of the block that holds them), with a 4 px margin. */
function textRect(el: Element, vw: number, vh: number): Rect | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return null;
  const m = 4;
  return { x: r.left - m, y: r.top - m, w: r.width + 2 * m, h: r.height + 2 * m };
}

/** Viewport rects of the pads and of the text sitting on bare ground. */
export function sampleObstacles(): Obstacles {
  const vw = window.innerWidth, vh = window.innerHeight;
  const pads: Rect[] = [];
  const text: Rect[] = [];
  document.querySelectorAll(PAD_SEL).forEach((el) => {
    const r = toRect(el, vw, vh);
    if (r) pads.push(r);
  });
  for (const el of document.querySelectorAll(TEXT_SEL)) {
    if (text.length >= MAX_TEXT) break;
    if (el.closest(PAD_SEL)) continue;
    const r = textRect(el, vw, vh);
    if (r) text.push(r);
  }
  return { pads, text };
}

/** True when the box (x, y, w, h), shrunk by `inset` on every side, overlaps any rect. */
export function hitsRects(x: number, y: number, w: number, h: number, rects: Rect[], inset = 0): boolean {
  for (const r of rects) {
    if (x + inset < r.x + r.w && x + w - inset > r.x && y + inset < r.y + r.h && y + h - inset > r.y) return true;
  }
  return false;
}

export function pointIn(px: number, py: number, rects: Rect[]): boolean {
  for (const r of rects) if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return true;
  return false;
}

/** Fraction of the box (x, y, w, h) not covered by any rect, by a 12 x 6 grid of sample points. */
export function visibleFrac(x: number, y: number, w: number, h: number, rects: Rect[]): number {
  const nx = 12, ny = 6;
  let free = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!pointIn(x + ((i + 0.5) * w) / nx, y + ((j + 0.5) * h) / ny, rects)) free++;
    }
  }
  return free / (nx * ny);
}
