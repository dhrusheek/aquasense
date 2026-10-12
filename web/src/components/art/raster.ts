// Artwork renderer: a thin adapter over the Home hero's pipeline (asciiart/rasterize.ts). A picture
// (an image or a procedural scene) is drawn to a small offscreen canvas, averaged to one brightness and
// one colour per cell, and turned into either glyphs from the shared RAMP and a cached atlas (`ascii`)
// or filled circles / squares (`dots` halftone, `dots-bayer` ordered dither).
import { RAMP, gridFor, makeCells, sampleCells, type Cells } from '../asciiart/rasterize';
import { COLPX, ROWPX } from '../asciiart/scene';

export type ArtMode = 'ascii' | 'dots' | 'dots-bayer';
export type ArtTint = 'ink' | 'night' | 'water';
export type ArtCell = 'xs' | 'sm' | 'md';
export type Rgb = [number, number, number];

/** Tokens resolved to numbers (the theme hook gives strings). */
export interface ArtColours {
  ink: Rgb; card: Rgb; deep: Rgb; water: Rgb; ok: Rgb; bad: Rgb; cream: Rgb; warm: Rgb; cool: Rgb;
  /** --n1..--n4 lifted to read on the deep ground (node depth ramp). */
  n: Rgb[];
}

export interface ArtGrid { cols: number; rows: number; PW: number; PH: number }

export interface PaintArgs {
  colours: ArtColours;
  tint: ArtTint;
  /** Seconds, drives the shimmer. */
  t: number;
  shimmer: boolean;
  /** 0..1, how much of the picture is revealed from the top (scan). */
  reveal: number;
  /** Swap light and dark (a photo on a light card prints its dark parts as ink). */
  invert: boolean;
  /** A photograph (gentle tone curve) rather than a scene (steeper, so glints and lamps stand out). */
  photo?: boolean;
}

export interface ArtEngine {
  resize(W: number, H: number, dpr: number, cell: ArtCell): ArtGrid;
  rebuildAtlas(): void;
  /** Draw the picture at (PW x PH) and average it into the cells. `normalize` stretches a photo's contrast. */
  sample(draw: (ctx: CanvasRenderingContext2D, PW: number, PH: number) => void, normalize: boolean): void;
  paint(a: PaintArgs): void;
  grid(): ArtGrid;
}

