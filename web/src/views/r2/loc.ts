// Derived data of view r2, ported 1:1 from server/static/app.js 798-900 (bleMatrix, the worked
// distance example, nearest node, distance rows). Pure functions, no React.
import type { FormulaSegment } from '@/components/aq/FormulaBlock';
import { node, nodes } from '@/data/selectors';
import type { Localization, LocTarget, NodeId, Num, State, Str, XY } from '@/data/types';
import { NODE_IDS } from '@/lib/constants';
import { dist, fmt, fmtI } from '@/lib/format';
import { arr, get, nId, num, obj } from '@/lib/safe';

/** One directed BLE measurement: `from` scanned and heard `to`. */
export interface MatrixEntry { from?: Str; to?: Str; rssi?: Num; dist_cm?: Num }
/** `"N<f>>N<t>"` → measurement. */
export type BleMatrix = Record<string, MatrixEntry>;

function isNode(x: string): x is NodeId {
  return x === 'N1' || x === 'N2' || x === 'N3' || x === 'N4';
}

/** localization.* of the state document; `{}` until the sink reports it. */
export function localization(d: State | null | undefined): Localization {
  return obj<Localization>(get<unknown>(d, 'localization', {}));
}

/**
 * Every directed pair the network has measured: localization.matrix first, then each node's own
 * `ble[]` list for the pairs the matrix does not carry (app.js 798-809).
 */
export function bleMatrix(d: State | null | undefined): BleMatrix {
  const out: BleMatrix = {};
  arr<MatrixEntry | null>(get<unknown>(d, 'localization.matrix', [])).forEach((raw) => {
    const e = obj<MatrixEntry>(raw);
    out[nId(e.from) + '>' + nId(e.to)] = e;
  });
  nodes(d).forEach((n) => {
    const f = nId(n?.id);
    arr(n?.ble).forEach((raw) => {
      const b = obj(raw);
      const k = f + '>' + nId(b.id);
      if (!out[k]) out[k] = { from: f, to: nId(b.id), rssi: b.rssi, dist_cm: b.dist_cm };
    });
  });
  return out;
}

/* ---------- path-loss parameters and the formula block ---------- */

export interface PathLoss { rssi1m: number | null; n: number | null }

/** localization.params with the firmware defaults (RSSI at 1 m = -59 dBm, exponent 2.2). */
export function pathLoss(loc: Localization): PathLoss {
  return { rssi1m: num(get<unknown>(loc, 'params.rssi_1m', -59)), n: num(get<unknown>(loc, 'params.n', 2.2)) };
}

/**
 * The distance formula with the live parameters and one worked example (N1→N2, else the first pair
 * heard). The example is left out until that pair has an RSSI.
 */
export function formulaLines(mat: BleMatrix, p: PathLoss): FormulaSegment[] {
  const lines: FormulaSegment[] = [
    'd = 10^((RSSI₁ₘ − RSSI) / (10 · n))',
    '',
    'RSSI₁ₘ = ', { hl: fmt(p.rssi1m, 0, 'dBm') }, '   n = ', { hl: fmt(p.n, 1) },
    '\nresult clamped to 5…1000 cm',
  ];
  const ex: MatrixEntry | undefined = mat['N1>N2'] || mat[Object.keys(mat)[0]];
  const rssi = ex ? num(ex.rssi) : null;
  if (ex && rssi !== null && p.rssi1m !== null && p.n) {
    const dm = Math.pow(10, (p.rssi1m - rssi) / (10 * p.n)); // metres
    lines.push(
      '',
      `example ${nId(ex.from)}→${nId(ex.to)}:  RSSI = ${fmtI(rssi)} dBm`,
      `d = 10^((${fmtI(p.rssi1m)} − (${fmtI(rssi)})) / (10 × ${fmt(p.n, 1)}))`,
      '  = ', { hl: `${fmt(dm * 100, 0)} cm` },
    );
  }
  return lines;
}

/* ---------- targets ---------- */

export function targetId(t: LocTarget | null | undefined): string {
  return nId(t?.id);
}

/** "(x, y)" with `dec` decimals; a missing coordinate is "—". */
export function xyText(p: Num[] | null | undefined, dec: number): string {
  return `(${fmt(get<unknown>(p, '0', null), dec)}, ${fmt(get<unknown>(p, '1', null), dec)})`;
}

