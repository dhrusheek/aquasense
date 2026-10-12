import { DEFAULT_POS } from '@/lib/constants';
import { css } from '../raster';
import { TAU, radial, sky, type SceneFn } from './common';

const IDS = ['N1', 'N2', 'N3', 'N4'] as const;
const ROUTE: (typeof IDS[number])[] = ['N2', 'N3', 'N4']; // the primary route to the sink
const SIDE: (typeof IDS[number])[] = ['N1', 'N3'];

/** Four nodes at their real positions, packets running the primary route to the sink. */
export const drawMesh: SceneFn = (ctx, W, H, t, p) => {
  const u = H / 100;
  sky(ctx, W, H, H, p);
  const mx = Math.max(10 * u, W * 0.08), my = 13 * u;
  const sx = Math.min((W - 2 * mx) / 120, ((H - 2 * my) / 90) * 2.4), sy = (H - 2 * my) / 90;
  const at = (id: typeof IDS[number]) => {
    const [x, y] = DEFAULT_POS[id];
    return [W / 2 + (x - 60) * sx, my + y * sy] as const;
  };
  // faint radio neighbourhood
  ctx.setLineDash([3 * u, 3 * u]); ctx.lineWidth = Math.max(1, 0.5 * u);
  ctx.strokeStyle = css(p.cool, 0.35);
  for (const [a, b] of [['N1', 'N2'], ['N1', 'N3'], ['N2', 'N4']] as const) {
    const A = at(a), B = at(b); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
  }
  ctx.setLineDash([]);
  const path = (ids: typeof ROUTE, col: string, w: number) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
    ids.forEach((id, i) => { const q = at(id); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    ctx.stroke();
  };
  path(ROUTE, css(p.cream, 0.8), Math.max(1.5, 0.9 * u));
  path(SIDE, css(p.cream, 0.5), Math.max(1.2, 0.6 * u));
  // packets
  const travel = (ids: typeof ROUTE, off: number, col: typeof p.warm) => {
    const pts = ids.map(at), seg = pts.length - 1;
    const ph = ((t * 0.28 + off) % 1) * seg, i = Math.min(seg - 1, Math.floor(ph)), f = ph - i;
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
    radial(ctx, x, y, 7 * u, col, 0.9);
    ctx.fillStyle = css(col); ctx.beginPath(); ctx.arc(x, y, 1.7 * u, 0, TAU); ctx.fill();
  };
  travel(ROUTE, 0, p.warm); travel(ROUTE, 0.5, p.warm); travel(SIDE, 0.25, p.cool);
  // nodes: ring + core in the depth ramp, pulsing while a packet is near
  IDS.forEach((id, k) => {
    const [x, y] = at(id), c = p.n[k];
    radial(ctx, x, y, 11 * u, c, 0.45 + 0.1 * Math.sin(t * 2 + k));
    ctx.fillStyle = css(p.deep); ctx.beginPath(); ctx.arc(x, y, 4.4 * u, 0, TAU); ctx.fill();
    ctx.strokeStyle = css(c); ctx.lineWidth = Math.max(1.5, 1.1 * u); ctx.stroke();
    ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x, y, 2.3 * u, 0, TAU); ctx.fill();
  });
};
