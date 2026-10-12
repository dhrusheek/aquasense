// The water surface (spec 09 §4): click ripples, idle glints, bubbles and the fish's departure
// ripples, simulated on the character grid. Pure: no DOM; `tick` returns the live cells and the
// canvas painter draws them. Cells combine by maximum alpha.
import { pointIn, type Ctx, type Obstacles, type Rect } from './obstacles';

export interface Cell { ch: string; tone: 3 | 4; a: number }
/** Cells are keyed `row * KEY + col`. */
export const KEY = 4096;

interface RingSpec { rings: number; gap: number; speed: number; T: number }
const SPECS = {
  click: { rings: 3, gap: 0.12, speed: 12, T: 1.0 },
  big: { rings: 6, gap: 0.12, speed: 24, T: 1.6 },
  cheer: { rings: 3, gap: 0.18, speed: 10, T: 1.3 },
  still: { rings: 1, gap: 0, speed: 0, T: 0.6 },
} satisfies Record<string, RingSpec>;
export type RippleKind = keyof typeof SPECS;

// A t0 of NaN means "stamp me with the clock of the next tick", so no effect is ever younger than zero.
interface Ripple { col: number; row: number; t0: number; spec: RingSpec; seed: number; still: boolean; r0: number }
interface Depart { col: number; row: number; t0: number }
interface Glint { col: number; row: number; t0: number; life: number }
interface Bubble {
  col: number; row: number; t0: number; seed: number; max: number; z: boolean; free: boolean;
  popAt: number; popCol: number; popRow: number;
}

const DEPART = ['~', '( )', '(   )', '.   .'];
const BUBBLE_STEP = 0.18; // seconds per row risen
const GLINT_CH = ['.', '~', "'"];
const MAX_RIPPLES = 4;

/** Integer hash to [0, 1). */
function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function ringGlyph(c: number, s: number): string {
  if (Math.abs(s) < 0.38) return c > 0 ? ')' : '(';
  if (Math.abs(c) < 0.38) return '~';
  return c * s > 0 ? '/' : '\\';
}

