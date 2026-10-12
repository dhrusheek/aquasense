import { css, mixRgb } from '../raster';
import { TAU, hash, moon, sky, water, waterBlue, type SceneFn } from './common';

/** One float bobbing on the waves, a small antenna sending, bubbles rising. */
export const drawFloat: SceneFn = (ctx, W, H, t, p) => {
  const u = H / 100, hz = H * 0.46, cx = W * 0.5;
  sky(ctx, W, H, hz, p);
  moon(ctx, W * 0.82, hz * 0.45, H * 0.06, p);
  water(ctx, W, H, t, p, hz, { layers: 3, amp: 0.8 });
  const bob = Math.sin(t * 1.4) * 1.3 * u, tilt = Math.sin(t * 1.1 + 1) * 0.06;
  const wl = hz + H * 0.17 + bob; // waterline at the float
  ctx.save();
  ctx.translate(cx, wl);
  ctx.rotate(tilt);
  // body: pale cylinder with a warm band, the lower part under water
  const bw = 11 * u, bh = 21 * u;
  ctx.fillStyle = css(p.cream);
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh, bw, bh + 4 * u, bw * 0.35); ctx.fill();
  ctx.fillStyle = css(p.warm);
  ctx.fillRect(-bw / 2, -bh * 0.55, bw, 2.6 * u);
  // antenna and its tip
  ctx.strokeStyle = css(p.cream, 0.9); ctx.lineWidth = Math.max(1.2, 0.9 * u);
  ctx.beginPath(); ctx.moveTo(0, -bh); ctx.lineTo(0, -bh - 14 * u); ctx.stroke();
  ctx.fillStyle = css(p.warm); ctx.beginPath(); ctx.arc(0, -bh - 14 * u, 1.4 * u, 0, TAU); ctx.fill();
  // radio arcs leaving the tip
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.55 + i / 3) % 1, r = (2 + ph * 16) * u;
    ctx.strokeStyle = css(p.cool, 0.85 * (1 - ph)); ctx.lineWidth = Math.max(1.2, 0.9 * u);
    ctx.beginPath(); ctx.arc(0, -bh - 14 * u, r, -TAU * 0.42, -TAU * 0.08); ctx.stroke();
  }
  ctx.restore();
  // water in front of the float's foot
  const wb = waterBlue(p);
  ctx.fillStyle = css(mixRgb(p.deep, wb, 0.45), 0.8);
  ctx.fillRect(cx - 7 * u, wl + 1.2 * u, 14 * u, H - wl);
  ctx.strokeStyle = css(p.cream, 0.55); ctx.lineWidth = Math.max(1.2, u);
  ctx.beginPath(); ctx.ellipse(cx, wl + 1.4 * u, 7 * u, 1.2 * u, 0, 0, TAU); ctx.stroke();
  // bubbles
  for (let i = 0; i < 9; i++) {
    const ph = (t * (0.12 + 0.07 * hash(i)) + hash(i + 3)) % 1;
    const x = cx + (hash(i + 20) - 0.5) * 34 * u + Math.sin(ph * 12 + i) * 1.2 * u;
    const y = H - ph * (H - hz - 2 * u), r = (0.7 + 1.2 * hash(i + 40)) * u;
    ctx.strokeStyle = css(p.cream, 0.7 * (1 - ph * 0.6)); ctx.lineWidth = Math.max(1, 0.6 * u);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
};
