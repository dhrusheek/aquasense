import { glints, moon, sky, water, type SceneFn } from './common';

/** The pond surface: layered sine waves under a low moon, glints on the water. */
export const drawWaves: SceneFn = (ctx, W, H, t, p) => {
  const hz = H * 0.4, mx = W * 0.72;
  sky(ctx, W, H, hz, p);
  moon(ctx, mx, hz * 0.52, H * 0.075, p);
  water(ctx, W, H, t, p, hz);
  glints(ctx, W, H, t, p, mx, hz);
};