/**
 * The target the map shows: the wanted one, else the first reported (app.js 906-909).
 * Only targets that are one of the four nodes can be drawn.
 */
export function pickTarget(targets: LocTarget[], want: string): { target: LocTarget | null; id: NodeId | null } {
  const drawable = targets.filter((t) => isNode(targetId(t)));
  const t = drawable.find((x) => targetId(x) === want) ?? drawable[0] ?? null;
  const id = t ? targetId(t) : null;
  return { target: t, id: id && isNode(id) ? id : null };
}

/* ---------- nearest node ---------- */

export interface NearRow {
  id: NodeId;
  /** Nearest by BLE (highest smoothed RSSI): "N<k>", or null when not reported. */
  ble: string | null;
  /** RSSI text of that pair, "—" when the pair was not measured. */
  rssi: string;
  /** Nearest by the true geometry, and its distance in cm. */
  best: NodeId | null;
  bestCm: number | null;
  match: boolean;
}

export function nearestRows(
  d: State | null | undefined, loc: Localization, P: Record<NodeId, XY>, mat: BleMatrix,
): NearRow[] {
  const near = obj<Partial<Record<NodeId, Str>>>(loc.nearest);
  return NODE_IDS.map((id) => {
    const nb = near[id] || node(d, id).nearest || null;
    const ble = nb ? nId(nb) : null;
    const e = ble ? mat[id + '>' + ble] : undefined;
    let best: NodeId | null = null, bd = Infinity;
    NODE_IDS.forEach((o) => {
      if (o === id) return;
      const dd = dist(P[id], P[o]);
      if (dd !== null && dd < bd) { bd = dd; best = o; }
    });
    return {
      id, ble,
      rssi: e ? fmt(e.rssi, 0, 'dBm') : '—',
      best, bestCm: best === null ? null : bd,
      match: ble !== null && ble === best,
    };
  });
}

/* ---------- distance estimates ---------- */

export interface DistRow {
  key: string;
  from: string;
  to: string;
  rssi: string;
  est: string;
  truth: string;
  diff: string;
}

/** One row per measured pair, sorted by key: estimated distance against the table layout. */
export function distanceRows(mat: BleMatrix, P: Record<NodeId, XY>): DistRow[] {
  return Object.keys(mat).sort().map((key) => {
    const e = mat[key], f = nId(e.from), t = nId(e.to);
    const td = dist(isNode(f) ? P[f] : null, isNode(t) ? P[t] : null), ed = num(e.dist_cm);
    return {
      key, from: f, to: t,
      rssi: fmt(e.rssi, 0, 'dBm'),
      est: fmt(ed, 0, 'cm'),
      truth: fmt(td, 0, 'cm'),
      // A difference that rounds to zero is written "0 cm", never "-0 cm".
      diff: ed !== null && td !== null ? fmt(Math.abs(ed - td) < 0.5 ? 0 : ed - td, 0, 'cm') : '—',
    };
  });
}

/* ---------- RSSI heat ---------- */

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatScale {
  /** Grey level of one RSSI: 0 weakest … 4 strongest. */
  level: (rssi: number) => HeatLevel;
  /** dBm at level 0 and at level 4. */
  lo: number;
  hi: number;
  /** True when the five levels span the pairs actually heard rather than the fixed range. */
  relative: boolean;
}

/** Legacy heat position (app.js 813): -90 dBm → 0, -45 dBm → 1. */
function heatT(rssi: number): number {
  return Math.max(0, Math.min(1, (rssi + 90) / 45));
}

/**
 * Five grey levels for the matrix. The fixed -90…-45 dBm range puts every pair of a table-top
 * network in one level, so the levels are stretched over the pairs heard (weakest → 0,
 * strongest → 4). With fewer than two distinct values the fixed range is used: round(t · 4).
 */
export function heatScale(values: number[]): HeatScale {
  const ts = values.map(heatT);
  const lo = ts.length ? Math.min(...ts) : 0, hi = ts.length ? Math.max(...ts) : 1;
  const q = (x: number): HeatLevel => Math.max(0, Math.min(4, Math.round(x * 4))) as HeatLevel;
  if (ts.length < 2 || hi - lo < 1e-9) return { level: (r) => q(heatT(r)), lo: -90, hi: -45, relative: false };
  return {
    level: (r) => q((heatT(r) - lo) / (hi - lo)),
    lo: lo * 45 - 90, hi: hi * 45 - 90, relative: true,
  };
}
