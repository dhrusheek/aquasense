import { css, mixRgb } from '../raster';
import { TAU, hash, moon, sky, water, waterBlue, type SceneFn } from './common';

const PERIOD = 12;
/** Water in cross-section whose clarity drops and recovers over 12 s: a disc on a rod fades from view. */
export const drawTurbid: SceneFn = (ctx, W, H, t, p) => {
  const u = H / 100, hz = H * 0.24, cx = W * 0.5;
  const m = 0.5 - 0.5 * Math.cos((t / PERIOD) * TAU); // 0 clear .. 1 murky
  sky(ctx, W, H, hz, p);
  moon(ctx, W * 0.84, hz * 0.5, H * 0.045, p);
  water(ctx, W, H, t, p, hz, { layers: 2, amp: 0.7 });
  // the column of water below the surface
  const wb = waterBlue(p), silt = mixRgb(p.warm, p.deep, 0.55);
  ctx.fillStyle = css(mixRgb(p.deep, wb, 0.35), 1);
  ctx.fillRect(0, hz + 3 * u, W, H);
  // the bed: bright pebbles, seen only while the water is clear
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = css(p.cream, (1 - m) * (0.4 + 0.4 * hash(i)));
    const r = (0.8 + 1.8 * hash(i + 7)) * u;
    ctx.beginPath(); ctx.ellipse(hash(i + 1) * W, H - 3 * u - hash(i + 2) * 5 * u, r * 1.6, r, 0, 0, TAU); ctx.fill();
  }
  // a rod from the surface with a pale disc: the clarity test
  const dy = hz + (H - hz) * 0.5;
  ctx.fillStyle = css(p.cream, 0.35 + 0.65 * (1 - m));
  ctx.fillRect(cx - 0.8 * u, hz, 1.6 * u, dy - hz);
  ctx.fillStyle = css(p.cream, 0.08 + 0.92 * (1 - m) * (1 - m));
  ctx.beginPath(); ctx.ellipse(cx, dy, 11 * u, 3.4 * u, 0, 0, TAU); ctx.fill();
  // silt: haze plus drifting specks, thicker as m rises
  ctx.fillStyle = css(silt, 0.12 + 0.62 * m);
  ctx.fillRect(0, hz + 3 * u, W, H);
  for (let i = 0; i < 150; i++) {
    const x = (hash(i) * W + Math.sin(t * 0.5 + i) * 3 * u + t * (1 + hash(i + 9)) * u) % W;
    const y = hz + 4 * u + ((hash(i + 3) * (H - hz) + t * (0.8 + hash(i + 4)) * u * 2) % (H - hz - 5 * u));
    ctx.fillStyle = css(mixRgb(p.warm, p.cream, 0.4), m * (0.25 + 0.55 * hash(i + 5)));
    ctx.fillRect(x, y, 1.3 * u, 1.3 * u);
  }
};
