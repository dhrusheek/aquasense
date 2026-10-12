// ASCII generators and frame tables (spec 05 §2.4). Pure functions of (frame, cols, rows, params):
// no clock, no randomness, no DOM. Brightness comes from character density, colour from the one
// gradient laid over the whole block in ascii.css.
import { DEFAULT_POS } from '@/lib/constants';
import type { AsciiGen, AsciiParams, AsciiParamValue } from './engine';

export type AsciiName =
  | 'ripple' | 'boot' | 'radio' | 'backoff' | 'slots' | 'fanout' | 'fanin' | 'route' | 'bars' | 'steps'
  | 'ticker' | 'grid' | 'pulse' | 'spinner' | 'dots' | 'meter' | 'caret' | 'wave';

export type AsciiInk = 'ramp' | 'surface' | 'accent' | 'mono' | 'glow';

export interface AnimDef {
  /** Default character grid. */
  cols: number;
  rows: number;
  /** Default frame rate. */
  fps: number;
  /** Ink used when <Ascii> is given none (§2.4: motifs ramp, status glyphs glow, dots mono). */
  ink: AsciiInk;
  gen: AsciiGen;
  /** Finite animations: how many frames until it rests. 0 = static for these params. Omit for a loop. */
  frames?: (params: AsciiParams, cols: number, rows: number) => number | undefined;
}

/** Density ramp, darkest to brightest. */
export const RAMP = ' .:-=+*#%@';

/* ---------- helpers ---------- */