const FONT = '"Geist Mono Variable", ui-monospace, Menlo, Consolas, monospace';
const FS = { xs: 3.5, sm: 9, md: 12 } as const;
const DOT = { xs: 3, sm: 5, md: 7 } as const;
const BAYER_PX = { xs: 2, sm: 3, md: 4.5 } as const;
const MAX_CELLS = 8000;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const lumOf = (c: Rgb) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` to a triple. */
export function parseRgb(v: string | undefined, fallback: Rgb): Rgb {
  if (!v) return fallback;
  const s = v.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const r = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  return r ? [+r[1], +r[2], +r[3]] : fallback;
}

export const ART_TOKENS = ['--ink', '--card-fill', '--deep', '--water', '--ok', '--bad', '--n1', '--n2', '--n3', '--n4'];

/** Lift a dark tone toward white so it reads on the night ground. */
function lift(c: Rgb): Rgb {
  const L = lumOf(c);
  return L >= 0.62 ? c : mixRgb(c, [255, 255, 255], (0.62 - L) / (1 - L));
}

export function resolveColours(raw: Record<string, string>): ArtColours {
  const deep = parseRgb(raw['--deep'], [6, 13, 31]);
  return {
    ink: parseRgb(raw['--ink'], [16, 21, 43]),
    card: parseRgb(raw['--card-fill'], [255, 255, 255]),
    deep,
    water: parseRgb(raw['--water'], [16, 21, 43]),
    ok: parseRgb(raw['--ok'], [30, 158, 87]),
    bad: parseRgb(raw['--bad'], [215, 54, 43]),
    // the night pond palette: pale moonlight, lamp warmth, cool water
    n: ['--n1', '--n2', '--n3', '--n4'].map((k) => lift(parseRgb(raw[k], [150, 190, 230]))),
    cream: [244, 236, 214], warm: [255, 190, 110], cool: [140, 190, 240],
  };
}

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

/** Block average with any block size (sampleCells is fixed at 4 x 8). */
function sampleBlocks(px: Uint8ClampedArray, PW: number, cols: number, rows: number, bw: number, bh: number, out: Cells): void {
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sl = 0, sr = 0, sg = 0, sb = 0, sw = 0;
      for (let j = 0; j < bh; j++) {
        let o = ((cy * bh + j) * PW + cx * bw) * 4;
        for (let i = 0; i < bw; i++, o += 4) {
          const r = px[o], g = px[o + 1], b = px[o + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const w = l + 12;
          sl += l; sr += r * w; sg += g * w; sb += b * w; sw += w;
        }
      }
      const k = cy * cols + cx;
      out.lum[k] = sl / (bw * bh * 255);
      out.r[k] = sr / sw; out.g[k] = sg / sw; out.b[k] = sb / sw;
    }
  }
}

/** Palette bucket of a cell colour, so a dot layer needs five fills, not one per cell. */
function bucket(r: number, g: number, b: number): number {
  if (g > r * 1.15 && g > b * 1.05 && g - Math.min(r, b) > 28) return 1; // ok
  if (r > g * 1.5 && r > b * 1.5) return 2;                               // bad
  if (r > b * 1.22 && r - b > 26) return 3;                               // warm
  if (b > r * 1.15 && b - r > 22) return 4;                               // cool
  return 0;                                                                // cream
}

export function createArt(target: HTMLCanvasElement, mode: ArtMode): ArtEngine {
  const out = target.getContext('2d', { alpha: false })!;
  const canFilter = 'filter' in out;
  const ascii = mode === 'ascii';
  let g: ArtGrid = { cols: 1, rows: 1, PW: 4, PH: 8 };
  let W = 0, H = 0, dpr = 1, fs = 12, cellPx = 6, offX = 0, offY = 0;
  let pic: HTMLCanvasElement, pctx: CanvasRenderingContext2D;
  let cells: Cells;
  let phase: Float32Array;
  let tw = 1, th = 1;
  let atlas: HTMLCanvasElement;
  let mask: HTMLCanvasElement, mctx: CanvasRenderingContext2D;
  let chars: HTMLCanvasElement, cctx: CanvasRenderingContext2D;
  let cellC: HTMLCanvasElement, cellX: CanvasRenderingContext2D, cellImg: ImageData;
  let bloom: HTMLCanvasElement, bctx: CanvasRenderingContext2D;
  let prev: Uint8Array;
  let xs: Int32Array, ys: Int32Array;
  let dens: Float32Array;

  function rebuildAtlas() {
    if (!ascii || !prev) return;
    tw = Math.ceil((W / g.cols) * dpr);
    th = Math.ceil((H / g.rows) * dpr);
    atlas = makeCanvas(tw * RAMP.length, th);
    const a = atlas.getContext('2d')!;
    a.fillStyle = '#fff';
    a.font = `500 ${fs * dpr}px ${FONT}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    for (let i = 1; i < RAMP.length; i++) a.fillText(RAMP[i], i * tw + tw / 2, th * 0.54);
    prev.fill(255);
    mctx.clearRect(0, 0, mask.width, mask.height);
  }

  function resize(w: number, h: number, ratio: number, cell: ArtCell): ArtGrid {
    W = w; H = h; dpr = ratio;
    target.width = Math.round(W * dpr);
    target.height = Math.round(H * dpr);
    if (ascii) {
      const s = gridFor(W, H, FS[cell]);
      fs = s.fs;
      g = { cols: s.cols, rows: s.rows, PW: s.PW, PH: s.PH };
    } else {
      // square cells, a whole number of device pixels, at most MAX_CELLS of them
      let s = (mode === 'dots' ? DOT : BAYER_PX)[cell];
      for (;;) {
        s = Math.max(1, Math.round(s * dpr)) / dpr;
        if (Math.ceil(W / s) * Math.ceil(H / s) <= MAX_CELLS) break;
        s += 0.5 / dpr;
      }
      cellPx = s;
      const cols = Math.max(4, Math.ceil(W / s)), rows = Math.max(4, Math.ceil(H / s));
      offX = (W - cols * s) / 2; offY = (H - rows * s) / 2; // centred; the half cell that overhangs is cropped
      g = { cols, rows, PW: cols * 4, PH: rows * 4 };
    }
    const n = g.cols * g.rows;
    pic = makeCanvas(g.PW, g.PH);
    pctx = pic.getContext('2d', { willReadFrequently: true })!;
    cells = makeCells(n);
    dens = new Float32Array(n);
    phase = new Float32Array(n);
    for (let k = 0; k < n; k++) phase[k] = ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1 * 6.2832;
    if (ascii) {
      prev = new Uint8Array(n);
      cellC = makeCanvas(g.cols, g.rows);
      cellX = cellC.getContext('2d')!;
      cellImg = cellX.createImageData(g.cols, g.rows);
      mask = makeCanvas(target.width, target.height);
      mctx = mask.getContext('2d')!;
      chars = makeCanvas(target.width, target.height);
      cctx = chars.getContext('2d')!;
      bloom = makeCanvas(Math.ceil(W / 6), Math.ceil(H / 6));
      bctx = bloom.getContext('2d')!;
      xs = new Int32Array(g.cols + 1);
      ys = new Int32Array(g.rows + 1);
      for (let i = 0; i <= g.cols; i++) xs[i] = Math.round((i * target.width) / g.cols);
      for (let j = 0; j <= g.rows; j++) ys[j] = Math.round((j * target.height) / g.rows);
      rebuildAtlas();
    }
    return g;
  }

  function sample(draw: Parameters<ArtEngine['sample']>[0], normalize: boolean) {
    draw(pctx, g.PW, g.PH);
    const px = pctx.getImageData(0, 0, g.PW, g.PH).data;
    if (ascii) sampleCells(px, g.PW, g.cols, g.rows, cells);
    else sampleBlocks(px, g.PW, g.cols, g.rows, 4, 4, cells);
    if (!normalize) return;
    // photo contrast: stretch the 2nd..98th percentile to 0..1
    const n = g.cols * g.rows;
    const hist = new Uint32Array(256);
    for (let k = 0; k < n; k++) hist[Math.min(255, (cells.lum[k] * 255) | 0)]++;
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    const span = Math.max(24, hi - lo);
    for (let k = 0; k < n; k++) cells.lum[k] = clamp01((cells.lum[k] * 255 - lo) / span);
  }

  /** Per-cell density 0..1: how much ink / light the cell gets. */
  function density(a: PaintArgs, gain: number, gamma = 1, dead = 0) {
    const n = g.cols * g.rows;
    const edge = a.reveal < 1 ? a.reveal * g.rows : g.rows + 9;
    for (let k = 0; k < n; k++) {
      let L = cells.lum[k];
      if (a.shimmer) L *= 1 + 0.06 * Math.sin(phase[k] + a.t * 1.7);
      L = clamp01(L * gain);
      if (a.invert) L = 1 - L;
      if (gamma !== 1) L = Math.pow(L, gamma);
      if (dead) L = L < dead ? 0 : (L - dead) / (1 - dead);
      const row = (k / g.cols) | 0;
      if (row > edge) L = 0;
      else if (row > edge - 2 && a.reveal < 1) L = Math.max(L, 0.9);
      dens[k] = L;
    }
  }

  function ground(a: PaintArgs) {
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.fillStyle = css(a.tint === 'night' ? a.colours.deep : a.colours.card);
    out.fillRect(0, 0, target.width, target.height);
  }

  function paintAscii(a: PaintArgs) {
    const night = a.tint === 'night';
    const c = a.colours;
    const tone = a.tint === 'water' ? c.water : c.ink;
    const photoNight = night && a.photo;
    const GAIN = night ? (photoNight ? 1.05 : 2.6) : 1.15;
    density(a, GAIN);
    if (photoNight) {
      // mild S-curve, then a touch of highlight gamma, so outlines and chips separate
      for (let k = 0; k < dens.length; k++) {
        const L = dens[k], sc = L * L * (3 - 2 * L);
        dens[k] = Math.pow(L * 0.4 + sc * 0.6, 0.85);
      }
    }
    const d = cellImg.data;
    const n = g.cols * g.rows;
    for (let k = 0; k < n; k++) {
      const L = dens[k];
      const idx = Math.min(RAMP.length - 1, Math.round(Math.pow(L, 0.8) * (RAMP.length - 1)));
      if (idx !== prev[k]) {
        prev[k] = idx;
        const cc = k % g.cols, r = (k / g.cols) | 0;
        const x0 = xs[cc], y0 = ys[r], w = xs[cc + 1] - x0, h = ys[r + 1] - y0;
        mctx.clearRect(x0, y0, w, h);
        if (idx > 0) mctx.drawImage(atlas, idx * tw, 0, Math.min(w, tw), Math.min(h, th), x0, y0, Math.min(w, tw), Math.min(h, th));
      }
      const o = k * 4;
      if (night) {
        // moonlit cream, pulled toward the picture's own colour so lamps and water keep their hue
        const lift = 0.25 * L;
        const cr = Math.min(255, cells.r[k] * 1.25), cg = Math.min(255, cells.g[k] * 1.25), cb = Math.min(255, cells.b[k] * 1.25);
        d[o] = cr + (255 - cr) * lift;
        d[o + 1] = cg + (255 - cg) * lift;
        d[o + 2] = cb + (255 - cb) * lift;
        d[o + 3] = (0.5 + 0.5 * L) * 255;
      } else {
        d[o] = tone[0]; d[o + 1] = tone[1]; d[o + 2] = tone[2];
        d[o + 3] = (0.6 + 0.4 * L) * 255;
      }
    }
    cellX.putImageData(cellImg, 0, 0);
    cctx.globalCompositeOperation = 'copy';
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(cellC, 0, 0, chars.width, chars.height);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask, 0, 0);
    cctx.globalCompositeOperation = 'source-over';

    ground(a);
    if (night) {
      // the faint picture under the characters, then bloom (as the Home hero does)
      out.imageSmoothingEnabled = true;
      out.imageSmoothingQuality = 'high';
      out.globalAlpha = canFilter ? 0.35 : 0.45;
      out.drawImage(pic, 0, 0, target.width, target.height);
      bctx.clearRect(0, 0, bloom.width, bloom.height);
      bctx.imageSmoothingQuality = 'high';
      if (canFilter) bctx.filter = 'blur(1.1px)';
      bctx.drawImage(chars, 0, 0, bloom.width, bloom.height);
      if (canFilter) bctx.filter = 'none';
      out.globalCompositeOperation = 'lighter';
      out.globalAlpha = 0.9;
      out.drawImage(bloom, 0, 0, target.width, target.height);
      out.globalCompositeOperation = 'source-over';
      out.globalAlpha = 1;
    }
    out.drawImage(chars, 0, 0);
  }

  function paintDots(a: PaintArgs) {
    const night = a.tint === 'night';
    const c = a.colours;
    const bayer = mode === 'dots-bayer';
    density(a, 1.1, a.photo ? 1.05 : night ? 1 : 1.5, night ? 0.18 : 0);
    ground(a);
    out.setTransform(dpr, 0, 0, dpr, offX * dpr, offY * dpr);
    const s = cellPx;
    const fills: Rgb[] = night
      ? [c.cream, mixRgb(c.ok, [255, 255, 255], 0.35), mixRgb(c.bad, [255, 255, 255], 0.3), c.warm, c.cool]
      : [a.tint === 'water' ? c.water : c.ink];
    const paths = fills.map(() => new Path2D());
    const rmax = s * (night ? 0.72 : 0.48); // ink dots never touch
    for (let r = 0; r < g.rows; r++) {
      const sh = bayer ? 0 : (r & 1 ? 0.25 : -0.25);
      for (let col = 0; col < g.cols; col++) {
        const k = r * g.cols + col;
        const L = dens[k];
        if (L < 0.03) continue;
        const b = night ? bucket(cells.r[k], cells.g[k], cells.b[k]) : 0;
        const x = (col + 0.5 + sh) * s, y = (r + 0.5) * s;
        if (bayer) {
          if (L <= (BAYER[(r & 3) * 4 + (col & 3)] + 0.5) / 16) continue;
          paths[b].rect(x - s * 0.5 + s * 0.08, y - s * 0.5 + s * 0.08, s * 0.84, s * 0.84);
        } else {
          const rad = rmax * Math.sqrt(L);
          if (rad < 0.35) continue;
          paths[b].moveTo(x + rad, y);
          paths[b].arc(x, y, rad, 0, 6.2832);
        }
      }
    }
    for (let i = 0; i < paths.length; i++) {
      out.fillStyle = css(fills[i]);
      out.fill(paths[i]);
    }
  }

  return { resize, rebuildAtlas, sample, paint: (a) => (ascii ? paintAscii(a) : paintDots(a)), grid: () => g };
}

export { COLPX, ROWPX };
