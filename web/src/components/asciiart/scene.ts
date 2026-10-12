// The picture behind the landing-page ASCII art (spec 06 §4.2): a farmer on the bank of a fish
// pond at dusk, the farm office with its two-lamp status light, four glowing sensor nodes and the
// packets that run between them. Everything is a canvas path drawn at GRID resolution (one cell =
// 4 x 8 picture pixels), then turned into characters by rasterize.ts. The hex values below are the
// scene's own drawing constants (sky, silhouettes, warm dawn); the status lamps and the node
// markers take their colour from the theme tokens passed in.

export type LightState = 'green' | 'red' | 'hot' | 'stale' | 'test' | 'off';
export type Rgb = readonly [number, number, number];

export interface SceneTokens {
  ok: Rgb;
  bad: Rgb;
  /** N1..N4 */
  n: readonly [Rgb, Rgb, Rgb, Rgb];
}

/** The picture is one cell = COLPX x ROWPX pixels. */
export const COLPX = 4;
export const ROWPX = 8;

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const hash = (a: number, b = 0) => frac(Math.sin(a * 127.1 + b * 311.7 + 17.3) * 43758.5453);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: Rgb = [255, 255, 255];
const rgba = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/** Node colours on the dark picture: lifted until they glow, whatever the theme's own value is. */
function lift(c: Rgb, minL = 0.62): Rgb {
  const L = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return L >= minL ? c : mix(c, WHITE, clamp01((minL - L) / (1 - L)));
}

/* ---------- geometry (u, v in [0, 1] of the picture) ---------- */

export interface Layout {
  PW: number;
  PH: number;
  /** Size unit: the width, or 1.5 x the height on a tall (phone) picture so shapes keep their weight. */
  UN: number;
  /** Tall picture: the horizon sits lower so the headline has sky to sit on. */
  narrow: boolean;
  /** Horizontal zoom: a tall picture shows the right-hand 78 % of the scene, larger. */
  sx: number;
}

export function layoutOf(PW: number, PH: number): Layout {
  const narrow = PW / PH < 1.3;
  return { PW, PH, UN: Math.max(PW, PH * 1.5), narrow, sx: narrow ? 1 / 0.78 : 1 };
}

const X = (L: Layout, u: number) => (L.narrow ? (u - 0.22) * L.sx : u) * L.PW;
const Y = (L: Layout, v: number) => (L.narrow ? 0.12 + 0.88 * v : v) * L.PH;

/** The near bank's top edge, as v at u (a rise from the bottom of the pond to the farm office). */
const BANK: readonly (readonly [number, number])[] = [
  [0.56, 1.0], [0.64, 0.93], [0.72, 0.86], [0.8, 0.8], [0.86, 0.77], [1.0, 0.76],
];
function bankV(u: number): number {
  if (u <= BANK[0][0]) return BANK[0][1];
  for (let i = 1; i < BANK.length; i++) {
    if (u <= BANK[i][0]) {
      const [u0, v0] = BANK[i - 1], [u1, v1] = BANK[i];
      return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
    }
  }
  return BANK[BANK.length - 1][1];
}

export type NodeKey = 0 | 1 | 2 | 3;
/** Node markers (u, v) and where the label goes, in cells from the marker. */
const NODE_POS: readonly (readonly [number, number])[] = [[0.45, 0.64], [0.27, 0.7], [0.58, 0.575], [0.9, 0.6]];
const LABEL_AT: readonly (readonly [number, number])[] = [[3, 0], [3, 0], [3, -1], [-1, 3]];

export interface NodeLabel { id: string; x: number; y: number; col: number; row: number; k: NodeKey }

/** Marker position in picture pixels and the cell of the label's first character. */
export function nodeLabels(PW: number, PH: number): NodeLabel[] {
  const L = layoutOf(PW, PH);
  return NODE_POS.map(([u, v], k) => {
    const x = X(L, u), y = Y(L, v);
    return {
      id: `N${k + 1}`, x, y, k: k as NodeKey,
      col: Math.round(x / COLPX) + LABEL_AT[k][0],
      row: Math.round(y / ROWPX) + LABEL_AT[k][1],
    };
  });
}

