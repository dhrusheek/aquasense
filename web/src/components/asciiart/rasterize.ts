// Picture -> characters (spec 06 §4.2). The scene is drawn at grid resolution (one cell = 4 x 8
// pixels); every cell is averaged to one colour and one brightness, the brightness picks a glyph
// from a density ramp, the colour tints it, and a blurred copy of the characters is added back
// for bloom. Per frame the work is: one scene draw, one 4 x 8 box average, one glyph blit per cell
// whose glyph changed, two canvas copies and one small blurred copy.
import { COLPX, ROWPX, type NodeLabel } from './scene';

/** Sparse to dense. */
export const RAMP = ' .:-=+*%#@';
/** Brightness gain before the ramp and a lift of the tint, so a dusk picture still prints as bright characters. */
const GAIN = 1.5;
const TINT = 1.25;
const FONT = '"Geist Mono Variable", ui-monospace, Menlo, Consolas, monospace';

export interface GridSpec {
  fs: number;
  cols: number;
  rows: number;
  /** Cell size in CSS px (the grid is stretched to fill the canvas exactly). */
  cw: number;
  ch: number;
  PW: number;
  PH: number;
}

/** 0.6 em x 1.15 em cells; the font grows from `fs` until the grid is at most MAX_CELLS cells. */
const MAX_CELLS = 8200;
export function gridFor(W: number, H: number, fs: number): GridSpec {
  const at = (f: number) => [Math.max(8, Math.floor(W / (0.6 * f))), Math.max(6, Math.floor(H / (1.15 * f)))] as const;
  let f = fs;
  let [cols, rows] = at(f);
  while (cols * rows > MAX_CELLS && f < 28) {
    f += 0.5;
    [cols, rows] = at(f);
  }
  return { fs: f, cols, rows, cw: W / cols, ch: H / rows, PW: cols * COLPX, PH: rows * ROWPX };
}

export interface Cells {
  /** brightness 0..1 */
  lum: Float32Array;
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
}

export function makeCells(n: number): Cells {
  return { lum: new Float32Array(n), r: new Uint8ClampedArray(n), g: new Uint8ClampedArray(n), b: new Uint8ClampedArray(n) };
}

/**
 * Average each 4 x 8 block of the picture: the brightness is the plain mean; the colour is weighted
 * by brightness so a small glowing dot keeps its hue instead of being diluted by the dark around it.
 */
export function sampleCells(px: Uint8ClampedArray, PW: number, cols: number, rows: number, out: Cells): void {
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sl = 0, sr = 0, sg = 0, sb = 0, sw = 0;
      for (let j = 0; j < ROWPX; j++) {
        let o = ((cy * ROWPX + j) * PW + cx * COLPX) * 4;
        for (let i = 0; i < COLPX; i++, o += 4) {
          const r = px[o], g = px[o + 1], b = px[o + 2];
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const w = l + 12;
          sl += l; sr += r * w; sg += g * w; sb += b * w; sw += w;
        }
      }
      const k = cy * cols + cx;
      out.lum[k] = sl / (COLPX * ROWPX * 255);
      out.r[k] = sr / sw; out.g[k] = sg / sw; out.b[k] = sb / sw;
    }
  }
}

const canvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

export interface LabelColours { [k: number]: string }

export interface Raster {
  /** (Re)allocate for a canvas of W x H CSS px at the given device pixel ratio and font size. */
  resize(W: number, H: number, dpr: number, fs: number): GridSpec;
  /** Rebuild the glyph atlas (the mono font finished loading). */
  rebuildAtlas(): void;
  /** One frame: `draw` paints the picture, then it is turned into characters on the visible canvas. */
  frame(draw: (ctx: CanvasRenderingContext2D, PW: number, PH: number) => void, labels: NodeLabel[], colours: LabelColours, deep: string): void;
  grid(): GridSpec;
  dispose(): void;
}

