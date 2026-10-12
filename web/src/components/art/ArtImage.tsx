// Image -> artwork: a photo or screenshot drawn at the cell grid and printed as glyphs (`ascii`) or
// halftone dots (`dots`, `dots-bayer`). Also hosts ArtCanvas, the shared canvas component ArtScene uses.
import { useEffect, useMemo, useRef } from 'react';
import { useDpr, useElementSize, useReducedMotion, useThemeTokens } from '@/components/viz/hooks';
import { cn } from '@/lib/utils';
import { addJob, wake } from './loop';
import { ART_TOKENS, clamp01, createArt, resolveColours, type ArtCell, type ArtMode, type ArtTint } from './raster';
import type { SceneFn } from './scenes/common';
import './art.css';

export type ArtAspect = '16/9' | '4/3' | '1/1' | '3/1';
export type ArtAnimate = 'none' | 'shimmer' | 'scan';

export type ArtSource =
  | { kind: 'image'; src: string }
  | { kind: 'scene'; key: string; draw: SceneFn; state: 'green' | 'red' };

export interface ArtCanvasProps {
  source: ArtSource;
  mode: ArtMode;
  tint: ArtTint;
  cell: ArtCell;
  aspect: ArtAspect;
  animate: ArtAnimate;
  alt: string;
  className?: string;
}

export interface ArtImageProps {
  src: string;
  mode: ArtMode;
  alt: string;
  aspect?: ArtAspect;
  cell?: ArtCell;
  tint?: ArtTint;
  animate?: ArtAnimate;
  className?: string;
}

const STILL = 3.2;     // seconds into a scene for its static frame
const SCAN_MS = 900;
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => { images.delete(src); rej(new Error(src)); };
      im.src = src;
    });
    images.set(src, p);
  }
  return p;
}

export function ArtCanvas({ source, mode, tint, cell, aspect, animate, alt, className }: ArtCanvasProps) {
  const reduced = useReducedMotion();
  const dpr = useDpr();
  const raw = useThemeTokens(ART_TOKENS);
  const colours = useMemo(() => resolveColours(raw), [raw]);
  const [boxRef, { width, height }] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(colours);
  const repaint = useRef<(() => void) | null>(null);
  const isScene = source.kind === 'scene';
  const srcKey = source.kind === 'image' ? source.src : `${source.key}:${source.state}`;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => { live.current = colours; repaint.current?.(); }, [colours]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 24 || height < 12) return;
    const engine = createArt(canvas, mode);
    engine.resize(width, height, dpr, cell);
    let alive = true;
    let img: HTMLImageElement | null = null;
    let sampled = false;
    let reveal = 1; // the first frame is always the full picture; a scan restarts it when the box enters view
    let scanFrom = -1;
    let scanDone = false;
    const t0 = performance.now();
    const shimmer = animate === 'shimmer' && !reduced;

    const paint = (t: number) => {
      const src = sourceRef.current;
      const c = live.current;
      if (src.kind === 'scene') {
        engine.sample((ctx, PW, PH) => src.draw(ctx, PW, PH, t, c, { state: src.state }), false);
      } else {
        if (!img) return;
        if (!sampled) {
          const im = img;
          engine.sample((ctx, PW, PH) => {
            // cover-fit the picture into the box, centred
            const s = Math.max(PW / im.naturalWidth, PH / im.naturalHeight);
            const sw = PW / s, sh = PH / s;
            ctx.fillStyle = tint === 'night' ? '#000' : '#fff';
            ctx.fillRect(0, 0, PW, PH);
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 0, 0, PW, PH);
          }, true);
          sampled = true;
        }
      }
      engine.paint({
        colours: c, tint, t, shimmer, reveal, photo: src.kind === 'image',
        invert: src.kind === 'image' && tint !== 'night',
      });
    };
    const still = () => paint(STILL);
    const scanning = () => scanFrom >= 0 && !scanDone;
    repaint.current = () => { if (!scanning() && !(isScene && animate === 'shimmer' && !reduced)) still(); };

    if (isScene) still(); else loadImage((source as { src: string }).src).then((im) => { if (alive) { img = im; still(); } }, () => {});
    if (mode === 'ascii' && document.fonts) {
      document.fonts.load(`500 12px "Geist Mono Variable"`).then(() => { if (alive) { engine.rebuildAtlas(); repaint.current?.(); } }, () => {});
    }

    let remove = () => {};
    if (!reduced && (animate !== 'none')) {
      remove = addJob({
        el: canvas,
        fps: animate === 'scan' ? 30 : isScene ? 8 : 6,
        animated: () => (animate === 'shimmer' ? isScene || !!img : scanning()),
        visible: (v, now) => {
          if (v && animate === 'scan' && scanFrom < 0 && !scanDone) { scanFrom = now; reveal = 0; if (sampled || isScene) still(); }
          if (v) wake();
        },
        frame: (now) => {
          if (animate === 'scan') {
            const k = clamp01((now - scanFrom) / SCAN_MS);
            reveal = 1 - Math.pow(1 - k, 2);
            if (k >= 1) reveal = 1;
          }
          paint(isScene && animate === 'shimmer' ? (now - t0) / 1000 + STILL : isScene ? STILL : (now - t0) / 1000);
          if (reveal >= 1 && animate === 'scan') scanDone = true; // finished: stop animating
        },
      });
    }
    return () => { alive = false; remove(); repaint.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dpr, reduced, mode, tint, cell, animate, srcKey]);

  return (
    <div ref={boxRef} className={cn('art', tint === 'night' && 'art--night', className)} style={{ aspectRatio: aspect.replace('/', ' / ') }}>
      <canvas ref={canvasRef} role="img" aria-label={alt} />
    </div>
  );
}

export function ArtImage({ src, mode, alt, aspect = '16/9', cell = 'md', tint = 'ink', animate = 'none', className }: ArtImageProps) {
  return <ArtCanvas source={{ kind: 'image', src }} mode={mode} tint={tint} cell={cell} aspect={aspect} animate={animate} alt={alt} className={className} />;
}
