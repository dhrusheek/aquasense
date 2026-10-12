// The goldfish (spec 09 §3): a small state machine that swims under the lily pads, comes over to
// what the user is looking at, peeks out from under its edge, sniffs, blows bubbles and leaves.
// Pure: no DOM. `update` returns what to draw; effects (bubbles, ripples) go out through `FishFx`.
import { hitsRects, pointIn, visibleFrac, type Ctx, type Obstacles, type Rect } from './obstacles';

export type { Ctx, Obstacles, Rect };

const VMAX = 34;
const ROW_H = 17;
const ROWS = 3;
const SLEEP_AFTER = 60;
const VISIT_COOLDOWN = 25;
const MIN_SLEEP_VIS = 0.4;
const TRAVEL_CAP = 20;
const LINGER_MAX = 45;

export interface Attention { id: number; rect: Rect; ref: { x: number; y: number } | null; until: number }
export interface FishFx {
  bubble(x: number, y: number, z?: boolean): void;
  depart(x: number, y: number): void;
  cheer(x: number, y: number): void;
}
export type Stimulus = 'agitate' | 'sink' | 'surface' | 'dart';
export interface FishView {
  x: number; y: number; text: string; opacity: number; tone: 'n2' | 'n3'; idle: boolean; mode: string;
}

type Mode = 'wander' | 'approach' | 'sniff' | 'linger' | 'turn' | 'dart' | 'travelSleep' | 'sleep' | 'sinking' | 'sunk' | 'park';
interface Target { x: number; y: number; fx: 1 | -1 | 0 }

/* ---------- sprites (right-facing, 6 columns) ---------- */

const A = ['\\ ,/  ', ' >((\'>', '/ `\\  '];
const B = ['| ,/  ', ' }((\'>', '| `\\  '];
const C = ['/ ,/  ', ' >((\'>', '\\ `\\  '];
const TURN = ['  ,   ', " ('') ", '  `   '].join('\n');
const SWAP: Record<string, string> = { '<': '>', '>': '<', '(': ')', ')': '(', '/': '\\', '\\': '/', '{': '}', '}': '{' };
const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().map((ch) => SWAP[ch] ?? ch).join(''));
const SPRITES = {
  right: [A, B, C, B].map((f) => f.join('\n')),
  left: [A, B, C, B].map((f) => mirror(f).join('\n')),
};

/* ---------- smooth noise ---------- */

/** Seeded 1-D value noise in [0, 1): random lattice values, smoothstep between them. */
export function makeNoise(seed: number): (x: number) => number {
  let s = seed >>> 0;
  const lattice: number[] = [];
  for (let i = 0; i < 256; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    lattice.push(s / 4294967296);
  }
  return (x: number) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lattice[i & 255] * (1 - u) + lattice[(i + 1) & 255] * u;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * clamp(k, 0, 1);
}

export class Fish {
  x = 0; y = 0; vx = 0; vy = 0;
  heading = 0;
  facing: 1 | -1 = 1;
  mode: Mode = 'wander';

  private fx: FishFx;
  private noise = makeNoise(11);
  private noise2 = makeNoise(97);
  private seed = 7;
  private t = 0;
  private modeAt = 0;
  private bw = 50;
  private bh = ROWS * ROW_H;
  private lastCtx: Ctx = { w: 1280, h: 800, cellW: 8.4, cellH: ROW_H, now: 0 };
  private agitUntil = 0;
  private lastInput = 0;
  private signT = 0;
  private flipT = 0;
  private interest: { x: number; y: number } | null = null;
  private nextInterest = 6;
  private visited = new Map<number, number>();
  private attId = -1;
  private target: Target | null = null;
  private base = { x: 0, y: 0 };
  private sniffDur = 0;
  private bubbleAt: number[] = [];
  private afterTurn: (() => void) | null = null;
  private dir = { x: 1, y: 0 };
  private openSince: number | null = null;
  private nextZ = 0;
  private blockedX = false;
  private blockedY = false;
  private repicked = false;
  private travelAt = 0;
  /** visibleFrac of the last peek spot chosen; below 0.3 means no open water was found. */
  peekQ = 1;

  constructor(fx: FishFx) { this.fx = fx; }

  /** Asleep or parked: nothing moves, so the loop can idle. */
  idle(): boolean { return this.mode === 'sleep' || this.mode === 'park'; }