export function createRaster(target: HTMLCanvasElement): Raster {
  const out = target.getContext('2d', { alpha: false })!;
  const canFilter = 'filter' in out;
  let g!: GridSpec;
  let dpr = 1, W = 0, H = 0;
  let pic: HTMLCanvasElement, pctx: CanvasRenderingContext2D;
  let cellC: HTMLCanvasElement, cellX: CanvasRenderingContext2D, cellImg: ImageData;
  let mask: HTMLCanvasElement, mctx: CanvasRenderingContext2D;
  let chars: HTMLCanvasElement, cctx: CanvasRenderingContext2D;
  let bloom: HTMLCanvasElement, bctx: CanvasRenderingContext2D;
  let atlas: HTMLCanvasElement;
  let tw = 1, th = 1;
  let cells: Cells;
  let prev: Uint8Array;
  let xs: Int32Array, ys: Int32Array;

  function rebuildAtlas() {
    const cwp = (W / g.cols) * dpr, chp = (H / g.rows) * dpr;
    tw = Math.ceil(cwp);
    th = Math.ceil(chp);
    atlas = canvas(tw * RAMP.length, th);
    const a = atlas.getContext('2d')!;
    a.fillStyle = '#fff';
    a.font = `500 ${g.fs * dpr}px ${FONT}`;
    a.textAlign = 'center';
    a.textBaseline = 'middle';
    for (let i = 1; i < RAMP.length; i++) a.fillText(RAMP[i], i * tw + tw / 2, th * 0.54);
    prev.fill(255); // every cell has to be blitted again
    mctx.clearRect(0, 0, mask.width, mask.height);
  }

  function resize(w: number, h: number, ratio: number, fs: number): GridSpec {
    W = w; H = h; dpr = ratio;
    g = gridFor(W, H, fs);
    target.width = Math.round(W * dpr);
    target.height = Math.round(H * dpr);
    pic = canvas(g.PW, g.PH);
    pctx = pic.getContext('2d', { willReadFrequently: true })!;
    cellC = canvas(g.cols, g.rows);
    cellX = cellC.getContext('2d')!;
    cellImg = cellX.createImageData(g.cols, g.rows);
    mask = canvas(target.width, target.height);
    mctx = mask.getContext('2d')!;
    chars = canvas(target.width, target.height);
    cctx = chars.getContext('2d')!;
    bloom = canvas(Math.ceil(W / 4), Math.ceil(H / 4));
    bctx = bloom.getContext('2d')!;
    cells = makeCells(g.cols * g.rows);
    prev = new Uint8Array(g.cols * g.rows);
    xs = new Int32Array(g.cols + 1);
    ys = new Int32Array(g.rows + 1);
    for (let i = 0; i <= g.cols; i++) xs[i] = Math.round((i * target.width) / g.cols);
    for (let j = 0; j <= g.rows; j++) ys[j] = Math.round((j * target.height) / g.rows);
    rebuildAtlas();
    return g;
  }

  function frame(draw: Parameters<Raster['frame']>[0], labels: NodeLabel[], colours: LabelColours, deep: string) {
    // 1. the picture
    draw(pctx, g.PW, g.PH);
    // 2. one colour and one brightness per cell
    sampleCells(pctx.getImageData(0, 0, g.PW, g.PH).data, g.PW, g.cols, g.rows, cells);
    // 3. glyph mask (only cells whose glyph changed) and colour layer
    const d = cellImg.data;
    const n = g.cols * g.rows;
    for (let k = 0; k < n; k++) {
      const L = Math.min(1, cells.lum[k] * GAIN);
      const idx = Math.min(RAMP.length - 1, Math.round(Math.pow(L, 0.8) * (RAMP.length - 1)));
      if (idx !== prev[k]) {
        prev[k] = idx;
        const c = k % g.cols, r = (k / g.cols) | 0;
        const x0 = xs[c], y0 = ys[r], w = xs[c + 1] - x0, h = ys[r + 1] - y0;
        mctx.clearRect(x0, y0, w, h);
        if (idx > 0) mctx.drawImage(atlas, idx * tw, 0, Math.min(w, tw), Math.min(h, th), x0, y0, Math.min(w, tw), Math.min(h, th));
      }
      const o = k * 4;
      const t = 0.25 * L; // colour lift toward white where it is bright
      d[o] = cells.r[k] * TINT + (255 - cells.r[k] * TINT) * t;
      d[o + 1] = cells.g[k] * TINT + (255 - cells.g[k] * TINT) * t;
      d[o + 2] = cells.b[k] * TINT + (255 - cells.b[k] * TINT) * t;
      d[o + 3] = (0.5 + 0.5 * L) * 255;
    }
    cellX.putImageData(cellImg, 0, 0);
    cctx.globalCompositeOperation = 'copy';
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(cellC, 0, 0, chars.width, chars.height);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask, 0, 0);
    cctx.globalCompositeOperation = 'source-over';

    // 4. composite: pool of --deep, the faint picture, bloom, characters
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.fillStyle = deep;
    out.fillRect(0, 0, target.width, target.height);
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'high';
    out.globalAlpha = canFilter ? 0.4 : 0.5;
    out.drawImage(pic, 0, 0, target.width, target.height);
    // bloom: the characters, shrunk and blurred, added back at full size
    bctx.clearRect(0, 0, bloom.width, bloom.height);
    bctx.imageSmoothingQuality = 'high';
    if (canFilter) bctx.filter = 'blur(1.6px)';
    bctx.drawImage(chars, 0, 0, bloom.width, bloom.height);
    if (canFilter) bctx.filter = 'none';
    out.globalCompositeOperation = 'lighter';
    out.globalAlpha = 0.9;
    out.drawImage(bloom, 0, 0, target.width, target.height);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.drawImage(chars, 0, 0);

    // 5. node labels, written over the characters on a --deep knockout
    out.font = `700 ${g.fs * dpr * 1.05}px ${FONT}`;
    out.textAlign = 'center';
    out.textBaseline = 'middle';
    for (const l of labels) {
      const c0 = Math.max(0, l.col), c1 = Math.min(g.cols, l.col + l.id.length);
      if (c1 <= c0) continue;
      const x0 = xs[Math.max(0, c0 - 1)], x1 = xs[Math.min(g.cols, c1 + 1)];
      const r = Math.max(0, Math.min(g.rows - 1, l.row));
      out.globalAlpha = 0.88;
      out.fillStyle = deep;
      out.fillRect(x0, ys[r], x1 - x0, ys[r + 1] - ys[r]);
      out.globalAlpha = 1;
      out.fillStyle = colours[l.k];
      for (let i = 0; i < l.id.length; i++) {
        const c = l.col + i;
        if (c < 0 || c >= g.cols) continue;
        out.fillText(l.id[i], (xs[c] + xs[c + 1]) / 2, (ys[r] + ys[r + 1]) / 2 + g.fs * dpr * 0.04);
      }
    }
  }

  return { resize, rebuildAtlas, frame, grid: () => g, dispose() { /* canvases are garbage collected */ } };
}