export class Water {
  private ripples: Ripple[] = [];
  private departs: Depart[] = [];
  private glints: Glint[] = [];
  private bubbles: Bubble[] = [];
  private out = new Map<number, Cell>();
  private seed = 1;
  private cw = 8.4;
  private ch = 17;

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * Drop a stone at pixel (x, y) at time `now` (seconds; omit to take the next tick's clock). A stone
   * dropped on a pad starts its first ring at the pad's edge, where the water comes out from under it.
   */
  ripple(x: number, y: number, now: number | undefined, kind: RippleKind = 'click', pads: Rect[] = []): void {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    let r0 = 0;
    if (kind !== 'still') {
      let best: Rect | null = null;
      for (const r of pads) if (pointIn(x, y, [r]) && (!best || r.w * r.h > best.w * best.h)) best = r;
      if (best) r0 = Math.min(x - best.x, best.x + best.w - x, y - best.y, best.y + best.h - y) / this.cw;
    }
    this.ripples.push({
      col: x / this.cw, row: y / this.ch, t0: now ?? NaN, spec: SPECS[kind], seed: this.ripples.length + Math.floor(this.rnd() * 97), still: kind === 'still', r0,
    });
  }

  depart(x: number, y: number, now?: number): void {
    if (this.departs.length >= 3) this.departs.shift();
    this.departs.push({ col: x / this.cw, row: y / this.ch, t0: now ?? NaN });
  }

  bubble(x: number, y: number, now: number | undefined, z = false, free = false): void {
    if (this.bubbles.length > 24) this.bubbles.shift();
    this.bubbles.push({
      col: x / this.cw, row: y / this.ch, t0: now ?? NaN, seed: this.rnd() * 6.28, z, free,
      max: z ? 5 : 6 + Math.floor(this.rnd() * 5), popAt: -1, popCol: 0, popRow: 0,
    });
  }

  /** Anything that needs the fast clock: rings in flight, rising bubbles. */
  busy(): boolean {
    return this.ripples.length + this.departs.length + this.bubbles.length > 0;
  }

  glintCount(): number { return this.glints.length; }
  counts(): { ripples: number; glints: number; bubbles: number } {
    return { ripples: this.ripples.length + this.departs.length, glints: this.glints.length, bubbles: this.bubbles.length };
  }

  clear(): void {
    this.ripples = []; this.departs = []; this.glints = []; this.bubbles = []; this.out.clear();
  }

  private put(col: number, row: number, cols: number, rows: number, ch: string, tone: 3 | 4, a: number): void {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    const key = row * KEY + col;
    const cur = this.out.get(key);
    if (cur && cur.a >= a) return;
    this.out.set(key, { ch, tone, a });
  }

  /**
   * Advance to `c.now` and return the live cells. `glints` allows the idle shimmer (and its spawning
   * when `spawn` is set); `reduced` collapses ripples to one static ring.
   */
  tick(c: Ctx, o: Obstacles, opt: { glints: boolean; spawn: boolean }): Map<number, Cell> {
    const { now } = c;
    this.cw = c.cellW; this.ch = c.cellH;
    const cols = Math.floor(c.w / c.cellW), rows = Math.floor(c.h / c.cellH);
    const aspect = c.cellW / c.cellH;
    this.out.clear();
    for (const e of this.ripples) if (Number.isNaN(e.t0)) e.t0 = now;
    for (const e of this.departs) if (Number.isNaN(e.t0)) e.t0 = now;
    for (const e of this.bubbles) if (Number.isNaN(e.t0)) e.t0 = now;

    // Ripples
    this.ripples = this.ripples.filter((r) => now - r.t0 < (r.spec.rings - 1) * r.spec.gap + r.spec.T);
    for (const r of this.ripples) {
      for (let k = 0; k < r.spec.rings; k++) {
        const t = now - r.t0 - k * r.spec.gap;
        if (t < 0 || t > r.spec.T) continue;
        const a = r.still ? 0.8 : (1 - t / r.spec.T) ** 2;
        const rad = r.still ? 4 : r.r0 + r.spec.speed * t;
        const n = Math.max(8, Math.ceil(2 * Math.PI * rad * 1.3));
        for (let i = 0; i < n; i++) {
          const th = (2 * Math.PI * i) / n;
          const cs = Math.cos(th), sn = Math.sin(th);
          const col = Math.round(r.col + rad * cs), row = Math.round(r.row + rad * sn * aspect);
          if (!r.still && hash(col, row, k + r.seed) >= a) continue;
          this.put(col, row, cols, rows, ringGlyph(cs, sn), 3, r.still ? a : 0.3 + 0.6 * a);
        }
      }
    }

    // Departure ripples: a few text frames, 80 ms each
    this.departs = this.departs.filter((d) => now - d.t0 < DEPART.length * 0.08);
    for (const d of this.departs) {
      const s = DEPART[Math.min(DEPART.length - 1, Math.max(0, Math.floor((now - d.t0) / 0.08)))];
      const c0 = Math.round(d.col) - Math.floor(s.length / 2), row = Math.round(d.row);
      for (let i = 0; i < s.length; i++) if (s[i] !== ' ') this.put(c0 + i, row, cols, rows, s[i], 3, 0.8);
    }

    // Bubbles
    this.bubbles = this.bubbles.filter((b) => (b.popAt < 0 ? true : now - b.popAt < 0.12));
    for (const b of this.bubbles) {
      if (b.popAt >= 0) { this.put(b.popCol, b.popRow, cols, rows, "'", 4, 0.9); continue; }
      const age = Math.max(0, now - b.t0), steps = age / BUBBLE_STEP;
      const col = Math.round(b.col + 0.5 * Math.sin(age * 3 + b.seed)), row = Math.round(b.row - steps);
      const gone = steps >= b.max;
      const hitPad = !b.free && pointIn((col + 0.5) * c.cellW, (row - 0.5) * c.cellH, o.pads);
      if (gone || hitPad) {
        b.popAt = now; b.popCol = col; b.popRow = row;
        if (b.z) b.popAt = now - 1; // z's simply fade out
        continue;
      }
      const ch = b.z ? ['z', 'Z', 'z'][Math.min(2, Math.floor(steps / 1.7))] : steps < 2 ? '.' : steps < 4 ? 'o' : 'O';
      this.put(col, row, cols, rows, ch, 4, 0.9);
    }

    // Glints: slow horizontal bands, never on text, never under a pad
    if (opt.glints) {
      const cap = Math.floor(0.006 * cols * rows);
      if (opt.spawn && this.glints.length < cap) {
        for (let i = 0; i < 8 && this.glints.length < cap; i++) {
          const col = Math.floor(this.rnd() * cols), row = Math.floor(this.rnd() * rows);
          if (Math.sin(row * 0.3 + now * 0.1) <= 0.9) continue;
          const px = (col + 0.5) * c.cellW, py = (row + 0.5) * c.cellH;
          if (pointIn(px, py, o.pads) || pointIn(px, py, o.text)) continue;
          this.glints.push({ col, row, t0: now, life: 2 + this.rnd() * 2 });
        }
      }
    }
    this.glints = this.glints.filter((g) => now - g.t0 < g.life);
    if (opt.glints || this.glints.length) {
      for (const g of this.glints) {
        const age = Math.max(0, now - g.t0);
        const col = g.col + Math.floor(age / 2);
        const px = (col + 0.5) * c.cellW, py = (g.row + 0.5) * c.cellH;
        if (pointIn(px, py, o.text) || pointIn(px, py, o.pads)) continue;
        this.put(col, g.row, cols, rows, GLINT_CH[Math.min(2, Math.floor((age / g.life) * 3))], 4, 0.8 * Math.sin((Math.PI * age) / g.life));
      }
    }
    return this.out;
  }
}
