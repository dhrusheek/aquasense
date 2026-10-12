// Shared hooks of the viz layer: theme tokens for canvas code, reduced motion, element size,
// device pixel ratio and page visibility.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DEFS_MARKUP, PATTERN_ID } from './patterns';

/* ---------- theme tokens ---------- */

/** Spec names → the shadcn custom property that carries the value, for stylesheets without the alias. */
const TOKEN_FALLBACK: Record<string, string> = {
  '--paper': '--background',
  '--tray': '--muted',
  '--ink': '--foreground',
  '--graphite': '--muted-foreground',
  '--hairline': '--border',
};

let themeVersion = 0;
const themeListeners = new Set<() => void>();
let themeWatching = false;

function bumpTheme(): void {
  themeVersion++;
  themeListeners.forEach((cb) => cb());
}

function watchTheme(): void {
  if (themeWatching || typeof window === 'undefined') return;
  themeWatching = true;
  // (a) the OS scheme, (b) the class / data-theme the theme toggle writes on <html>.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bumpTheme);
  new MutationObserver(bumpTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['class', 'data-theme'],
  });
}

function subscribeTheme(cb: () => void): () => void {
  watchTheme();
  themeListeners.add(cb);
  return () => { themeListeners.delete(cb); };
}

function readToken(cs: CSSStyleDeclaration, name: string): string {
  const v = cs.getPropertyValue(name).trim();
  if (v) return v;
  const alt = TOKEN_FALLBACK[name];
  return alt ? cs.getPropertyValue(alt).trim() : '';
}

/**
 * Current values of CSS custom properties, for code that cannot use classes (canvas).
 * Re-reads when the OS colour scheme changes or the theme toggle rewrites `class` / `data-theme`
 * on <html>; the returned object is stable between theme changes.
 */
export function useThemeTokens(names: string[]): Record<string, string> {
  const version = useSyncExternalStore(subscribeTheme, () => themeVersion, () => 0);
  const key = names.join('|');
  return useMemo(() => {
    const out: Record<string, string> = {};
    if (typeof window === 'undefined') return out;
    const cs = getComputedStyle(document.documentElement);
    for (const n of key.split('|')) out[n] = readToken(cs, n);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

/* ---------- media queries ---------- */

function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** `prefers-reduced-motion: reduce`: no tween, no packets, no blinking, no cursor interpolation. */
export function useReducedMotion(): boolean {
  return useMedia('(prefers-reduced-motion: reduce)');
}

/* ---------- size ---------- */

export interface ElementSize { width: number; height: number }

/**
 * Content-box size of an element in CSS px, from a ResizeObserver. Returns a ref callback to put on
 * the element; the size is 0 × 0 until the first observation.
 */
export function useElementSize<T extends Element = HTMLDivElement>(): [(el: T | null) => void, ElementSize] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const obs = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      const w = Math.round(r.width), h = Math.round(r.height);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    ro.observe(el);
    obs.current = ro;
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return [ref, size];
}

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/** devicePixelRatio capped at 2, re-checked on window resize (zoom and monitor changes fire it). */
export function useDpr(): number {
  return useSyncExternalStore(subscribeResize, () => Math.min(window.devicePixelRatio || 1, 2), () => 1);
}

/* ---------- visibility ---------- */

function subscribeHidden(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

/** True while the tab is in the background. */
export function useDocumentHidden(): boolean {
  return useSyncExternalStore(subscribeHidden, () => document.hidden, () => false);
}

/* ---------- pattern defs safety net ---------- */

export const PATTERN_AUTO_ATTR = 'data-aq-patterns';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Safety net for a tree that has no <PatternDefs/> at its root: every viz component that paints with
 * the hatch or a gradient calls this from an effect, and the same def is appended to <body> once if missing.
 */
export function ensurePatternDefs(): void {
  if (typeof document === 'undefined' || document.getElementById(PATTERN_ID.hatch)) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'pointer-events-none absolute');
  svg.setAttribute(PATTERN_AUTO_ATTR, 'auto');
  // innerHTML on an <svg> parses in the SVG namespace; the markup is the same string <PatternDefs/> renders.
  svg.innerHTML = `<defs>${DEFS_MARKUP}</defs>`;
  document.body.appendChild(svg);
}

/** Call in any component that fills with `url(#pat-hatch)`. */
export function usePatternDefs(): void {
  useEffect(ensurePatternDefs, []);
}