/* ---------- drawing ---------- */

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: Rgb, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(0.4, rgba(c, a * 0.4));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
}

const CLOUDS: readonly (readonly [number, number, number])[] = [
  [0.55, 0.13, 0.22], [0.8, 0.08, 0.16], [0.92, 0.26, 0.14], [0.6, 0.36, 0.12], [0.16, 0.47, 0.15],
];
const SUN_U = 0.725, SUN_V = 0.5;

function drawCloud(ctx: CanvasRenderingContext2D, L: Layout, i: number, t: number) {
  const [u0, v, w] = CLOUDS[i];
  const span = 1.5;
  const u = ((u0 + 0.012 * t + 0.25) % span + span) % span - 0.25; // wraps over [-0.25, 1.25]
  const cx = X(L, u), cy = Y(L, v);
  const half = w * L.PW * 0.5 * L.sx;
  const scale = (w / 0.18) * L.UN;
  const warm = i === 3;
  // flat underside first
  ctx.fillStyle = 'rgba(120,160,215,.5)';
  ellipse(ctx, cx, cy + 0.032 * scale, half * 1.12, 0.032 * scale * 1.1);
  ctx.fill();
  for (let k = 0; k < 7; k++) {
    const s = k / 6;
    const h1 = hash(i + 1, k), h2 = hash(i + 7, k + 3), h3 = hash(i + 13, k + 9);
    const mid = 1 - Math.abs(s * 2 - 1);
    const rx = (0.026 + 0.03 * h3) * scale * (0.7 + 0.5 * mid);
    const px = cx + (s - 0.5) * half * 2 + (h1 - 0.5) * 0.02 * scale;
    const py = cy - mid * rx * 0.55 - h2 * 0.012 * scale;
    ctx.fillStyle = k < 2 || k > 5 ? 'rgba(165,195,232,.7)' : 'rgba(240,245,252,.96)';
    ellipse(ctx, px, py, rx, rx * 0.52);
    ctx.fill();
    if (warm && s > 0.35) {
      ctx.fillStyle = 'rgba(255,214,170,.6)';
      ellipse(ctx, px + rx * 0.25, py + rx * 0.06, rx * 0.8, rx * 0.4);
      ctx.fill();
    }
  }
}

function lampLevel(state: LightState, which: 'red' | 'green', t: number): number {
  const blink = 0.5 + 0.5 * Math.sign(Math.sin(TAU * t));
  switch (state) {
    case 'green': return which === 'green' ? 1 : 0;
    case 'red': return which === 'red' ? 1 : 0;
    case 'hot': return which === 'red' ? blink : 0;
    case 'stale': return which === 'green' ? blink : 0;
    case 'test': {
      const even = Math.floor(t) % 2 === 0;
      return (which === 'red') === even ? 1 : 0;
    }
    default: return 0;
  }
}

/** Where the packet is at time t: the position and its progress along the current hop. */
const HOPS: readonly (readonly [number, number, number, number])[] = [
  // from node, to node, start s, end s
  [0, 2, 0, 1.6], [2, 3, 1.6, 2.6], [1, 2, 3.2, 4.8], [2, 3, 4.8, 5.8],
];
const PERIOD = 6.4;

