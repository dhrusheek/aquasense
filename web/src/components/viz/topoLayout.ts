// Geometry and label placement for the topology map. Pure functions, no React.
//
// `topoGeom` is the legacy mapping (app.js 436-446): uniform scale, centred, y up.
// `layoutTopology` then places every knockout box (the one-line node labels, link labels, an
// optional caption, the scale bar) so that none sits on a glyph, on another box or across a link it
// does not belong to. Mono text is 0.6 em per character, so every box size is known without measuring.
import { NODE_ORDER, type NodeId } from './patterns';

export type XY = [number, number];

export interface Rect { x: number; y: number; w: number; h: number }
export interface Seg { x1: number; y1: number; x2: number; y2: number }

export interface TopoGeom {
  /** Node positions in cm. */
  P: Record<NodeId, XY>;
  /** cm → px (y up). */
  m: (p: readonly number[]) => XY;
  /** px per cm. */
  s: number;
  minX: number; minY: number; maxX: number; maxY: number;
}

/** Map the node positions (cm) into a W × H box with `pad` px around them. `padY` defaults to `pad`. */
export function topoGeom(
  P: Record<NodeId, XY>, W: number, H: number, pad: number, marginCm: number = 0, padY: number = pad,
): TopoGeom {
  const xs: number[] = [], ys: number[] = [];
  NODE_ORDER.forEach((id) => { xs.push(P[id][0]); ys.push(P[id][1]); });
  const minX = Math.min(...xs) - marginCm, maxX = Math.max(...xs) + marginCm;
  const minY = Math.min(...ys) - marginCm, maxY = Math.max(...ys) + marginCm;
  const sx = (W - 2 * pad) / Math.max(1, maxX - minX), sy = (H - 2 * padY) / Math.max(1, maxY - minY);
  const s = Math.max(0.01, Math.min(sx, sy));
  const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
  const m = (p: readonly number[]): XY => [ox + (p[0] - minX) * s, H - (oy + (p[1] - minY) * s)];
  return { P, m, s, minX, minY, maxX, maxY };
}

/* ---------- box metrics ---------- */

const CHAR = 0.6; // Geist Mono advance, em
export const PAD_X = 9, PAD_Y = 4;
const EDGE = 4;

export function textWidth(chars: number, fs: number): number {
  return CHAR * fs * chars;
}
/** Width of a knockout box holding `chars` mono characters at `fs` px. */
export function boxWidth(chars: number, fs: number): number {
  return Math.ceil(textWidth(chars, fs)) + PAD_X * 2;
}
/** Height of a knockout box holding `lines` lines at `fs` px (line height fs + 4). */
export function boxHeight(lines: number, fs: number): number {
  return lines * (fs + 4) + PAD_Y * 2;
}

/* ---------- intersection tests ---------- */

