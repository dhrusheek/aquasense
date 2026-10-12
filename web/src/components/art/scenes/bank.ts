import { css, mixRgb } from '../raster';
import { TAU, glints, moon, sky, water, type SceneFn } from './common';

/** A shore line, the bank node on a post, radio arcs spreading over the water. */
export const drawBank: SceneFn = (ctx, W, H, t, p) => {
  const u = H / 100, hz = H * 0.42;
  sky(ctx, W, H, hz, p);
  moon(ctx, W * 0.2, hz * 0.5, H * 0.06, p);
  water(ctx, W, H, t, p, hz, { layers: 4, amp: 0.8 });
  glints(ctx, W, H, t, p, W * 0.2, hz);
  // the bank: a rising shoreline on the right, with grass ticks
  const edge = (x: number) => H * 0.78 - (Math.max(0, x - W * 0.5) / (W * 0.5)) * H * 0.4 + Math.sin(x / (9 * u)) * 0.7 * u;
  ctx.beginPath(); ctx.moveTo(W * 0.5, H);
  for (let x = W * 0.5; x <= W; x += 4) ctx.lineTo(x, edge(x));
  ctx.lineTo(W, H); ctx.closePath();
  ctx.fillStyle = css(mixRgb(p.deep, p.cream, 0.1)); ctx.fill();
  ctx.strokeStyle = css(p.cream, 0.8); ctx.lineWidth = Math.max(1.4, u); ctx.beginPath();
  for (let x = W * 0.5; x <= W; x += 4) { if (x === W * 0.5) ctx.moveTo(x, edge(x)); else ctx.lineTo(x, edge(x)); }
  ctx.stroke();
  ctx.strokeStyle = css(p.cream, 0.45); ctx.lineWidth = Math.max(1, 0.6 * u);
  for (let x = W * 0.55; x < W; x += 5 * u) { const y = edge(x); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.8 * u, y - 2.6 * u); ctx.stroke(); }
  // post, node box, antenna
  const px = W * 0.7, py = edge(px);
  ctx.fillStyle = css(p.cream, 0.75); ctx.fillRect(px - 1.2 * u, py - 14 * u, 2.4 * u, 14 * u);
  ctx.fillStyle = css(p.cream); ctx.beginPath(); ctx.roundRect(px - 6 * u, py - 26 * u, 12 * u, 12 * u, 1.6 * u); ctx.fill();
  ctx.fillStyle = css(p.deep); ctx.fillRect(px - 4 * u, py - 23 * u, 8 * u, 4 * u);
  ctx.fillStyle = css(p.ok); ctx.beginPath(); ctx.arc(px + 2.4 * u, py - 21 * u, 1 * u, 0, TAU); ctx.fill();
  ctx.strokeStyle = css(p.cream); ctx.lineWidth = Math.max(1.2, 0.9 * u);
  const ay = py - 26 * u;
  ctx.beginPath(); ctx.moveTo(px - 3 * u, ay); ctx.lineTo(px - 3 * u, ay - 9 * u); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const ph = (t * 0.45 + i / 4) % 1, r = (3 + ph * 30) * u;
    ctx.strokeStyle = css(p.cool, 0.9 * (1 - ph)); ctx.lineWidth = Math.max(1.3, u);
    ctx.beginPath(); ctx.arc(px - 3 * u, ay - 9 * u, r, TAU * 0.5 + 0.25, TAU * 0.75 + 0.1); ctx.stroke();
  }
};