export function drawScene(
  ctx: CanvasRenderingContext2D, PW: number, PH: number, t: number, tokens: SceneTokens, state: LightState,
): void {
  const L = layoutOf(PW, PH);
  const { UN } = L;
  const x = (u: number) => X(L, u);
  const y = (v: number) => Y(L, v);
  const horizon = y(0.58);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* sky */
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#060D1F');
  sky.addColorStop(0.38, '#0B2A5E');
  sky.addColorStop(0.7, '#1B72C4');
  sky.addColorStop(1, '#5FB8F0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, PW, PH);

  /* ground: everything under the horizon is dark until the pond and the banks paint over it */
  const ground = ctx.createLinearGradient(0, horizon, 0, PH);
  ground.addColorStop(0, '#0A2240');
  ground.addColorStop(1, '#050F22');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon - 2, PW, PH - horizon + 2);

  /* stars, top-left, behind the headline */
  for (let i = 0; i < 34; i++) {
    const sx = hash(i, 1) * 0.6 * PW, sy = hash(i, 2) * 0.5 * PH;
    const a = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(TAU * (t / (2.2 + 2 * hash(i, 3))) + i));
    ctx.fillStyle = `rgba(214,232,255,${a * (1 - sy / (0.5 * PH)) })`;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), 3, 3);
  }

  /* dawn glow and sun */
  ctx.save();
  ctx.translate(x(0.74), y(0.58));
  ctx.scale(0.46 * PW, 0.34 * PH);
  const dawn = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  dawn.addColorStop(0, 'rgba(255,176,112,.95)');
  dawn.addColorStop(0.45, 'rgba(255,140,80,.38)');
  dawn.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = dawn;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  const sx = x(SUN_U), sy = y(SUN_V), sr = 0.034 * UN;
  glow(ctx, sx, sy, sr * 3, [255, 200, 140], 0.6);
  ctx.fillStyle = '#FFE2B8';
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.fill();

  /* clouds */
  for (let i = 0; i < CLOUDS.length; i++) drawCloud(ctx, L, i, t);

  /* far bank with a few trees */
  ctx.fillStyle = '#0A2240';
  ctx.beginPath();
  ctx.moveTo(0, y(0.6));
  for (let k = 0; k <= 48; k++) {
    const u = k / 48;
    ctx.lineTo(x(u), y(0.553 + 0.012 * Math.sin(6 * Math.PI * u)));
  }
  ctx.lineTo(PW, y(0.6));
  ctx.closePath();
  ctx.fill();
  const TREES: readonly (readonly [number, number, number])[] = [
    [0.05, 0.03, 0.07], [0.13, 0.026, 0.055], [0.21, 0.03, 0.08], [0.33, 0.024, 0.05], [0.4, 0.028, 0.07], [0.47, 0.022, 0.045],
  ];
  ctx.fillStyle = '#081C38';
  for (const [u, rw, h] of TREES) {
    ellipse(ctx, x(u), y(0.56) - h * PH * 0.5, rw * UN, h * PH * 0.62);
    ctx.fill();
  }

  /* pond */
  const pondTop = y(0.6), pondBot = PH;
  const water = ctx.createLinearGradient(0, pondTop, 0, pondBot);
  water.addColorStop(0, '#1C6FB8');
  water.addColorStop(0.6, '#0E3F80');
  water.addColorStop(1, '#082650');
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.moveTo(0, pondTop);
  ctx.lineTo(x(0.8), pondTop);
  ctx.lineTo(x(0.8), PH);
  ctx.lineTo(0, PH);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  // the sky in the water, and the dawn on it
  const refl = ctx.createLinearGradient(0, pondTop, 0, y(0.74));
  refl.addColorStop(0, 'rgba(90,185,245,.3)');
  refl.addColorStop(1, 'rgba(90,185,245,0)');
  ctx.fillStyle = refl;
  ctx.fillRect(0, pondTop, PW, y(0.74) - pondTop);
  ctx.save();
  ctx.translate(x(0.74), y(0.62));
  ctx.scale(0.3 * PW, 0.2 * PH);
  const dg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  dg.addColorStop(0, 'rgba(255,176,112,.7)');
  dg.addColorStop(1, 'rgba(255,140,80,0)');
  ctx.fillStyle = dg;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  // shimmer
  ctx.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const a = 0.3 + 0.3 * Math.sin(TAU * (t / 2.4) + i);
    const len = (0.04 + 0.06 * hash(i, 5)) * UN;
    const sxm = x(0.06 + 0.66 * hash(i, 6)), sym = y(0.63 + 0.3 * hash(i, 7));
    ctx.strokeStyle = `rgba(180,220,255,${a})`;
    ctx.beginPath();
    ctx.moveTo(sxm, sym);
    ctx.lineTo(sxm + len, sym);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = 0.35 + 0.3 * Math.sin(TAU * (t / 1.7) + i);
    const w = (0.05 - i * 0.004) * UN;
    const cy = y(0.615 + i * 0.03);
    ctx.strokeStyle = `rgba(255,190,120,${clamp01(a)})`;
    ctx.beginPath();
    ctx.moveTo(x(0.74) - w, cy);
    ctx.lineTo(x(0.74) + w, cy);
    ctx.stroke();
  }
  ctx.restore();

  /* reeds */
  ctx.strokeStyle = '#0E2E52';
  ctx.fillStyle = '#0E2E52';
  for (let i = 0; i < 9; i++) {
    const bx = x(0.03 + 0.012 * i + 0.004 * hash(i, 8));
    const by = y(0.63);
    const hgt = (0.08 + 0.06 * hash(i, 9)) * PH * 1.25;
    const sway = 1.5 * Math.sin(TAU * (t / 3) + i) + 2;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + sway * 0.2, by - hgt * 0.5, bx + sway, by - hgt);
    ctx.stroke();
    if (i % 2 === 0) {
      ellipse(ctx, bx + sway, by - hgt - 5, 3, 8);
      ctx.fill();
    }
  }

  /* near bank, with a rim of dawn light along its edge */
  ctx.fillStyle = '#07182F';
  ctx.beginPath();
  ctx.moveTo(x(BANK[0][0]), y(1) + 2);
  for (const [u, v] of BANK) ctx.lineTo(x(u), y(v));
  ctx.lineTo(PW, y(1) + 2);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();
  const lit = ctx.createLinearGradient(0, y(0.74), 0, y(1));
  lit.addColorStop(0, 'rgba(255,170,110,.55)');
  lit.addColorStop(0.35, 'rgba(255,170,110,.12)');
  lit.addColorStop(1, 'rgba(255,170,110,0)');
  ctx.fillStyle = lit;
  ctx.fillRect(0, y(0.74), PW, PH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,196,140,.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  BANK.forEach(([u, v], k) => (k ? ctx.lineTo(x(u), y(v)) : ctx.moveTo(x(u), y(v))));
  ctx.stroke();
  ctx.restore();

  /* ---- the nodes' links, under everything that stands on the water ---- */
  const nodes = nodeLabels(PW, PH);
  const pos = nodes.map((n) => [n.x, n.y] as const);
  ctx.save();
  for (const [a, b] of [[0, 2], [1, 2], [2, 3]] as const) {
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(170,215,255,.28)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(pos[a][0], pos[a][1]);
    ctx.lineTo(pos[b][0], pos[b][1]);
    ctx.stroke();
    ctx.setLineDash([9, 6]);
    ctx.lineDashOffset = -t * 9;
    ctx.strokeStyle = 'rgba(225,240,255,.95)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(pos[a][0], pos[a][1]);
    ctx.lineTo(pos[b][0], pos[b][1]);
    ctx.stroke();
  }
  ctx.restore();

  /* ---- the farm office ---- */
  const hx0 = x(0.865), hx1 = x(0.985), hTop = y(0.58), hBase = y(0.76);
  const apex: readonly [number, number] = [x(0.925), y(0.46)];
  ctx.fillStyle = '#061327';
  ctx.beginPath();
  ctx.rect(hx0, hTop, hx1 - hx0, hBase - hTop);
  ctx.fill();
  ctx.fillStyle = '#0A1B33';
  ctx.beginPath();
  ctx.moveTo(hx0 - 0.012 * UN, hTop + 1);
  ctx.lineTo(apex[0], apex[1]);
  ctx.lineTo(hx1 + 0.012 * UN, hTop + 1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,130,.6)'; // the roof's sunward edge
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx0 - 0.012 * UN, hTop + 1);
  ctx.lineTo(apex[0], apex[1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,190,130,.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx0, hTop);
  ctx.lineTo(hx0, hBase);
  ctx.stroke();
  ctx.fillStyle = '#0D2140'; // door
  ctx.fillRect(x(0.9), y(0.65), x(0.935) - x(0.9), hBase - y(0.65));
  const wx0 = x(0.952), wx1 = x(0.974), wy0 = y(0.62), wy1 = y(0.68);
  glow(ctx, (wx0 + wx1) / 2, (wy0 + wy1) / 2, 0.05 * UN, [255, 208, 137], 0.55);
  ctx.fillStyle = '#FFD089';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);

  /* status light on a pole: two lamps, red over green, never a yellow one */
  const lx = x(0.8), lampR = 8, gap = 2.4 * ROWPX;
  const top = y(0.575);
  const housing = 2 * lampR + 9 + gap + 2;
  ctx.strokeStyle = '#061327';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(lx, top + housing - 2);
  ctx.lineTo(lx, y(bankV(0.8)) + 4);
  ctx.stroke();
  ctx.fillStyle = '#0B1A30';
  ctx.beginPath();
  ctx.roundRect(lx - lampR - 5, top - 2, 2 * lampR + 10, housing, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,190,130,.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const lamps: readonly ['red' | 'green', Rgb][] = [['red', tokens.bad], ['green', tokens.ok]];
  lamps.forEach(([which, c], i) => {
    const ly = top + lampR + 3 + i * gap;
    const lit = lampLevel(state, which, t);
    ctx.fillStyle = rgba(mix(c, [16, 24, 42], 0.72)); // unlit: the lens, dark
    ctx.beginPath();
    ctx.arc(lx, ly, lampR, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,205,250,.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (lit > 0) {
      glow(ctx, lx, ly, lampR * 3.4, c, 0.9 * lit);
      ctx.fillStyle = rgba(mix(c, WHITE, 0.15), lit);
      ctx.beginPath();
      ctx.arc(lx, ly, lampR, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(mix(c, WHITE, 0.7), lit);
      ctx.beginPath();
      ctx.arc(lx - lampR * 0.2, ly - lampR * 0.25, lampR * 0.45, 0, TAU);
      ctx.fill();
    }
  });

  /* ---- the farmer on the near bank, facing the water, rod out ---- */
  const farmerShape = (fx: number, fy: number, H: number) => {
  ctx.lineCap = 'round';
  // legs
  ctx.lineWidth = 0.085 * H;
  ctx.beginPath();
  ctx.moveTo(fx - 0.04 * H, fy - 0.36 * H); ctx.lineTo(fx - 0.11 * H, fy);
  ctx.moveTo(fx + 0.04 * H, fy - 0.36 * H); ctx.lineTo(fx + 0.1 * H, fy);
  ctx.stroke();
  // torso
  ctx.beginPath();
  ctx.moveTo(fx - 0.15 * H, fy - 0.74 * H);
  ctx.lineTo(fx + 0.13 * H, fy - 0.74 * H);
  ctx.lineTo(fx + 0.11 * H, fy - 0.33 * H);
  ctx.lineTo(fx - 0.12 * H, fy - 0.33 * H);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.arc(fx - 0.01 * H, fy - 0.82 * H, 0.085 * H, 0, TAU);
  ctx.fill();
  // straw hat: brim and cone
  ellipse(ctx, fx - 0.01 * H, fy - 0.885 * H, 0.23 * H, 0.04 * H);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(fx - 0.01 * H, fy - 1.04 * H);
  ctx.lineTo(fx - 0.15 * H, fy - 0.88 * H);
  ctx.lineTo(fx + 0.13 * H, fy - 0.88 * H);
  ctx.closePath();
  ctx.fill();
  // arm and rod
  const hand: readonly [number, number] = [fx - 0.2 * H, fy - 0.58 * H];
  ctx.lineWidth = 0.07 * H;
  ctx.beginPath();
  ctx.moveTo(fx - 0.08 * H, fy - 0.7 * H);
  ctx.lineTo(hand[0], hand[1]);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(hand[0] + 0.1 * H, hand[1] + 0.06 * H);
  ctx.lineTo(tip[0], tip[1]);
  ctx.stroke();
  };
  const fx = x(0.7), fy = y(bankV(0.7)) + 3, H = 0.34 * PH * (L.narrow ? 0.85 : 1);
  const tip: readonly [number, number] = [x(0.625), fy - 0.72 * H - 0.04 * PH];
  // dawn rim on the sunward side, then the silhouette
  ctx.fillStyle = 'rgba(255,196,140,.85)';
  ctx.strokeStyle = 'rgba(255,196,140,.85)';
  farmerShape(fx + 2.5, fy, H);
  ctx.fillStyle = '#061327';
  ctx.strokeStyle = '#061327';
  farmerShape(fx - 1, fy, H);
  // line and bobber
  const water0 = y(0.79);
  ctx.strokeStyle = 'rgba(225,238,255,.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0], water0 + 2 * Math.sin(TAU * t / 1.8));
  ctx.stroke();
  ctx.fillStyle = '#FFB070';
  ctx.beginPath();
  ctx.arc(tip[0], water0 + 2 * Math.sin(TAU * t / 1.8), 3.2, 0, TAU);
  ctx.fill();

  /* ---- fish ---- */
  const drawFish = (fxp: number, fyp: number, dir: 1 | -1, a: number) => {
    const rx = 0.034 * UN, ry = 0.016 * UN;
    ctx.fillStyle = `rgba(240,184,96,${a})`;
    ellipse(ctx, fxp, fyp, rx, ry);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(fxp - dir * rx * 0.8, fyp);
    ctx.lineTo(fxp - dir * rx * 1.6, fyp - ry * 1.3);
    ctx.lineTo(fxp - dir * rx * 1.6, fyp + ry * 1.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255,224,160,${a})`; // lighter belly
    ellipse(ctx, fxp + dir * rx * 0.1, fyp + ry * 0.4, rx * 0.7, ry * 0.4);
    ctx.fill();
    ctx.fillStyle = `rgba(20,30,50,${a})`;
    ctx.beginPath();
    ctx.arc(fxp + dir * rx * 0.55, fyp - ry * 0.2, 1.8, 0, TAU);
    ctx.fill();
  };
  drawFish(x(0.1 + 0.55 * frac(t / 14)), y(0.8 + 0.012 * Math.sin(TAU * t / 1.6)), 1, 1);
  drawFish(x(0.68 - 0.55 * frac(t / 19 + 0.4)), y(0.885 + 0.01 * Math.sin(TAU * t / 2.1)), -1, 0.6);

  /* ---- nodes: posts, markers, glow, radio rings ---- */
  const cols = tokens.n.map((c) => lift(c));
  // posts
  ctx.strokeStyle = '#061327';
  ctx.lineWidth = 3.5;
  const post = (k: number, toV: number) => {
    ctx.beginPath();
    ctx.moveTo(pos[k][0], pos[k][1]);
    ctx.lineTo(pos[k][0], y(toV));
    ctx.stroke();
  };
  post(0, 0.74);
  post(2, 0.64);
  ctx.beginPath(); // N2 hangs from its float
  ctx.moveTo(pos[1][0], pos[1][1]);
  ctx.lineTo(pos[1][0], y(0.78));
  ctx.stroke();
  ctx.fillStyle = '#0A1B33';
  ellipse(ctx, pos[1][0], pos[1][1] + 0.012 * UN, 0.026 * UN, 0.012 * UN);
  ctx.fill();
  for (let k = 0; k < 4; k++) {
    const c = cols[k];
    const [px, py] = pos[k];
    const phase = frac((t + k * 0.6) / 2.4);
    ctx.strokeStyle = rgba(c, (1 - phase) * 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, (0.014 + 0.035 * phase) * UN, 0, TAU);
    ctx.stroke();
    glow(ctx, px, py, 0.075 * UN, c, 1);
    glow(ctx, px, py, 0.035 * UN, mix(c, WHITE, 0.5), 1);
    ctx.fillStyle = rgba(mix(c, WHITE, 0.6));
    ctx.beginPath();
    ctx.arc(px, py, 0.015 * UN, 0, TAU);
    ctx.fill();
  }

  /* ---- packets ---- */
  const ts = t % PERIOD;
  for (const [a, b, s0, s1] of HOPS) {
    for (let d = 0; d < 4; d++) {
      const tt = ts - d * 0.06;
      if (tt < s0 || tt > s1) continue;
      const p = (tt - s0) / (s1 - s0);
      const px = pos[a][0] + (pos[b][0] - pos[a][0]) * p;
      const py = pos[a][1] + (pos[b][1] - pos[a][1]) * p;
      const al = d === 0 ? 1 : 0.5 / d;
      glow(ctx, px, py, 0.05 * UN, [200, 230, 255], 1 * al);
      ctx.fillStyle = `rgba(221,240,255,${al})`;
      ctx.beginPath();
      ctx.arc(px, py, (d === 0 ? 0.013 : 0.009) * UN, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}