  /** The loop may drop to 8 fps: asleep, or travelling to bed for more than TRAVEL_CAP seconds. */
  slow(): boolean { return this.mode === 'sleep' || (this.mode === 'travelSleep' && this.t - this.travelAt > TRAVEL_CAP); }

  /** Fraction of the fish box that shows (is not under a pad). */
  visible(o: Obstacles): number { return visibleFrac(this.x - this.bw / 2, this.y - this.bh / 2, this.bw, this.bh, o.pads); }

  private rnd(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private since(): number { return this.t - this.modeAt; }
  private setMode(m: Mode): void { this.mode = m; this.modeAt = this.t; }

  /* ---------- placement ---------- */

  private pickWater(c: Ctx, o: Obstacles, score?: (x: number, y: number) => number): { x: number; y: number } {
    let best = { x: c.w / 2, y: c.h / 2 }, bestS = -Infinity;
    for (let i = 0; i < 40; i++) {
      const x = 50 + this.rnd() * Math.max(10, c.w - 100), y = 50 + this.rnd() * Math.max(10, c.h - 100);
      if (pointIn(x, y, o.pads) || hitsRects(x - this.bw / 2, y - this.bh / 2, this.bw, this.bh, o.text)) continue;
      const s = score ? score(x, y) : this.rnd();
      if (s > bestS) { bestS = s; best = { x, y }; }
      if (!score) break;
    }
    return best;
  }

  /**
   * Sleeping spots: every cell-aligned fish box in the viewport that clears all text and shows at least
   * MIN_SLEEP_VIS of itself (a fish half under a lily pad is the intended look).
   */
  private sleepSpots(c: Ctx, o: Obstacles): Array<Target & { v: number }> {
    const bw = 6 * c.cellW, bh = this.bh, out: Array<Target & { v: number }> = [];
    for (let y = c.h - 8 - bh; y >= 8; y -= c.cellH) {
      for (let x = 8; x + bw <= c.w - 8; x += c.cellW) {
        if (hitsRects(x, y, bw, bh, o.text)) continue;
        const v = visibleFrac(x, y, bw, bh, o.pads);
        if (v >= MIN_SLEEP_VIS) out.push({ x: x + bw / 2, y: y + bh / 2, fx: 0, v });
      }
    }
    return out;
  }

  /** Best sleeping spot (most visible; ties go to the lowest, then left-most); else the bottom-left corner. */
  private sleepSpot(c: Ctx, o: Obstacles): Target {
    let best: Target & { v: number } | null = null;
    for (const p of this.sleepSpots(c, o)) {
      if (!best || p.v > best.v + 1e-9 || (Math.abs(p.v - best.v) < 1e-9 && (p.y > best.y || (p.y === best.y && p.x < best.x)))) best = p;
    }
    return best ?? { x: 24 + (6 * c.cellW) / 2, y: c.h - 24 - this.bh / 2, fx: 0 };
  }

  /** The qualifying sleeping spot nearest to the fish, or null. */
  private nearestSpot(c: Ctx, o: Obstacles): Target | null {
    let best: Target | null = null, bd = Infinity;
    for (const p of this.sleepSpots(c, o)) {
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** First placement: a random patch of open water. */
  place(c: Ctx, o: Obstacles): void {
    this.bw = 6 * c.cellW; this.lastCtx = c; this.t = c.now;
    const p = this.pickWater(c, o);
    this.x = p.x; this.y = p.y;
    this.heading = this.rnd() * Math.PI * 2;
    this.facing = Math.cos(this.heading) >= 0 ? 1 : -1;
    this.lastInput = c.now; this.nextInterest = c.now + 6;
    this.setMode('wander');
  }

  /** Reduced motion: a still fish in the bottom-right water, facing left. */
  park(c: Ctx, o: Obstacles): void {
    this.bw = 6 * c.cellW; this.lastCtx = c; this.t = c.now;
    const p = this.pickWater(c, o, (x, y) => x + y);
    this.x = p.x; this.y = p.y; this.vx = this.vy = 0; this.facing = -1;
    this.setMode('park');
  }

  /* ---------- outside world ---------- */

  /** Any pointer or key input: resets the sleep timer and wakes a sleeper. */
  input(now: number): void {
    this.lastInput = now;
    if (this.mode === 'sleep' || this.mode === 'travelSleep') this.startTurn(() => this.goWander(), false);
  }

  stimulus(kind: Stimulus, at?: { x: number; y: number }): void {
    const m = this.mode;
    if (m === 'park') return;
    if (kind === 'agitate') {
      if (m === 'sinking' || m === 'sunk') return;
      this.agitUntil = this.t + 6;
      if (m === 'sleep' || m === 'travelSleep' || m === 'approach' || m === 'sniff') this.goWander();
    } else if (kind === 'sink') {
      if (m === 'sinking' || m === 'sunk') return;
      this.target = { x: this.x, y: this.lastCtx.h - 30, fx: 0 };
      this.agitUntil = 0;
      this.setMode('sinking');
    } else if (kind === 'surface') {
      if (m !== 'sinking' && m !== 'sunk') return;
      this.fx.cheer(this.x, this.y);
      this.startTurn(() => this.goWander(), false);
    } else if (m !== 'sinking' && m !== 'sunk' && m !== 'turn') {
      // dart: turn to face away from the stimulus, then bolt
      const ax = at ? this.x - at.x : this.rnd() - 0.5, ay = at ? this.y - at.y : (this.rnd() - 0.5) * 0.6;
      const n = Math.hypot(ax, ay) || 1;
      this.dir = { x: ax / n, y: ay / n };
      this.facing = this.dir.x >= 0 ? 1 : -1;
      this.startTurn(() => { this.setMode('dart'); }, true);
    }
  }

  private goWander(): void {
    this.heading = this.facing > 0 ? 0 : Math.PI;
    if (this.mode === 'turn') this.afterTurn = null;
    this.setMode('wander');
    this.interest = null;
    this.nextInterest = this.t + 6 + this.rnd() * 8;
  }

  private startTurn(after: () => void, ripple: boolean): void {
    if (ripple) this.fx.depart(this.x, this.y);
    this.vx = this.vy = 0;
    this.afterTurn = after;
    this.setMode('turn');
  }

  /* ---------- steering ---------- */

  private steer(dvx: number, dvy: number, accel: number, dt: number): void {
    let ax = dvx - this.vx, ay = dvy - this.vy;
    const m = Math.hypot(ax, ay), lim = accel * dt;
    if (m > lim) { ax *= lim / m; ay *= lim / m; }
    this.vx += ax; this.vy += ay;
  }

  private repel(rects: Rect[], hx: number, hy: number, ramp: number, k: number, out: { x: number; y: number }): void {
    for (const r of rects) {
      const l = r.x - hx, rr = r.x + r.w + hx, tp = r.y - hy, b = r.y + r.h + hy;
      if (this.x < l || this.x > rr || this.y < tp || this.y > b) continue;
      const dl = this.x - l, dr = rr - this.x, dtp = this.y - tp, db = b - this.y;
      const mn = Math.min(dl, dr, dtp, db), s = k * Math.min(1, mn / ramp);
      if (mn === dl) out.x -= s; else if (mn === dr) out.x += s; else if (mn === dtp) out.y -= s; else out.y += s;
    }
  }

  private avoid(c: Ctx, o: Obstacles, pads: boolean): { x: number; y: number } {
    const out = { x: 0, y: 0 }, m = 40;
    if (this.x < m) out.x += ((m - this.x) / m) * VMAX;
    if (this.x > c.w - m) out.x -= ((this.x - (c.w - m)) / m) * VMAX;
    if (this.y < m) out.y += ((m - this.y) / m) * VMAX;
    if (this.y > c.h - m) out.y -= ((this.y - (c.h - m)) / m) * VMAX;
    this.repel(o.text, this.bw / 2 + 36, this.bh / 2 + 36, 36, 2 * VMAX, out);
    if (pads) this.repel(o.pads, 0, 0, 30, 0.8 * VMAX, out);
    return out;
  }

  /** Move with per-axis blocking by text rects; slide, never teleport. */
  private move(dt: number, c: Ctx, o: Obstacles): void {
    const inside = hitsRects(this.x - this.bw / 2, this.y - this.bh / 2, this.bw, this.bh, o.text, 3);
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    this.blockedX = this.blockedY = false;
    if (inside || !hitsRects(nx - this.bw / 2, this.y - this.bh / 2, this.bw, this.bh, o.text, 3)) this.x = nx;
    else { this.blockedX = true; this.vx *= -0.3; }
    if (inside || !hitsRects(this.x - this.bw / 2, ny - this.bh / 2, this.bw, this.bh, o.text, 3)) this.y = ny;
    else { this.blockedY = true; this.vy *= -0.3; }
    this.x = clamp(this.x, 16, c.w - 16);
    this.y = clamp(this.y, 16, c.h - 16);
    if (this.blockedX) this.heading = Math.PI - this.heading;
    if (this.blockedY) this.heading = -this.heading;
  }

  /** Flip only after the sign of vx has held for 250 ms and |vx| > 5. */
  private flip(dt: number): void {
    if (Math.abs(this.vx) > 5 && Math.sign(this.vx) !== this.facing) {
      this.signT += dt;
      if (this.signT > 0.25) { this.facing = this.facing > 0 ? -1 : 1; this.flipT = 0.12; this.signT = 0; }
    } else this.signT = 0;
  }

  /**
   * Where to wait for an attended element: against one of its four edges, nose 4 px under it, on the
   * stretch nearest the pointer, preferring the box with the most open water around it.
   */
  private edgeTarget(att: Attention, c: Ctx, o: Obstacles): Target | null {
    const r = att.rect, ref = att.ref ?? { x: this.x, y: this.y };
    const bw = this.bw, bh = this.bh, diag = Math.hypot(c.w, c.h), nose = 4;
    const cx = clamp(ref.x, r.x, r.x + r.w), cy = clamp(ref.y, r.y, r.y + r.h);
    const spots: Array<{ x: number; y: number; fx: 1 | -1 | 0 }> = [
      { x: cx, y: r.y + nose - bh / 2, fx: 0 },
      { x: cx, y: r.y + r.h - nose + bh / 2, fx: 0 },
      { x: r.x + nose - bw / 2, y: cy, fx: 1 },
      { x: r.x + r.w - nose + bw / 2, y: cy, fx: -1 },
    ];
    let best: Target | null = null, bestS = -Infinity, bestV = 0;
    for (const p of spots) {
      if (p.x - bw / 2 < 4 || p.x + bw / 2 > c.w - 4 || p.y - bh / 2 < 4 || p.y + bh / 2 > c.h - 4) continue;
      if (hitsRects(p.x - bw / 2, p.y - bh / 2, bw, bh, o.text)) continue;
      const v = visibleFrac(p.x - bw / 2, p.y - bh / 2, bw, bh, o.pads);
      const sc = v - 0.15 * (Math.hypot(p.x - ref.x, p.y - ref.y) / diag);
      if (sc > bestS) { bestS = sc; best = p; bestV = v; }
    }
    this.peekQ = bestV;
    return best;
  }

  /* ---------- per-frame ---------- */

  update(dtIn: number, c: Ctx, o: Obstacles, att: Attention | null): FishView {
    const dt = Math.min(dtIn, 0.1);
    this.t = c.now; this.bw = 6 * c.cellW; this.lastCtx = c;
    if (this.flipT > 0) this.flipT -= dt;
    switch (this.mode) {
      case 'wander': this.wander(dt, c, o, att); break;
      case 'approach': this.approach(dt, c, o, att); break;
      case 'sniff': this.sniff(att); break;
      case 'linger': this.linger(att); break;
      case 'turn': if (this.since() >= 0.12) this.afterTurn?.(); break;
      case 'dart': this.dart(dt, c, o); break;
      case 'travelSleep': this.travelSleep(dt, c, o); break;
      case 'sleep': this.sleep(o); break;
      case 'sinking': this.sinking(dt, c, o); break;
      case 'sunk': this.sunk(); break;
      default: break;
    }
    return this.view(o);
  }

  private wander(dt: number, c: Ctx, o: Obstacles, att: Attention | null): void {
    const agit = this.t < this.agitUntil, k = agit ? 3 : 1;
    if (att && att.until > this.t && !agit && this.t - (this.visited.get(att.id) ?? -1e9) > VISIT_COOLDOWN) {
      const tg = this.edgeTarget(att, c, o);
      if (tg) { this.attId = att.id; this.target = tg; this.setMode('approach'); return; }
      this.visited.set(att.id, this.t);
    }
    if (!agit && this.t - this.lastInput > SLEEP_AFTER) {
      this.target = this.sleepSpot(c, o);
      this.repicked = false;
      this.travelAt = this.t;
      this.setMode('travelSleep');
      return;
    }
    this.heading += (this.noise(this.t * 0.25 * k) - 0.5) * 0.8 * k * dt;
    if (agit) this.heading += Math.sin(this.t * 6) * 1.5 * dt;
    if (this.t > this.nextInterest) {
      this.interest = this.pickWater(c, o);
      this.nextInterest = this.t + 6 + this.rnd() * 8;
    }
    if (this.interest) {
      const dx = this.interest.x - this.x, dy = this.interest.y - this.y;
      if (Math.hypot(dx, dy) < 60) this.interest = null;
      else this.heading = lerpAngle(this.heading, Math.atan2(dy, dx), dt * 0.6);
    }
    const speed = agit ? 2 * VMAX : 18 + 16 * this.noise2(this.t * 0.1);
    const av = this.avoid(c, o, true);
    let dvx = Math.cos(this.heading) * speed + av.x, dvy = (Math.sin(this.heading) * speed + av.y) * 0.65;
    if (av.x !== 0 || av.y !== 0) this.heading = lerpAngle(this.heading, Math.atan2(dvy, dvx), dt * 3);
    if (!agit) { const m = Math.hypot(dvx, dvy); if (m > VMAX * 1.3) { dvx *= (VMAX * 1.3) / m; dvy *= (VMAX * 1.3) / m; } }
    this.steer(dvx, dvy, agit ? 120 : 30, dt);
    this.move(dt, c, o);
    this.flip(dt);
  }

  private approach(dt: number, c: Ctx, o: Obstacles, att: Attention | null): void {
    const tg = att && att.id === this.attId && att.until > this.t ? this.edgeTarget(att, c, o) : null;
    if (!tg || this.since() > 14) {
      this.visited.set(this.attId, this.t);
      this.goWander();
      return;
    }
    this.target = tg;
    const dx = tg.x - this.x, dy = tg.y - this.y, d = Math.hypot(dx, dy);
    if (d < 6) {
      this.visited.set(this.attId, this.t);
      this.base = { x: tg.x, y: tg.y }; this.x = tg.x; this.y = tg.y; this.vx = this.vy = 0;
      if (tg.fx) this.facing = tg.fx;
      this.sniffDur = 1.5 + this.rnd() * 1.5;
      const n = 2 + Math.floor(this.rnd() * 2);
      this.bubbleAt = Array.from({ length: n }, () => 0.3 + this.rnd() * (this.sniffDur - 0.6)).sort((a, b) => a - b);
      this.setMode('sniff');
      return;
    }
    const s = Math.max(10, VMAX * Math.min(1, d / 48));
    this.steer((dx / d) * s, (dy / d) * s, 30, dt);
    this.move(dt, c, o);
    this.flip(dt);
  }

  private mouth(): { x: number; y: number } {
    return { x: this.x + this.facing * (this.bw / 2 - this.lastCtx.cellW * 0.5), y: this.y };
  }

  private held(att: Attention | null): boolean {
    return !!att && att.id === this.attId && att.until > this.t;
  }

  private bob(m: number): void {
    this.x = this.base.x + 3 * Math.sin(2 * Math.PI * 1.2 * m) * this.facing;
    this.y = this.base.y + 2 * Math.sin(2 * Math.PI * 0.6 * m);
  }

  private leave(): void {
    this.visited.set(this.attId, this.t);
    this.startTurn(() => { this.facing = this.facing > 0 ? -1 : 1; this.vx = this.facing * 12; this.goWander(); }, true);
  }

  /** Stay at the edge, bobbing, for as long as the user keeps looking at the element. */
  private linger(att: Attention | null): void {
    const m = this.since();
    this.bob(m);
    if (this.t >= this.nextZ) {
      this.nextZ = this.t + 4 + this.rnd() * 2;
      const p = this.mouth();
      this.fx.bubble(p.x, p.y);
    }
    if (!this.held(att) || m >= LINGER_MAX) this.leave();
  }

  private sniff(att: Attention | null): void {
    const m = this.since();
    this.bob(m);
    while (this.bubbleAt.length && this.bubbleAt[0] <= m) {
      this.bubbleAt.shift();
      const p = this.mouth();
      this.fx.bubble(p.x, p.y);
    }
    if (m >= this.sniffDur) {
      if (this.held(att)) { this.nextZ = this.t + 4 + this.rnd() * 2; this.setMode('linger'); } else this.leave();
    }
  }

  private dart(dt: number, c: Ctx, o: Obstacles): void {
    const m = this.since(), sp = 3 * VMAX * Math.exp(-m / 0.4);
    if (this.blockedX || this.x < 20 || this.x > c.w - 20) this.dir.x = -this.dir.x;
    if (this.blockedY || this.y < 20 || this.y > c.h - 20) this.dir.y = -this.dir.y;
    this.vx = this.dir.x * sp; this.vy = this.dir.y * sp * 0.7;
    this.move(dt, c, o);
    if (m > 1.3) { this.facing = this.vx >= 0 ? 1 : -1; this.heading = Math.atan2(this.dir.y, this.dir.x); this.goWander(); }
  }

  private shows(o: Obstacles): boolean {
    const bx = this.x - this.bw / 2, by = this.y - this.bh / 2;
    return !hitsRects(bx, by, this.bw, this.bh, o.text) && visibleFrac(bx, by, this.bw, this.bh, o.pads) >= MIN_SLEEP_VIS;
  }

  private travelSleep(dt: number, c: Ctx, o: Obstacles): void {
    const tg = this.target;
    if (!tg) { this.setMode('sleep'); return; }
    const dx = tg.x - this.x, dy = tg.y - this.y, d = Math.hypot(dx, dy);
    const arrived = d < 8;
    if (arrived || this.t - this.travelAt > TRAVEL_CAP) {
      // Settle where we are if it is a good bed; otherwise pick the nearest good one (once more).
      if (this.shows(o) || this.repicked) { this.vx = this.vy = 0; this.nextZ = this.t + 1; this.setMode('sleep'); return; }
      this.repicked = true;
      this.travelAt = this.t;
      this.target = this.nearestSpot(c, o) ?? this.sleepSpot(c, o);
      return;
    }
    // Heading under a pad is the point, so only the text (and the screen edge) steer the fish.
    const s = Math.max(10, 24 * Math.min(1, d / 48));
    const av = d > 60 ? this.avoid(c, o, false) : { x: 0, y: 0 };
    this.steer((dx / d) * s + av.x, (dy / d) * s + av.y, 30, dt);
    this.move(dt, c, o);
    this.flip(dt);
  }

  private sleep(o: Obstacles): void {
    if (this.t >= this.nextZ) {
      this.nextZ = this.t + 2.5;
      if (!this.shows(o)) return;
      const p = this.mouth();
      this.fx.bubble(p.x, p.y - 8, true);
    }
  }

  private sinking(dt: number, c: Ctx, o: Obstacles): void {
    const tg = this.target;
    if (!tg) { this.setMode('sunk'); return; }
    const dy = tg.y - this.y;
    if (Math.abs(dy) < 3) { this.vx = this.vy = 0; this.base = { x: this.x, y: this.y }; this.nextZ = this.t + 2; this.setMode('sunk'); return; }
    this.steer(0, Math.sign(dy) * 14, 20, dt);
    this.move(dt, c, o);
  }

  private sunk(): void {
    const m = this.since();
    this.y = this.base.y + 2 * Math.sin(2 * Math.PI * 0.6 * m);
    this.x = this.base.x + 3 * Math.sin(2 * Math.PI * 1.2 * m) * this.facing;
    if (this.t >= this.nextZ) {
      this.nextZ = this.t + 3 + this.rnd() * 2;
      const p = this.mouth();
      this.fx.bubble(p.x, p.y);
    }
  }

  private view(o: Obstacles): FishView {
    const bx = this.x - this.bw / 2, by = this.y - this.bh / 2;
    const hidden = hitsRects(bx, by, this.bw, this.bh, o.text, 2);
    if (hitsRects(bx, by, this.bw, this.bh, o.pads)) this.openSince = null;
    else if (this.openSince === null) this.openSince = this.t;
    const open = this.openSince !== null && this.t - this.openSince > 2;
    const still = this.mode === 'sleep' || this.mode === 'park';
    const set = this.facing > 0 ? SPRITES.right : SPRITES.left;
    const text = this.mode === 'turn' || this.flipT > 0 ? TURN : set[still ? 0 : Math.floor(this.t * 8) % 4];
    return {
      x: bx, y: by, text, opacity: hidden ? 0 : open ? 0.6 : 0.75, tone: open ? 'n2' : 'n3', idle: still, mode: this.mode,
    };
  }
}
