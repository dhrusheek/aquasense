// Motion helpers for the cyber skin: heading decode and typewriter. Pure functions + two hooks.
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/components/viz/hooks';

export const DECODE_GLYPHS = '.:/\\|#';
export const DECODE_MS = 400;

/** Decode frame: characters left of `progress` (0..1) are final, the rest scramble. Spaces stay put (width reserved). */
export function decodeFrame(final: string, progress: number, rnd: () => number = Math.random): string {
  const done = Math.floor(final.length * Math.min(1, Math.max(0, progress)));
  let out = '';
  for (let i = 0; i < final.length; i++) {
    const c = final[i];
    out += i < done || c === ' ' ? c : DECODE_GLYPHS[Math.floor(rnd() * DECODE_GLYPHS.length)];
  }
  return out;
}

/** Fully scrambled string of the same length (the pre-decode frame). */
export const scrambled = (final: string): string => decodeFrame(final, 0, () => 0.5);

const seen = new Set<string>();

/**
 * Returns [ref, text]: text is scrambled until the element enters view, decodes over DECODE_MS (~30 fps),
 * then stays final. Once per load per string. Reduced motion: final text at once.
 */
export function useDecodeOnView<T extends Element>(final: string): [(el: T | null) => void, string] {
  const reduced = useReducedMotion();
  const [text, setText] = useState(() => (reduced || seen.has(final) ? final : scrambled(final)));
  const node = useRef<T | null>(null);
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (reduced || seen.has(final) || !el) return;
    let raf = 0;
    const run = () => {
      seen.add(final);
      const t0 = performance.now();
      let last = 0;
      const tick = (now: number) => {
        const p = (now - t0) / DECODE_MS;
        if (now - last >= 33 || p >= 1) { last = now; setText(decodeFrame(final, p)); }
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (typeof IntersectionObserver === 'undefined') { run(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [el, final, reduced]);
  return [(n) => { node.current = n; setEl(n); }, reduced ? final : text];
}

const typed = new Set<string>();

/** Types `text` once per load at `speed` ms per character; returns [shown, done]. Reduced motion: whole text. */
export function useTypewriter(text: string, speed: number): [string, boolean] {
  const reduced = useReducedMotion();
  const skip = reduced || typed.has(text);
  const [n, setN] = useState(skip ? text.length : 0);
  useEffect(() => {
    if (skip) return;
    typed.add(text);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed, skip]);
  const k = skip ? text.length : n;
  return [text.slice(0, k), k >= text.length];
}
