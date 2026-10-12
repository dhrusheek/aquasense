// A fish that jumps out of the pond every few seconds (waves scene, shimmer only).
import { css, type ArtColours } from '../raster';
import { TAU, hash, radial } from './common';

export const JUMP_S = 0.7;   // time in the air
export const SPLASH_S = 1.0; // ripple fade
export interface Jump { start: number; x01: number; dir: 1 | -1; id: number }

/** The latest jump that has started by time t (jumps come every 4..9 s, seeded per instance). */
export function jumpAt(t: number, seed: number): Jump | null {
  let s = 0, last: Jump | null = null;
  for (let i = 0; i < 4000; i++) {
    s += 4 + 5 * hash(seed + i * 1.37);
    if (s > t) break;
    last = { start: s, x01: 0.22 + 0.56 * hash(seed + i * 3.1 + 9), dir: hash(seed + i * 5.7 + 2) < 0.5 ? -1 : 1, id: i };
  }
  return last;
}

/** True from 150 ms before a jump starts until it has landed (the instance runs at 24 fps meanwhile). */
export function jumpBoost(t: number, seed: number): boolean {
  const j = jumpAt(t + 0.15, seed);
  if (!j) return false;
  const a = t + 0.15 - j.start;
  return a >= 0 && a < JUMP_S + 0.15;
}

function splash(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, L: number, p: ArtColours, id: number, scale: number) {
  if (age < 0 || age > SPLASH_S) return;
  const n = 5 + Math.floor(hash(id) * 4);
  const g = L * 5.2;
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (hash(id + i * 2.3) - 0.5) * 1.5;
    const sp = L * (1.5 + 1.4 * hash(id + i * 4.1)), a = age;
    if (a > 0.6) continue;
    const dx = Math.cos(ang) * sp * a + (hash(id + i) - 0.5) * scale, dy = Math.sin(ang) * sp * a + 0.5 * g * a * a;
    ctx.fillStyle = css(p.cream, 0.95 * (1 - a / 0.6));
    ctx.beginPath(); ctx.arc(x + dx, y + dy, Math.max(1.5, L * 0.045), 0, TAU); ctx.fill();
  }
  const k = age / SPLASH_S, rx = L * (0.25 + 1.5 * k);
  ctx.strokeStyle = css(p.cream, 0.85 * (1 - k));
  ctx.lineWidth = Math.max(1.4, L * 0.05);
  ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.2, 0, 0, TAU); ctx.stroke();
}

/** Draws the fish and splashes for the latest jump; `yw` is the water line the fish leaves and lands on. */
export function drawJump(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: ArtColours, seed: number, yw: number) {
  const j = jumpAt(t, seed);
  if (!j) return;
  const age = t - j.start;
  if (age > JUMP_S + SPLASH_S) return;
  const L = H * 0.24, travel = L * 3, apex = H * 0.35;
  const xm = W * j.x01, xe = xm - (j.dir * travel) / 2, xi = xm + (j.dir * travel) / 2;
  // wake: a faint bright streak along the surface between exit and entry
  const wk = Math.max(0, 1 - age / (JUMP_S + SPLASH_S));
  ctx.strokeStyle = css(p.cream, 0.2 * wk); ctx.lineWidth = Math.max(1.4, L * 0.05);
  ctx.beginPath(); ctx.moveTo(xe, yw); ctx.lineTo(xe + (xi - xe) * Math.min(1, age / JUMP_S + 0.15), yw); ctx.stroke();
  splash(ctx, xe, yw, age, L, p, j.id * 7 + 1, L * 0.3);
  splash(ctx, xi, yw, age - JUMP_S, L, p, j.id * 7 + 4, L * 0.3);
  if (age < 0 || age > JUMP_S) return;
  const q = age / JUMP_S;
  const x = xe + (xi - xe) * q, y = yw - 4 * apex * q * (1 - q);
  const vx = (xi - xe) / JUMP_S, vy = (-4 * apex * (1 - 2 * q)) / JUMP_S;
  radial(ctx, x, y, L * 0.95, p.warm, 0.45);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(vy, vx));
  if (vx < 0) ctx.scale(1, -1);
  // tail (forked), dorsal fin, body, warm belly, eye
  ctx.fillStyle = css(p.cream);
  ctx.beginPath();
  ctx.moveTo(-L * 0.4, 0); ctx.lineTo(-L * 0.82, -L * 0.3); ctx.lineTo(-L * 0.66, 0); ctx.lineTo(-L * 0.82, L * 0.3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-L * 0.08, -L * 0.24); ctx.lineTo(-L * 0.24, -L * 0.46); ctx.lineTo(-L * 0.3, -L * 0.2); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, L / 2, L * 0.28, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = css(p.warm, 0.95);
  ctx.beginPath(); ctx.ellipse(-L * 0.02, L * 0.12, L * 0.4, L * 0.13, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = css(p.deep);
  ctx.beginPath(); ctx.arc(L * 0.3, -L * 0.07, Math.max(1.5, L * 0.055), 0, TAU); ctx.fill();
  ctx.restore();
}