function hit(a: Rect, b: Rect, gap: number = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Liang–Barsky: does the segment pass through the rectangle (grown by `gap`)? */
function segHit(s: Seg, r: Rect, gap: number = 0): boolean {
  const x0 = r.x - gap, y0 = r.y - gap, x1 = r.x + r.w + gap, y1 = r.y + r.h + gap;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [s.x1 - x0, x1 - s.x1, s.y1 - y0, y1 - s.y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return t0 <= t1;
}

function clampRect(r: Rect, W: number, H: number, top: number, bottom: number): number {
  const x = Math.min(Math.max(r.x, EDGE), Math.max(EDGE, W - EDGE - r.w));
  const y = Math.min(Math.max(r.y, top), Math.max(top, H - bottom - r.h));
  const moved = Math.abs(x - r.x) + Math.abs(y - r.y);
  r.x = x; r.y = y;
  return moved;
}

/* ---------- layout ---------- */

export interface NodeLabelText {
  /** "N1". */
  id: string;
  /** "Sensor · Temp alert". Kept for callers; the map label no longer prints it (hover card does). */
  role?: string;
  /** "28.89 °C"; N4: "Green". */
  reading: string;
  /** Appends " · inactive" to the label. */
  inactive?: boolean;
}

export interface LinkInput {
  a: number; b: number;
  /** Text of the label box; null for no label. */
  label: string | null;
  /** A failed link: its label is placed before the others. */
  down?: boolean;
  /** N1–N4: the label sits a quarter of the way from N1, to the right. */
  oor: boolean;
}

export interface TopoLayoutInput {
  width: number;
  height: number;
  compact: boolean;
  positions: Record<NodeId, XY>;
  labels: Record<NodeId, NodeLabelText>;
  links: LinkInput[];
  /** Top-left caption text; null for none. */
  captionLeft: string | null;
  /** Top-right caption, longest wording first; the first that fits is used. */
  captionRight: string[];
  scaleBar: boolean;
}

export interface NodeLabel {
  box: Rect;
  /** One line: `id` (weight 600), " · ", then `text` ("28.89 °C", "Green", "28.89 °C · inactive"). */
  id: string;
  text: string;
}

export interface LinkLayout {
  a: number; b: number;
  A: XY; B: XY;
  label: { box: Rect; text: string } | null;
}

export interface TopoLayout {
  geom: TopoGeom;
  /** Glyph side, label font size, glyph-to-label distance. */
  n: number; fs: number; hx: number;
  centre: Record<NodeId, XY>;
  nodeLabels: Record<NodeId, NodeLabel>;
  links: LinkLayout[];
  captionLeft: { box: Rect; text: string } | null;
  captionRight: { box: Rect; text: string } | null;
  /** 30 cm scale bar: the line from (x, y) to (x + len, y), label centred above it. */
  scale: { x: number; y: number; len: number } | null;
}

type Place =
  | 'above' | 'above-l' | 'above-r' | 'above-edge'
  | 'below' | 'below-l' | 'below-r' | 'below-edge'
  | 'right' | 'right-up' | 'right-down'
  | 'left' | 'left-up' | 'left-down';

/** Spec placement first (N4 above, N1 right, N2 below from cx − 14, N3 below to cx + 14), then fallbacks. */
const PREFERENCE: Record<NodeId, Place[]> = {
  N1: ['right', 'right-up', 'right-down', 'left', 'left-up', 'left-down', 'above', 'below', 'above-l', 'below-l'],
  N2: ['below-l', 'below', 'below-edge', 'below-r', 'left', 'left-down', 'above-l', 'right-down', 'above', 'above-edge'],
  N3: ['below-r', 'below', 'below-edge', 'below-l', 'right', 'right-down', 'above-r', 'left-down', 'above', 'above-edge'],
  N4: ['above', 'above-l', 'above-r', 'above-edge', 'right-up', 'left-up', 'right', 'left', 'below', 'below-edge'],
};

function place(p: Place, cx: number, cy: number, w: number, h: number, hx: number, W: number): Rect {
  const edgeX = cx < W / 2 ? EDGE : W - EDGE - w;
  switch (p) {
    case 'above': return { x: cx - w / 2, y: cy - hx - h, w, h };
    case 'above-l': return { x: cx - 14, y: cy - hx - h, w, h };
    case 'above-r': return { x: cx + 14 - w, y: cy - hx - h, w, h };
    case 'above-edge': return { x: edgeX, y: cy - hx - h, w, h };
    case 'below': return { x: cx - w / 2, y: cy + hx, w, h };
    case 'below-l': return { x: cx - 14, y: cy + hx, w, h };
    case 'below-r': return { x: cx + 14 - w, y: cy + hx, w, h };
    case 'below-edge': return { x: edgeX, y: cy + hx, w, h };
    case 'right': return { x: cx + hx, y: cy - h / 2, w, h };
    case 'right-up': return { x: cx + hx, y: cy - 4 - h, w, h };
    case 'right-down': return { x: cx + hx, y: cy + 4, w, h };
    case 'left': return { x: cx - hx - w, y: cy - h / 2, w, h };
    case 'left-up': return { x: cx - hx - w, y: cy - 4 - h, w, h };
    case 'left-down': return { x: cx - hx - w, y: cy + 4, w, h };
  }
}

const BOX_HIT = 1000, SEG_HIT = 40;
/** What a node label pays for sitting where the scale bar goes: less than crossing a link. */
const SCALE_HIT = 30;
/** " · " between the id and the reading. */
const SEP = 3;

/**
 * Place everything on the map. Every node label is one line, `N1 · 28.89 °C`; role and status live
 * in the hover card.
 */
export function layoutTopology(input: TopoLayoutInput): TopoLayout {
  const { width: W, height: H, compact, positions, labels } = input;
  // Glyph 36 (28 compact: spec 06 asks 32 / 26, but the nodes must be the first thing the eye finds on the map); `hx` clears the glyph and a little of its halo before a label box starts.
  const n = compact ? 30 : 42, fs = compact ? 12 : 13, hx = n / 2 + 8;
  const pad = compact ? 40 : 56;
  const labelH = boxHeight(1, fs);
  // Room for a label box above the top node and below the bottom one.
  const padY = Math.max(pad, n / 2 + 8 + labelH + EDGE);
  const geom = topoGeom(positions, W, H, pad, 0, padY);

  const centre = {} as Record<NodeId, XY>;
  NODE_ORDER.forEach((id) => { centre[id] = geom.m(positions[id]); });
  // The halo is faint and a label may sit over its edge; the glyph itself (plus its rim) must stay clear.
  const glyphs: Rect[] = NODE_ORDER.map((id) => ({ x: centre[id][0] - n / 2 - 2, y: centre[id][1] - n / 2 - 2, w: n + 4, h: n + 4 }));
  const segs: Seg[] = input.links.map((l) => {
    const A = centre[('N' + l.a) as NodeId], B = centre[('N' + l.b) as NodeId];
    return { x1: A[0], y1: A[1], x2: B[0], y2: B[1] };
  });

  // A caption is drawn on a full-size stage only; a compact one keeps the map clear.
  const capFs = 12, capH = boxHeight(1, capFs);
  const captionLeft = input.captionLeft && !compact
    ? { box: { x: 8, y: 8, w: boxWidth(input.captionLeft.length, capFs), h: capH }, text: input.captionLeft }
    : null;

  // The 30 cm scale bar belongs bottom-right. Its box is worked out first so that a node label
  // (N3's, usually) steps aside when it cheaply can; if none can, the bar takes another spot below.
  const scaleLen = 30 * geom.s, scaleW = Math.max(scaleLen, textWidth(5, 12)) + 8, scaleH = 22;
  const scaleBox = (x: number, y: number): Rect => ({ x: x - (scaleW - scaleLen) / 2, y: y - 17, w: scaleW, h: scaleH });
  const scaleSpots: XY[] = [
    [W - 12 - scaleLen, H - 8],
    [12, H - 8],
    [W - 12 - scaleLen, H / 2],
    [12, H / 2],
    [W - 12 - scaleLen, 48],
  ];
  const scaleHome = input.scaleBar ? scaleBox(scaleSpots[0][0], scaleSpots[0][1]) : null;

  /* node labels: joint search over every combination of candidate places */
  const texts: string[] = NODE_ORDER.map((id) => labels[id].reading + (labels[id].inactive ? ' · inactive' : ''));
  const cands: { box: Rect; cost: number }[][] = NODE_ORDER.map((id, k) => {
    const [cx, cy] = centre[id];
    const w = boxWidth(labels[id].id.length + SEP + texts[k].length, fs);
    return PREFERENCE[id].map((p, idx) => {
      const box = place(p, cx, cy, w, labelH, hx, W);
      let cost = idx * 2 + clampRect(box, W, H, EDGE, EDGE) * 0.5;
      for (const g of glyphs) if (hit(box, g, 1)) cost += BOX_HIT;
      if (captionLeft && hit(box, captionLeft.box, 4)) cost += BOX_HIT;
      if (scaleHome && hit(box, scaleHome, 4)) cost += SCALE_HIT;
      for (const sg of segs) if (segHit(sg, box, 1)) cost += SEG_HIT;
      return { box, cost };
    });
  });
  let best = Infinity;
  const pick = [0, 0, 0, 0];
  const cur = [0, 0, 0, 0];
  const search = (k: number, acc: number): void => {
    if (acc >= best) return;
    if (k === 4) { best = acc; for (let i = 0; i < 4; i++) pick[i] = cur[i]; return; }
    for (let c = 0; c < cands[k].length; c++) {
      let cost = acc + cands[k][c].cost;
      for (let j = 0; j < k && cost < best; j++) if (hit(cands[k][c].box, cands[j][cur[j]].box, 4)) cost += BOX_HIT;
      cur[k] = c;
      search(k + 1, cost);
    }
  };
  search(0, 0);

  const nodeLabels = {} as Record<NodeId, NodeLabel>;
  const boxes: Rect[] = [];
  NODE_ORDER.forEach((id, k) => {
    const c = cands[k][pick[k]];
    nodeLabels[id] = { box: c.box, id: labels[id].id, text: texts[k] };
    boxes.push(c.box);
  });

  /* top-right caption: the longest wording that clears the node labels */
  let captionRight: TopoLayout['captionRight'] = null;
  if (!compact) {
    for (const text of input.captionRight) {
      const w = boxWidth(text.length, capFs);
      const box = { x: W - 8 - w, y: 8, w, h: capH };
      if (box.x < (captionLeft ? captionLeft.box.x + captionLeft.box.w + 8 : 8)) continue;
      if (boxes.some((b) => hit(box, b, 4)) || glyphs.some((g) => hit(box, g, 2))) continue;
      captionRight = { box, text };
      break;
    }
  }
  const fixed: Rect[] = [];
  if (captionLeft) fixed.push(captionLeft.box);
  if (captionRight) fixed.push(captionRight.box);

  /* scale bar: bottom-right by default, else the first free corner or side */
  let scale: TopoLayout['scale'] = null;
  if (input.scaleBar) {
    let bestCost = BOX_HIT, bestSpot: XY | null = null;
    for (let idx = 0; idx < scaleSpots.length; idx++) {
      const [x, y] = scaleSpots[idx];
      const r = scaleBox(x, y);
      if (r.x < 2 || r.x + r.w > W - 2 || r.y < 2) continue;
      let cost = idx;
      if (boxes.some((b) => hit(r, b, 4)) || glyphs.some((g) => hit(r, g, 2)) || fixed.some((b) => hit(r, b, 4))) cost += BOX_HIT;
      for (const sg of segs) if (segHit(sg, r, 2)) cost += SEG_HIT;
      if (cost < bestCost) { bestCost = cost; bestSpot = [x, y]; }
    }
    if (bestSpot) {
      scale = { x: bestSpot[0], y: bestSpot[1], len: scaleLen };
      fixed.push(scaleBox(bestSpot[0], bestSpot[1]));
    }
  }

  /* link labels: down links first (they matter most), then the rest in ALL_PAIRS order */
  const cen: XY = [0, 0];
  NODE_ORDER.forEach((id) => { cen[0] += centre[id][0] / 4; cen[1] += centre[id][1] / 4; });
  const lfs = 12, lh = boxHeight(1, lfs);
  const linkBoxes: (Rect | null)[] = input.links.map(() => null);
  const order = input.links.map((_, i) => i).sort((i, j) => {
    const di = input.links[i].down ? 0 : 1, dj = input.links[j].down ? 0 : 1;
    return di - dj || i - j;
  });
  const placed: Rect[] = [];
  for (const i of order) {
    const l = input.links[i];
    if (!l.label) continue;
    const s = segs[i];
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy) || 1;
    const w = boxWidth(l.label.length, lfs);
    let nx = -dy / len, ny = dx / len;
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    if (nx * (mx - cen[0]) + ny * (my - cen[1]) < 0) { nx = -nx; ny = -ny; } // outward: away from the centroid
    const ts = l.oor ? [0.25, 0.4, 0.55, 0.7] : [0.5, 0.4, 0.6, 0.3, 0.7];
    const sides: XY[] = l.oor ? [[1, 0], [-1, 0]] : [[nx, ny], [-nx, -ny]];
    let bestCost = BOX_HIT, bestBox: Rect | null = null;
    let idx = 0;
    for (const side of sides) {
      for (const t of ts) {
        // Clear the line (and the 3 px route drawn on it) by 10 px along the normal, whatever
        // the box's orientation to it.
        const off = 10 + Math.abs(side[0]) * w / 2 + Math.abs(side[1]) * lh / 2;
        const cx = s.x1 + dx * t + side[0] * off, cy = s.y1 + dy * t + side[1] * off;
        const box = { x: cx - w / 2, y: cy - lh / 2, w, h: lh };
        let cost = idx++;
        if (box.x < EDGE || box.y < EDGE || box.x + w > W - EDGE || box.y + lh > H - EDGE) cost += BOX_HIT;
        if (boxes.some((b) => hit(box, b, 3)) || glyphs.some((g) => hit(box, g, 3))) cost += BOX_HIT;
        if (fixed.some((b) => hit(box, b, 3)) || placed.some((b) => hit(box, b, 3))) cost += BOX_HIT;
        for (let j = 0; j < segs.length; j++) if (segHit(segs[j], box, 5)) cost += j === i ? BOX_HIT : SEG_HIT;
        if (cost < bestCost) { bestCost = cost; bestBox = box; }
      }
    }
    if (bestBox) { linkBoxes[i] = bestBox; placed.push(bestBox); }
  }

  const links: LinkLayout[] = input.links.map((l, i) => ({
    a: l.a, b: l.b,
    A: [segs[i].x1, segs[i].y1], B: [segs[i].x2, segs[i].y2],
    label: linkBoxes[i] && l.label ? { box: linkBoxes[i] as Rect, text: l.label } : null,
  }));

  return { geom, n, fs, hx, centre, nodeLabels, links, captionLeft, captionRight, scale };
}

/** One hop of a route, from the centre of node `a` to the centre of node `b`. */
export interface RouteSegment {
  a: NodeId; b: NodeId;
  A: XY; B: XY;
  /** `M x y L x y`. */
  d: string;
}

function pt(p: XY): string {
  return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
}

/** A route as its hop segments, in travel order. Each one is drawn with its own gradient. */
export function routeSegments(hops: number[], centre: Record<NodeId, XY>): RouteSegment[] {
  const out: RouteSegment[] = [];
  for (let i = 0; i + 1 < hops.length; i++) {
    const a = ('N' + hops[i]) as NodeId, b = ('N' + hops[i + 1]) as NodeId;
    const A = centre[a], B = centre[b];
    if (!A || !B || a === b) continue;
    out.push({ a, b, A, B, d: `M${pt(A)} L${pt(B)}` });
  }
  return out;
}

/**
 * Route polyline through the hop positions: the track a packet moves along. `idx` is accepted for
 * the callers of the first pass, when overlapping routes were offset; segments are now shared and
 * drawn once, so every route runs on the link line itself.
 */
export function routePath(hops: number[], centre: Record<NodeId, XY>, idx: number = 0): string {
  void idx;
  return 'M' + hops.map((h) => pt(centre[('N' + h) as NodeId])).join(' L');
}

/* ---------- backdrop ---------- */

/** The pool's outline radius at angle `t` (radians), relative to 1: an irregular shore, not an ellipse. */
export function shoreScale(t: number): number {
  return 1 + 0.06 * Math.sin(2 * t + 0.6) + 0.035 * Math.sin(3 * t + 2.1) + 0.02 * Math.sin(5 * t + 4);
}

export interface PoolGeom {
  cx: number; cy: number; rx: number; ry: number;
}

/** The pool sits on the centroid of the four nodes and spans 92 % of the stage width, 88 % of its height. */
export function poolGeom(centre: Record<NodeId, XY>, W: number, H: number): PoolGeom {
  let cx = 0, cy = 0;
  NODE_ORDER.forEach((id) => { cx += centre[id][0] / 4; cy += centre[id][1] / 4; });
  return { cx, cy, rx: 0.46 * W, ry: 0.44 * H };
}

/** A closed outline of the pool shore scaled by `k` (1 = the pool, 0.72 / 0.46 = contour lines). */
export function poolOutline(g: PoolGeom, k: number, steps: number = 96): string {
  let d = '';
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, r = shoreScale(t) * k;
    d += (i ? 'L' : 'M') + (g.cx + Math.cos(t) * g.rx * r).toFixed(1) + ' ' + (g.cy + Math.sin(t) * g.ry * r).toFixed(1);
  }
  return d + 'Z';
}

/**
 * The halftone shore: a staggered grid of dots around the pool whose radius falls from 2.6 px at the
 * water's edge to nothing 60 % of the pool radius further out, one path of circles (spec 06 §2.3 d).
 */
export function shoreDots(g: PoolGeom, W: number, H: number, pitch: number = 8): string {
  let d = '';
  const rowH = pitch * 0.866;
  for (let row = 0, y = 0; y <= H; row++, y = row * rowH) {
    const off = row % 2 ? pitch / 2 : 0;
    for (let x = off; x <= W; x += pitch) {
      const dx = (x - g.cx) / g.rx, dy = (y - g.cy) / g.ry;
      const e = Math.hypot(dx, dy) / shoreScale(Math.atan2(dy, dx));
      if (e < 0.94 || e > 1.6) continue;
      const t = (e - 0.94) / 0.66;
      const r = Math.round(2.7 * Math.pow(1 - t, 1.5) * (0.88 + 0.12 * Math.sin(x * 0.31 + y * 0.17)) * 4) / 4;
      if (r < 0.5) continue;
      d += `M${(x - r).toFixed(1)} ${y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
  }
  return d;
}
