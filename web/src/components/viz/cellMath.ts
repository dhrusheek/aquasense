// Arithmetic of the quantised cell charts: scales, quantisation, windowing, labels and cell paths.
// Pure functions, shared by CellChart and CellSpark.

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Smallest of {1, 2, 5} × 10ⁿ that is ≥ v; never below 1. */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
}

/** Largest of {1, 2, 5} × 10ⁿ that is ≤ v; 0 for anything below 1. */
export function niceFloor(v: number): number {
  if (!Number.isFinite(v) || v < 1) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [5, 2, 1]) if (m * p <= v + 1e-9) return m * p;
  return p;
}

/**
 * Value → number of filled cells out of `rows`. Any value above `min` shows at least one cell, so a
 * small non-zero reading never looks like zero. Null stays null (drawn as a tick).
 */
export function quantise(v: number | null, min: number, max: number, rows: number): number | null {
  if (v === null) return null;
  const range = max - min || 1;
  return clamp(Math.round(((v - min) / range) * rows), v > min ? 1 : 0, rows);
}

/** Finite number or null: charts treat undefined, NaN and non-numbers as "no sample". */
export function sample(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Largest finite value, or null when there is none. */
export function maxOf(values: readonly (number | null)[]): number | null {
  let m: number | null = null;
  for (const v of values) if (v !== null && (m === null || v > m)) m = v;
  return m;
}

/** Last non-null value, or null. */
export function lastOf(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

export interface Window {
  /** Index into the source arrays of the first and one-past-last sample of each shown column. */
  from: number[];
  to: number[];
  /** Number of shown columns (≤ columns). */
  shown: number;
  /** True when samples were averaged into buckets. */
  bucketed: boolean;
}

/**
 * Fit `n` samples into `columns`. `tail` keeps the newest `columns` samples one to one;
 * `bucket` spreads all of them over the columns.
 */
export function windowOf(n: number, columns: number, fit: 'tail' | 'bucket'): Window {
  const from: number[] = [], to: number[] = [];
  if (n <= columns || fit === 'tail') {
    const start = Math.max(0, n - columns);
    for (let i = start; i < n; i++) { from.push(i); to.push(i + 1); }
    return { from, to, shown: n - start, bucketed: false };
  }
  for (let k = 0; k < columns; k++) {
    from.push(Math.floor((k * n) / columns));
    to.push(Math.floor(((k + 1) * n) / columns));
  }
  return { from, to, shown: columns, bucketed: true };
}

/** One series through a window: the mean of each bucket, or its last value for a stepped series. */
export function applyWindow(values: readonly (number | null)[], w: Window, stepped: boolean): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = 0; k < w.shown; k++) {
    const a = w.from[k], b = w.to[k];
    if (b - a === 1) { out.push(a < values.length ? values[a] : null); continue; }
    let sum = 0, cnt = 0, last: number | null = null;
    for (let i = a; i < b && i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      sum += v; cnt++; last = v;
    }
    out.push(cnt === 0 ? null : stepped ? last : sum / cnt);
  }
  return out;
}

const MINUS = '−';

/**
 * Sample time → label relative to the newest sample: "−300 s", …, "now" (app.js 329-348).
 * Times are network ms; epoch seconds are detected and scaled. A non-numeric time is shown as is.
 */
export function relLabel(t: unknown, last: unknown): string {
  if (t == null) return '';
  const v = typeof t === 'number' ? t : Number(t), l = typeof last === 'number' ? last : Number(last);
  if (typeof t === 'string' && !Number.isFinite(v)) return t;
  if (!Number.isFinite(v) || !Number.isFinite(l)) return '';
  const scale = l > 1e9 && l < 1e11 ? 1000 : 1;
  const rel = Math.round(((v - l) * scale) / 1000);
  return rel === 0 ? 'now' : (rel < 0 ? MINUS : '+') + Math.abs(rel) + ' s';
}

/** Axis tick text that fits the 36 px gutter: at most five characters. */
export function tickText(v: number, integer: boolean = false): string {
  const a = Math.abs(v);
  if (a >= 10000) {
    const k = v / 1000;
    return (Number.isInteger(k) ? String(k) : k.toFixed(1)) + 'k';
  }
  if (integer || Number.isInteger(v) || a >= 100) return Math.round(v).toLocaleString('en-US');
  return v.toFixed(a < 10 ? (Number.isInteger(v * 10) ? 1 : 2) : 1);
}

/* ---------- cell paths ---------- */

// Cells are drawn in an 8-unit pitch (the size of the 8 px pattern tile), then scaled to the real
// pitch. A cell is inset by half the gap, so a 6 px cell in an 8 px pitch covers units 1..7: the
// N2 checker shows as a 2 × 2 of 3 px squares and the N3 dot as a centred 4 px dot, both whole.
const pathCache = new Map<string, string>();

/**
 * Path of the cells in rows [q0, q1) of one column, row 0 at the bottom of a `rows`-high band.
 * `size` is the cell side in pitch units (6 for the default 6/2), `inset` shrinks it (outline cells).
 */
export function columnPath(rows: number, q0: number, q1: number, size: number = 6, inset: number = 0): string {
  if (q1 <= q0) return '';
  const key = `c${rows}:${q0}:${q1}:${size}:${inset}`;
  let d = pathCache.get(key);
  if (d === undefined) {
    const off = (8 - size) / 2 + inset, s = size - inset * 2;
    d = '';
    for (let r = q0; r < q1; r++) d += `M${off} ${(rows - 1 - r) * 8 + off}h${s}v${s}h${-s}z`;
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(key, d);
  }
  return d;
}

/** Path of cells [c0, c1) of one horizontal bar (a single row of cells). */
export function rowPath(c0: number, c1: number, size: number = 6, inset: number = 0): string {
  if (c1 <= c0) return '';
  const key = `r${c0}:${c1}:${size}:${inset}`;
  let d = pathCache.get(key);
  if (d === undefined) {
    const off = (8 - size) / 2 + inset, s = size - inset * 2;
    d = '';
    for (let c = c0; c < c1; c++) d += `M${c * 8 + off} ${off}h${s}v${s}h${-s}z`;
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(key, d);
  }
  return d;
}
