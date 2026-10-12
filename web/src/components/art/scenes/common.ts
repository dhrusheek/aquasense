// Helpers shared by the six scenes. Every scene paints the night pond (bright things on a deep ground)
// into a W x H canvas in proportion to H, then the rasterizer turns it into glyphs or dots.
import { css, mixRgb, type ArtColours, type Rgb } from '../raster';

export type SceneName = 'waves' | 'float' | 'lamp' | 'mesh' | 'turbid' | 'bank';
export interface SceneOpts { state: 'green' | 'red' }
export type SceneFn = (ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: ArtColours, o: SceneOpts) => void;

export const TAU = Math.PI * 2;
/** Deterministic noise in 0..1. */
export const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Surface blue of the night pond (the scene's own, independent of the ink tokens). */
export const waterBlue = (p: ArtColours): Rgb => mixRgb(p.deep, [70, 130, 215], 0.62);

export function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(c, a));
  g.addColorStop(0.35, css(c, a * 0.45));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Deep sky down to the horizon, a few stars. */
export function sky(ctx: CanvasRenderingContext2D, W: number, H: number, hz: number, p: ArtColours) {
  ctx.fillStyle = css(p.deep);
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, css(p.deep));
  g.addColorStop(1, css(mixRgb(p.deep, waterBlue(p), 0.42)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, hz);
  const u = H / 100;
  for (let i = 0; i < 26; i++) {
    const x = hash(i) * W, y = hash(i + 50) * hz * 0.8;
    ctx.fillStyle = css(p.cream, 0.35 + 0.4 * hash(i + 9));
    ctx.fillRect(x, y, u * 0.9, u * 0.9);
  }
}

export function moon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: ArtColours) {
  radial(ctx, x, y, r * 4.2, p.cream, 0.4);
  ctx.fillStyle = css(p.cream);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/** Layered sine waves from the horizon down; deeper layers are taller, faster and darker. */
export function water(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: ArtColours, hz: number, opt: { layers?: number; amp?: number; speed?: number } = {}) {
  const u = H / 100, layers = opt.layers ?? 6, A0 = opt.amp ?? 1, sp = opt.speed ?? 1;
  const wb = waterBlue(p);
  const g = ctx.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, css(mixRgb(p.deep, wb, 0.55)));
  g.addColorStop(1, css(mixRgb(p.deep, wb, 0.12)));
  ctx.fillStyle = g;
  ctx.fillRect(0, hz, W, H - hz);
  ctx.lineWidth = Math.max(1.5, u * 1.4);
  for (let i = 0; i < layers; i++) {
    const k = i / (layers - 1 || 1);
    const y0 = hz + (H - hz) * (0.03 + 0.92 * k * k);
    const A = (0.5 + 2.4 * k) * u * A0, wl = W * (0.34 - 0.18 * k);
    ctx.beginPath();
    for (let x = 0; x <= W + 4; x += 4) {
      const y = y0 + A * Math.sin((x / wl) * TAU + t * sp * (0.5 + k) + i * 1.9) + A * 0.35 * Math.sin((x / wl) * TAU * 2.3 - t * sp * 0.8 + i);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = css(mixRgb(wb, p.cream, 0.25 + 0.3 * (1 - k)), 0.5 + 0.35 * (1 - k));
    ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = css(mixRgb(p.deep, wb, 0.45 - 0.3 * k), 0.55);
    ctx.fill();
  }
}

/** Moon glints: short bright dashes on the water below (x, hz). */
export function glints(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: ArtColours, x: number, hz: number, c: Rgb = p.cream) {
  const u = H / 100, n = 14;
  for (let j = 0; j < n; j++) {
    const k = (j + 1) / n, y = hz + (H - hz) * (0.04 + 0.9 * k * k);
    const w = (3 + 11 * k) * u * (0.6 + 0.4 * Math.sin(t * 1.9 + j * 2.1));
    const cx = x + Math.sin(t * 1.1 + j * 1.3) * 3 * u * k;
    ctx.fillStyle = css(c, 0.8 * (1 - k * 0.5));
    ctx.fillRect(cx - w / 2, y, w, Math.max(1.2, u * 1.6));
  }
  void W;
}
