// Preparing derived.series for the charts, ported from updateLine + seriesLabels (app.js 329-364):
// samples become numbers, every series of a chart is right-aligned to the longest one, and the
// sample times are the matching tail of series.t.
import { arr, num } from '@/lib/safe';

export type Sample = number | null;
export type SampleTime = number | string | null;

/** One raw series as numbers (null = no sample), optionally mapped (°C × 100 → °C, PDR → loss). */
export function column(raw: unknown, map?: (n: number) => number | null): Sample[] {
  return arr<unknown>(raw).map((v) => {
    const n = num(v);
    return n === null ? null : map ? map(n) : n;
  });
}

function padFront<T>(a: T[], n: number, fill: T): T[] {
  return a.length >= n ? a : new Array<T>(n - a.length).fill(fill).concat(a);
}

/**
 * Align the series of one chart: shorter series are padded at the front, `t` is cut to the same
 * number of newest samples, and at most `max` samples (the server's window) are kept.
 */
export function alignSeries(t: unknown, cols: Sample[][], max: number = 120): { t: SampleTime[]; cols: Sample[][] } {
  const n = cols.reduce((m, a) => Math.max(m, a.length), 0);
  const all = arr<unknown>(t);
  const times = all
    .slice(Math.max(0, all.length - n))
    .map((x): SampleTime => (typeof x === 'number' || typeof x === 'string' ? x : null));
  const keep = Math.min(n, max);
  return {
    t: padFront(times, n, null).slice(n - keep),
    cols: cols.map((a) => padFront(a, n, null).slice(n - keep)),
  };
}

/** Smallest and largest sample over several series; null when there is none. */
export function extent(cols: Sample[][]): { lo: number; hi: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (const a of cols) for (const v of a) {
    if (v === null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? { lo, hi } : null;
}
