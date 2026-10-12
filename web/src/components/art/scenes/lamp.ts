import { css, mixRgb } from '../raster';
import { TAU, glints, radial, sky, water, type SceneFn } from './common';

/** The dock lamp at night, glowing green or red, its light on the water. */
export const drawLamp: SceneFn = (ctx, W, H, t, p, o) => {
  const u = H / 100, hz = H * 0.55, cx = W * 0.5;
  const c = o.state === 'red' ? p.bad : p.ok;
  const hot = mixRgb(c, [255, 255, 255], 0.45);
  sky(ctx, W, H, hz, p);
  water(ctx, W, H, t, p, hz, { layers: 4, amp: 0.7 });
  const ly = H * 0.3, pulse = 1 + 0.06 * Math.sin(t * 2.2);
  // reflection column and halo
  glints(ctx, W, H, t, p, cx, hz, hot);
  radial(ctx, cx, ly, 52 * u * pulse, c, 0.55);
  radial(ctx, cx, ly, 22 * u * pulse, hot, 0.65);
  // dock: planks along the bottom, a post up to the lamp
  ctx.fillStyle = css(p.cream, 0.55);
  ctx.fillRect(0, H * 0.84, W, 2 * u);
  ctx.fillStyle = css(p.deep);
  ctx.fillRect(0, H * 0.84 + 2 * u, W, H);
  ctx.fillStyle = css(p.cream, 0.4);
  for (let x = 0; x < W; x += 9 * u) ctx.fillRect(x, H * 0.84 + 2 * u, Math.max(1, 0.5 * u), H);
  ctx.fillStyle = css(p.cream, 0.7);
  ctx.fillRect(cx - 1.4 * u, ly + 5 * u, 2.8 * u, H * 0.84 - ly - 5 * u);
  // lamp head
  ctx.fillStyle = css(p.cream, 0.9);
  ctx.beginPath(); ctx.roundRect(cx - 5 * u, ly - 6 * u, 10 * u, 12 * u, 2 * u); ctx.fill();
  ctx.fillStyle = css(hot);
  ctx.beginPath(); ctx.arc(cx, ly, 3.6 * u, 0, TAU); ctx.fill();
};