function pad(s: string, cols: number): string {
  return s.length >= cols ? s : s + ' '.repeat(cols - s.length);
}
function block(lines: readonly string[], cols: number): string {
  return lines.map((l) => pad(l, cols)).join('\n');
}
function at<T>(xs: readonly T[], frame: number): T {
  return xs[((frame % xs.length) + xs.length) % xs.length];
}
function num(v: AsciiParamValue, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
/** A density 0…1 as one character of the ramp. */
function shade(v: number): string {
  return RAMP[Math.round(clamp01(v) * (RAMP.length - 1))];
}
function putChar(s: string, i: number, ch: string): string {
  return i < 0 || i >= s.length ? s : s.slice(0, i) + ch + s.slice(i + 1);
}

/* ---------- ripple: the landing hero ---------- */

const RIPPLE_FPS = 12;
const RIPPLE_PERIOD_S = 2.6;
const RIPPLE_WAVELENGTH = 2.2;
/** Three drops: position as a fraction of the grid, weight, reach as a fraction of the columns. */
const DROPS = [
  { x: 0.30, y: 0.42, w: 1.0, r: 0.55 },
  { x: 0.72, y: 0.30, w: 0.8, r: 0.45 },
  { x: 0.55, y: 0.78, w: 0.6, r: 0.40 },
] as const;
const NODE_ORDER = ['N1', 'N2', 'N3', 'N4'] as const;
/** Frames with no packet on the map after each delivery at the sink. */
const DELIVERY_REST = 8;

const CODE_NL = 10, CODE_SPACE = 32, CODE_AT = 64, CODE_O = 111;
const RAMP_CODES = Array.from(RAMP, (c) => c.charCodeAt(0));

interface RippleGrid {
  /** Σ fall·sin(phase) and Σ fall·cos(phase) per cell: the three drops share one angular speed, so a
   *  frame is `a·cos(ωt) − b·sin(ωt)`, one multiply-add per cell instead of three sines. */
  a: Float32Array;
  b: Float32Array;
  /** Characters that never move: node markers and their one-cell halo. 0 = field shows through. */
  fixed: Uint16Array;
  /** Cell index per frame of the packet's walk; −1 = no packet on the map. */
  path: Int32Array;
  /** Output buffer, rows joined by newlines; rewritten in full every frame. */
  out: Uint16Array;
}

const rippleGrids = new Map<string, RippleGrid>();

/** Cells of the Bresenham line from (x0, y0) to (x1, y1), both ends included. */
function bresenham(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function rippleGrid(cols: number, rows: number): RippleGrid {
  const key = `${cols}x${rows}`;
  const hit = rippleGrids.get(key);
  if (hit) return hit;

  const n = cols * rows;
  const a = new Float32Array(n), b = new Float32Array(n);
  for (const d of DROPS) {
    const cx = d.x * (cols - 1), cy = d.y * (rows - 1), reach = d.r * cols;
    for (let y = 0, k = 0; y < rows; y++) {
      const dy = (y - cy) * 2; // a cell is about twice as tall as it is wide
      for (let x = 0; x < cols; x++, k++) {
        const dist = Math.hypot(x - cx, dy);
        const fall = d.w * Math.max(0, 1 - dist / reach);
        if (fall === 0) continue;
        a[k] += fall * Math.sin(dist / RIPPLE_WAVELENGTH);
        b[k] += fall * Math.cos(dist / RIPPLE_WAVELENGTH);
      }
    }
  }

  // Node markers at the true positions (cm), scaled into the grid: x = 0.1 + 0.75·X/120, y = 0.9 − 0.75·Y/90.
  const fixed = new Uint16Array(n);
  const cell = {} as Record<(typeof NODE_ORDER)[number], [number, number]>;
  const room = cols >= 12 && rows >= 4;
  for (const id of NODE_ORDER) {
    const [X, Y] = DEFAULT_POS[id];
    const x = Math.round((0.1 + (0.75 * X) / 120) * (cols - 1));
    const y = Math.round((0.9 - (0.75 * Y) / 90) * (rows - 1));
    cell[id] = [x, y];
    if (!room) continue;
    const label = ` [${id}] `;
    const start = Math.min(Math.max(x - 3, 0), cols - label.length);
    for (let i = 0; i < label.length; i++) fixed[y * cols + start + i] = label.charCodeAt(i);
  }

  // The packet: N1 → N3 → N4, then N2 → N3 → N4, one cell per frame, a short rest after each delivery.
  const walk: number[] = [];
  for (const [from, via, to] of [['N1', 'N3', 'N4'], ['N2', 'N3', 'N4']] as const) {
    const leg1 = bresenham(...cell[from], ...cell[via]);
    const leg2 = bresenham(...cell[via], ...cell[to]).slice(1);
    for (const [x, y] of leg1.concat(leg2)) walk.push(y * cols + x);
    for (let i = 0; i < DELIVERY_REST; i++) walk.push(-1);
  }

  const out = new Uint16Array(rows * (cols + 1) - 1);
  for (let y = 0; y < rows - 1; y++) out[y * (cols + 1) + cols] = CODE_NL;

  const grid: RippleGrid = { a, b, fixed, path: Int32Array.from(walk), out };
  rippleGrids.set(key, grid);
  return grid;
}

/**
 * Ripples from three drops on the pond, the four nodes where they really stand, and a packet
 * travelling to the sink. v(x, y, t) = Σ wᵢ · sin(dᵢ/2.2 − 2π·t/2.6) · max(0, 1 − dᵢ/Rᵢ).
 */
const ripple: AsciiGen = (frame, cols, rows) => {
  if (cols < 1 || rows < 1) return '';
  const g = rippleGrid(cols, rows);
  const { a, b, fixed, path, out } = g;
  const angle = (2 * Math.PI * (frame / RIPPLE_FPS)) / RIPPLE_PERIOD_S;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const top = RAMP_CODES.length - 1;

  for (let y = 0, k = 0, o = 0; y < rows; y++, o++) {
    for (let x = 0; x < cols; x++, k++, o++) {
      const f = fixed[k];
      if (f !== 0) { out[o] = f; continue; }
      let v = a[k] * cos - b[k] * sin;
      if (v > 1) v = 1; else if (v < -1) v = -1;
      out[o] = RAMP_CODES[Math.round(((v + 1) / 2) * top)];
    }
  }

  // Packet on top of the field: a bright head with a two-cell wake, knocked out of the water by a
  // blank on either side so it reads at any density. Markers always win.
  const step = ((frame % path.length) + path.length) % path.length;
  const head = path[step];
  if (head >= 0) {
    const put = (k: number, code: number) => {
      if (k >= 0 && fixed[k] === 0) out[k + Math.floor(k / cols)] = code;
    };
    const hx = head % cols;
    if (hx > 0) put(head - 1, CODE_SPACE);
    if (hx < cols - 1) put(head + 1, CODE_SPACE);
    for (let back = 2; back >= 1; back--) {
      const k = step - back >= 0 ? path[step - back] : -1;
      if (k >= 0) put(k, CODE_O);
    }
    put(head, CODE_AT);
  }
  return String.fromCharCode.apply(null, out as unknown as number[]);
};

/* ---------- title motifs ---------- */

/** r1: four nodes coming up one by one, then a two-frame hold. */
const boot: AsciiGen = (frame, cols) => {
  const up = Math.min(at([0, 1, 2, 3, 4, 4], frame), 4);
  return pad([0, 1, 2, 3].map((i) => (i < up ? '[#]' : '[ ]')).join(' '), cols);
};

const RADIO = ['N1', 'N1 )', 'N1 ))', 'N1 )))', 'N1  ) )', 'N1    )'];
/** r2: a BLE advertisement leaving N1. */
const radio: AsciiGen = (frame, cols) => pad(at(RADIO, frame), cols);

const BACKOFF = [
  'sense ........',
  'DIFS  |.......',
  'bo    |-|.....',
  'bo    |---|...',
  'TX    |---|#..',
  'ACK   |---|#<.',
  'ACK   |---|#<<',
  'ACK   |---|#<<',
];
/** r3: carrier sense, DIFS, random back-off, transmit, ACK. */
const backoff: AsciiGen = (frame, cols) => pad(at(BACKOFF, frame), cols);

const SLOT_ROW = '[3][1][2][3][C][.]';
const SLOT_COUNT = 6;
/** r4: the TDMA superframe with a cursor under the current slot. */
const slots: AsciiGen = (frame, cols) => {
  const slot = ((frame % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
  return block([SLOT_ROW, ' '.repeat(1 + slot * 3) + '^'], cols);
};

const FAN_DOTS = '      . . .';
const FANOUT = ['*>', '*-->', '*--->', '*---> all', '*---> N3', '*---> N3'];
/** r5: a broadcast growing out to everyone, then a unicast to one node. */
const fanout: AsciiGen = (frame, cols) => block([FAN_DOTS, at(FANOUT, frame), FAN_DOTS], cols);

const FANIN: string[][] = [
  ['N1 -', 'N2 -     [AGG]', 'N3 -'],
  ['N1 --', 'N2 --    [AGG]', 'N3 --'],
  ['N1 --\\', 'N2 --+-> [AGG]', 'N3 --/'],
  ['N1 --\\', 'N2 --+-> [AGG]->', 'N3 --/'],
  ['N1 --\\', 'N2 --+-> [AGG]->', 'N3 --/'],
];
/** r6: three readings running into one aggregate frame, which then leaves for the sink. */
const fanin: AsciiGen = (frame, cols) => block(at(FANIN, frame), cols);

const TRACK_PRIMARY = 'N1 ---- N3 ---- N4';
const TRACK_DETOUR = 'N1 -- N2 -- N3 -- N4';
function dashes(track: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < track.length; i++) if (track[i] === '-') out.push(i);
  return out;
}
const PRIMARY_STEPS = dashes(TRACK_PRIMARY);
const DETOUR_STEPS = dashes(TRACK_DETOUR);
const ROUTE_HALF = 8;
/** r7 and the Overview: a packet on the primary route, then on the detour through N2. */
const route: AsciiGen = (frame, cols) => {
  const f = ((frame % (ROUTE_HALF * 2)) + ROUTE_HALF * 2) % (ROUTE_HALF * 2);
  if (f < ROUTE_HALF) return pad(putChar(TRACK_PRIMARY, PRIMARY_STEPS[f] ?? -1, '#'), cols);
  return pad(putChar(TRACK_DETOUR, DETOUR_STEPS[f - ROUTE_HALF] ?? -1, '#'), cols); // last two frames: delivered
};

/** r8: a measured series scrolling past, one density character per sample. */
const bars: AsciiGen = (frame, cols) => {
  let s = '';
  for (let i = 0; i < cols; i++) s += shade(0.5 + 0.35 * Math.sin(0.9 * i + 0.4 * frame) + 0.15 * Math.sin(2.3 * i));
  return s;
};

/* ---------- steps and meter: animations that show state ---------- */

function stepFlags(params: AsciiParams, cols: number): boolean[] {
  const done = params.done;
  if (Array.isArray(done)) return (done as readonly (number | boolean)[]).map(Boolean);
  return new Array<boolean>(Math.max(0, cols)).fill(false);
}
/** The step that blinks: `params.next`, else the first one not done. −1 = none. */
function nextStep(params: AsciiParams, flags: readonly boolean[]): number {
  const given = params.next;
  const i = typeof given === 'number' ? Math.floor(given) : flags.indexOf(false);
  return i >= 0 && i < flags.length && !flags[i] ? i : -1;
}
/** r9 and the Overview demo strip: `[####>....]`, one cell per step, the next one blinking. */
const steps: AsciiGen = (frame, cols, _rows, params) => {
  const flags = stepFlags(params, cols);
  const next = nextStep(params, flags);
  let s = '[';
  for (let i = 0; i < flags.length; i++) s += flags[i] ? '#' : i === next && frame % 2 === 0 ? '>' : '.';
  return s + ']';
};

/** Width in cells and number of filled cells for a meter's params. */
export function meterCells(params: AsciiParams, cols: number): { width: number; fill: number } {
  const width = Math.max(1, Math.round(num(params.width, cols)));
  return { width, fill: Math.round(clamp01(num(params.value, 0)) * width) };
}
/**
 * `[#####.....]`. With `params.from` (cells filled before the change, set by <Ascii>) the fill
 * moves one cell per frame from there to the value; without it the value is shown at once.
 */
const meter: AsciiGen = (frame, cols, _rows, params) => {
  const { width, fill } = meterCells(params, cols);
  const from = Math.min(width, Math.max(0, Math.round(num(params.from, fill))));
  const shown = from + Math.sign(fill - from) * Math.min(Math.max(0, frame), Math.abs(fill - from));
  return '[' + '#'.repeat(shown) + '.'.repeat(width - shown) + ']';
};

/* ---------- small status glyphs ---------- */

const TICKER = ['>  ', '>> ', '>>>'];
const ticker: AsciiGen = (frame, cols) => pad(at(TICKER, frame), cols);

/** A sparse registration lattice; one point per frame lights up, hopping pseudo-randomly. */
const grid: AsciiGen = (frame, cols, rows) => {
  const perRow = Math.max(1, Math.ceil(cols / 4));
  const n = perRow * Math.max(1, rows);
  // (frame·7 + 3) mod n; 7 is swapped for the next prime when it divides n, so every point is visited.
  const stride = [7, 11, 13, 5, 3].find((m) => gcd(m, n) === 1) ?? 1;
  const lit = (((frame * stride + 3) % n) + n) % n;
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += x % 4 !== 0 ? ' ' : y * perRow + x / 4 === lit ? '*' : '+';
    lines.push(s);
  }
  return lines.join('\n');
};

const PULSE = ['.', 'o', 'O', 'o'];
/** The online heartbeat. `params.off` → a static `x`. */
const pulse: AsciiGen = (frame, _cols, _rows, params) => (params.off ? 'x' : at(PULSE, frame));

const SPINNER = ['|', '/', '-', '\\'];
const spinner: AsciiGen = (frame) => at(SPINNER, frame);

const DOTS = ['.    ', '. .  ', '. . .'];
const dots: AsciiGen = (frame, cols) => pad(at(DOTS, frame), cols);

const CARET_BLINKS = 3;
/** Prefix of a line that has just arrived: blinks three times, then stays. */
const caret: AsciiGen = (frame) => (frame < CARET_BLINKS * 2 && frame % 2 === 1 ? ' ' : '>');

/** Tray header hover motif: a crest `≈` with a `-` either side travels right over `~`. */
const wave: AsciiGen = (frame, cols) => {
  const pos = (frame % (cols + 4)) - 2;
  let s = '~'.repeat(cols);
  s = putChar(s, pos - 1, '-');
  s = putChar(s, pos + 1, '-');
  return putChar(s, pos, '≈');
};

/* ---------- registry ---------- */

export const ANIMS: Record<AsciiName, AnimDef> = {
  ripple: { cols: 96, rows: 26, fps: RIPPLE_FPS, ink: 'surface', gen: ripple },
  boot: { cols: 16, rows: 1, fps: 1, ink: 'ramp', gen: boot },
  radio: { cols: 12, rows: 1, fps: 3, ink: 'ramp', gen: radio },
  backoff: { cols: 20, rows: 1, fps: 4, ink: 'ramp', gen: backoff },
  slots: { cols: 24, rows: 2, fps: 2, ink: 'ramp', gen: slots },
  fanout: { cols: 14, rows: 3, fps: 2, ink: 'ramp', gen: fanout },
  fanin: { cols: 16, rows: 3, fps: 3, ink: 'ramp', gen: fanin },
  route: { cols: 22, rows: 1, fps: 4, ink: 'ramp', gen: route },
  bars: { cols: 16, rows: 1, fps: 2, ink: 'ramp', gen: bars },
  steps: {
    cols: 17, rows: 1, fps: 2, ink: 'ramp', gen: steps,
    // nothing left to blink → static
    frames: (p, cols) => (nextStep(p, stepFlags(p, cols)) < 0 ? 0 : undefined),
  },
  ticker: { cols: 3, rows: 1, fps: 2, ink: 'ramp', gen: ticker },
  grid: { cols: 28, rows: 3, fps: 1, ink: 'ramp', gen: grid },
  pulse: { cols: 1, rows: 1, fps: 4, ink: 'glow', gen: pulse, frames: (p) => (p.off ? 0 : undefined) },
  spinner: { cols: 1, rows: 1, fps: 8, ink: 'glow', gen: spinner },
  dots: { cols: 5, rows: 1, fps: 2, ink: 'mono', gen: dots },
  meter: {
    cols: 10, rows: 1, fps: 24, ink: 'ramp', gen: meter,
    frames: (p, cols) => {
      const { width, fill } = meterCells(p, cols);
      return Math.abs(fill - Math.min(width, Math.max(0, Math.round(num(p.from, fill)))));
    },
  },
  caret: { cols: 1, rows: 1, fps: 4, ink: 'glow', gen: caret, frames: () => CARET_BLINKS * 2 },
  wave: { cols: 8, rows: 1, fps: 6, ink: 'mono', gen: wave },
};
