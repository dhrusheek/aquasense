// The landing-page picture: a farmer by a fish pond at dusk, the four nodes and the farm office,
// drawn procedurally and rendered as tinted characters with bloom (spec 06 §4.2). One animation
// loop of its own (12 fps), stopped while the tab is hidden or the canvas is off screen; under
// prefers-reduced-motion it paints one still frame and repaints only when the state, theme or size
// changes.
import { useEffect, useMemo, useRef } from 'react';
import { useDpr, useElementSize, useReducedMotion, useThemeTokens } from '@/components/viz/hooks';
import { cn } from '@/lib/utils';
import { createRaster, type Raster } from './rasterize';
import { drawScene, nodeLabels, type LightState, type Rgb, type SceneTokens } from './scene';
import './asciiart.css';

export interface AsciiSceneProps {
  /** The pond light's state from the data store. */
  state: LightState;
  /** Accessible name; the default describes the scene and the lamp. */
  label?: string;
  className?: string;
}

const LAMP_WORD: Record<LightState, string> = {
  green: 'green', red: 'red', hot: 'blinking red', stale: 'blinking green', test: 'testing', off: 'off',
};

const TOKEN_NAMES = ['--ok', '--bad', '--n1', '--n2', '--n3', '--n4', '--deep'];
const FALLBACK: Record<string, Rgb> = {
  '--ok': [30, 158, 87], '--bad': [215, 54, 43], '--n1': [77, 127, 207], '--n2': [116, 166, 230], '--n3': [156, 203, 240], '--n4': [185, 221, 244],
};
const T_STILL = 4.05; // a packet mid-way N2 to N3, clouds where they drifted to, the lamp lit
const FS_WIDE = 12, FS_SMALL = 9;

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` to a triple; the fallback when the token cannot be read. */
function parseRgb(v: string | undefined, fallback: Rgb): Rgb {
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

export function AsciiScene({ state, label, className }: AsciiSceneProps) {
  const reduced = useReducedMotion();
  const dpr = useDpr();
  const raw = useThemeTokens(TOKEN_NAMES);
  const [boxRef, { width, height }] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tokens = useMemo<SceneTokens>(() => {
    const c = (n: string) => parseRgb(raw[n], FALLBACK[n]);
    return { ok: c('--ok'), bad: c('--bad'), n: [c('--n1'), c('--n2'), c('--n3'), c('--n4')] };
  }, [raw]);
  const deep = raw['--deep'] || '#060D1F';

  // The loop reads these without restarting.
  const live = useRef({ tokens, state, deep });
  useEffect(() => { live.current = { tokens, state, deep }; });

  const painter = useRef<{ paint: (t: number) => void } | null>(null);

  // (Re)build the raster whenever the box, pixel ratio or motion preference changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 40 || height < 40) return;
    let fs = width >= 640 && window.innerWidth >= 900 ? FS_WIDE : FS_SMALL;
    const raster: Raster = createRaster(canvas);
    raster.resize(width, height, dpr, fs);

    let alive = true;
    let id = 0;
    let fps = 12;
    let last = -1e9;
    let slow = 0;
    let visible = true;
    let ewma = 0;
    const t0 = performance.now();

    const paint = (t: number) => {
      const { tokens: tk, state: st, deep: dp } = live.current;
      const g = raster.grid();
      const labels = nodeLabels(g.PW, g.PH);
      const colours: Record<number, string> = {};
      tk.n.forEach((c, k) => {
        const L = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
        const m = L >= 0.62 ? 0 : (0.62 - L) / (1 - L);
        colours[k] = `rgb(${Math.round(c[0] + (255 - c[0]) * m)},${Math.round(c[1] + (255 - c[1]) * m)},${Math.round(c[2] + (255 - c[2]) * m)})`;
      });
      raster.frame((ctx, PW, PH) => drawScene(ctx, PW, PH, t, tk, st), labels, colours, dp);
    };
    painter.current = { paint };

    const tick = (now: number) => {
      id = 0;
      if (!alive || !visible || document.hidden) return;
      id = requestAnimationFrame(tick);
      if (now - last < 1000 / fps - 1) return;
      last = now;
      const a = performance.now();
      paint((now - t0) / 1000 + T_STILL);
      const cost = performance.now() - a;
      ewma = ewma ? ewma * 0.9 + cost * 0.1 : cost;
      canvas.dataset.frameMs = ewma.toFixed(1);
      // Over budget ten frames running: 8 fps; still over: fewer, larger cells.
      if (cost > 16) slow++; else slow = 0;
      if (slow >= 10) {
        slow = 0;
        if (fps > 8) fps = 8;
        else if (fs < 20) { fs += 2; raster.resize(width, height, dpr, fs); }
      }
    };
    const start = () => { if (!id && alive && visible && !document.hidden) id = requestAnimationFrame(tick); };
    const stop = () => { if (id) cancelAnimationFrame(id); id = 0; };

    const fontsReady = () => {
      if (!alive) return;
      raster.rebuildAtlas();
      if (reduced) paint(T_STILL);
    };
    const faces = document.fonts;
    if (faces) {
      faces.load(`500 ${fs}px "Geist Mono Variable"`).then(fontsReady, () => {});
    }

    let io: IntersectionObserver | undefined;
    const onVis = () => (document.hidden ? stop() : start());
    if (reduced) {
      paint(T_STILL);
    } else {
      io = new IntersectionObserver((e) => {
        visible = e[e.length - 1].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0.05 });
      io.observe(canvas);
      document.addEventListener('visibilitychange', onVis);
      start();
    }

    return () => {
      alive = false;
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      raster.dispose();
      painter.current = null;
    };
  }, [width, height, dpr, reduced]);

  // Reduced motion: repaint the still frame when the lamp or the theme changes.
  useEffect(() => {
    if (reduced) painter.current?.paint(T_STILL);
  }, [reduced, state, tokens, deep]);

  const name = label
    ?? `A farmer by a fish pond at dusk; four sensor nodes N1 to N4 relay readings to the farm office, where the status light is ${LAMP_WORD[state]}.`;

  return (
    <div ref={boxRef} className={cn('absolute inset-0', className)}>
      <canvas ref={canvasRef} className="asciiart" role="img" aria-label={name} />
    </div>
  );
}
