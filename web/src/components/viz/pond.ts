// The pond field as plain code: the density mapping, the dither grid and a small canvas engine.
// No React in here; PondField.tsx owns the element and feeds this.

/** 4 × 4 Bayer matrix for the ordered dither. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TWO_PI = Math.PI * 2;
const TWEEN_MS = 900;
/** Density of the flat grid shown when N2 has nothing to say. */
export const UNKNOWN_DENSITY = 0.08;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Raw ADC → dither density. The reading falls as the water gets murkier: 2900 is clear (0.10),
 * 300 is opaque (0.92). Mock 2604 → 0.19; 1424 → 0.57; 800 → 0.76.
 */
export function turbidityDensity(turbidity: number): number {
  const t = clamp01((2900 - turbidity) / 2600);
  return 0.10 + 0.82 * t;
}

/** Density of the field for a reading; `unknown` is the flat sparse grid. */
export function pondDensity(turbidity: number | null, n2Active: boolean): { d: number; unknown: boolean } {
  if (turbidity === null || !Number.isFinite(turbidity) || !n2Active) return { d: UNKNOWN_DENSITY, unknown: true };
  return { d: turbidityDensity(turbidity), unknown: false };
}

interface Grid {
  cols: number;
  rows: number;
  /** Dot side in CSS px, snapped to whole device pixels. */
  dot: number;
  /** Left edge of each column's dot / top edge of each row's dot, snapped to whole device pixels. */
  xs: Float32Array;
  ys: Float32Array;
  /** Static shape S(i, j): an oval body, deeper in the middle, with gentle banding. 1 everywhere when unknown. */
  shape: Float32Array;
  /** Dither threshold T(i, j). */
  thr: Float32Array;
}

/**
 * Cell pitch 6 CSS px (8 when that would exceed 40 000 cells); an "on" cell is a square of
 * pitch − 2 centred in it. Everything a frame needs is computed here, once per resize.
 */
function buildGrid(width: number, height: number, dpr: number, unknown: boolean): Grid {
  let C = 6;
  if (Math.ceil(width / C) * Math.ceil(height / C) > 40000) C = 8;
  const cols = Math.ceil(width / C), rows = Math.ceil(height / C);
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const xs = new Float32Array(cols), ys = new Float32Array(rows);
  for (let i = 0; i < cols; i++) xs[i] = snap(i * C + 1);
  for (let j = 0; j < rows; j++) ys[j] = snap(j * C + 1);
  const shape = new Float32Array(cols * rows), thr = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const v = (j + 0.5) / rows;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      thr[k] = (BAYER[(j & 3) * 4 + (i & 3)] + 0.5) / 16;
      if (unknown) { shape[k] = 1; continue; }
      const u = (i + 0.5) / cols;
      const r = Math.hypot((u - 0.5) / 0.60, (v - 0.5) / 0.55);
      const depth = smoothstep(1.05, 0.25, r); // 1 at the centre → 0 past the shore
      const n = 0.5 + 0.25 * Math.sin(TWO_PI * (1.7 * u + 0.9 * v) + 0.4) + 0.25 * Math.sin(TWO_PI * (0.8 * u - 1.9 * v) + 2.1);
      shape[k] = (0.15 + 0.85 * depth) * (0.75 + 0.5 * n);
    }
  }
  return { cols, rows, dot: Math.max(1 / dpr, snap(C - 2)), xs, ys, shape, thr };
}

export interface PondEngine {
  /** (Re)allocate the backing store and the grid, then paint at the current density. */
  resize(canvas: HTMLCanvasElement, width: number, height: number, dpr: number, unknown: boolean): void;
  /** New colours (theme change): one repaint. */
  setColours(card: string, graphite: string): void;
  /** Move to a density: tween over 900 ms, or jump when `animate` is false. */
  setTarget(d: number, animate: boolean): void;
  /** End a running tween at its target (hidden tab, off screen, reduced motion). */
  settle(): void;
  dispose(): void;
}

/**
 * The canvas loop. Idle costs nothing: a frame is requested only while the density is tweening, and
 * a frame is one fill of the background plus one fillRect per "on" cell, with no allocation.
 */
export function createPondEngine(initial: number): PondEngine {
  let grid: Grid | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let w = 0, h = 0;
  let card = 'canvas', graphite = 'graytext';
  let dCurrent = initial, dFrom = initial, dTarget = initial;
  let t0 = 0, raf = 0;

  function draw(d: number): void {
    const g = grid, c = ctx;
    if (!g || !c) return;
    c.fillStyle = card;
    c.fillRect(0, 0, w, h);
    c.fillStyle = graphite; // graphite, not ink: the topology drawn on top stays dominant
    const { cols, rows, xs, ys, shape, thr, dot } = g;
    for (let j = 0, k = 0; j < rows; j++) {
      const y = ys[j];
      for (let i = 0; i < cols; i++, k++) {
        // F = D · S clamped to [0, 1]; thresholds are below 1, so the clamp never changes the test
        if (d * shape[k] > thr[k]) c.fillRect(xs[i], y, dot, dot);
      }
    }
  }

  function frame(now: number): void {
    raf = 0;
    const t = Math.max(0, Math.min(1, (now - t0) / TWEEN_MS));
    dCurrent = dFrom + (dTarget - dFrom) * easeInOutCubic(t);
    draw(dCurrent); // re-quantising the whole field at the interpolated density is the effect
    if (t < 1) raf = requestAnimationFrame(frame);
    else dCurrent = dTarget;
  }

  function settle(): void {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (dCurrent === dTarget) return;
    dCurrent = dTarget;
    draw(dCurrent);
  }

  return {
    resize(canvas, width, height, dpr, unknown) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const c = canvas.getContext('2d', { alpha: false });
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0); // all drawing is in CSS px
      ctx = c;
      w = width;
      h = height;
      grid = buildGrid(width, height, dpr, unknown);
      draw(dCurrent); // a running tween carries on over the new grid
    },
    setColours(c, g) {
      if (c === card && g === graphite) return;
      card = c;
      graphite = g;
      draw(dCurrent);
    },
    setTarget(d, animate) {
      dTarget = d;
      if (!animate) { settle(); return; }
      if (d === dCurrent) return;
      dFrom = dCurrent;
      t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    settle,
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
