import { useLayoutEffect, useMemo, useRef, type Ref } from 'react';
import { useReducedMotion } from '@/components/viz/hooks';
import { cn } from '@/lib/utils';
import { ANIMS, meterCells, type AsciiInk, type AsciiName } from './anims';
import { paint, register, type AsciiParams, type AsciiParamValue } from './engine';

export type { AsciiInk, AsciiName } from './anims';

export interface AsciiProps {
  anim: AsciiName;
  /** Character grid; defaults per animation (spec 05 §2.4). */
  cols?: number;
  rows?: number;
  /** Frames per second; default per animation. `0` shows frame 0 and never animates. */
  fps?: number;
  /** `ramp` = depth gradient left → right, `surface` = top → bottom, `accent` = water, `mono` = graphite.
   *  Default: the animation's own ink (motifs `ramp`, pulse / spinner / caret `accent`, dots `mono`). */
  ink?: AsciiInk;
  /** Font size 10 / 12 / 14 / 16 px; line-height 1.15. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Generator inputs, e.g. `{ value: 0.46, width: 10 }` for `meter`, `{ done, next }` for `steps`. */
  params?: Record<string, AsciiParamValue>;
  /** Accessible name → `role="img"`. Omitted → the block is `aria-hidden`. */
  label?: string;
  /** Accepted for call sites that spell it out; an unlabelled block is hidden either way. */
  'aria-hidden'?: boolean;
  /** `span` where only phrasing content is allowed (inside a button, a paragraph, a label). */
  as?: 'pre' | 'span';
  className?: string;
}

const NO_PARAMS: AsciiParams = Object.freeze({});

/**
 * One block of animated characters. All instances share the single rAF loop in engine.ts, pause off
 * screen and in a background tab, and show a static frame 0 under `prefers-reduced-motion`.
 * The text node is written by the engine, never by React, so a re-render cannot rewind a frame.
 */
export function Ascii({
  anim, cols, rows, fps, ink, size = 'sm', params, label, as = 'pre', className,
}: AsciiProps) {
  const def = ANIMS[anim];
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  // What is on screen, carried across effect runs: a loop keeps its frame, a meter knows where it was.
  const shown = useRef<{ anim: AsciiName; frame: number; fill: number | null }>({ anim, frame: 0, fill: null });

  const c = cols ?? def.cols;
  const r = rows ?? def.rows;
  const f = fps ?? def.fps;
  // Callers pass a fresh object literal on every render; compare by content, not identity.
  const key = params ? JSON.stringify(params) : '';
  const p = useMemo<AsciiParams>(() => (key ? (JSON.parse(key) as AsciiParams) : NO_PARAMS), [key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const memo = shown.current;
    if (memo.anim !== anim) { memo.anim = anim; memo.frame = 0; memo.fill = null; }

    let q = p;
    let fillFrom = 0, fillTo = 0;
    if (anim === 'meter') {
      // Start from the cells filled right now; the first paint and reduced motion show the value at once.
      fillTo = meterCells(p, c).fill;
      fillFrom = reduced || memo.fill === null ? fillTo : memo.fill;
      memo.fill = fillTo;
      q = { ...p, from: fillFrom };
    }

    if (reduced) {
      paint(el, def.gen(0, c, r, q)); // static frame 0; re-run when params change
      return;
    }

    const frames = def.frames?.(q, c, r);
    const loops = frames === undefined;
    const stop = register(el, def.gen, f, q, { cols: c, rows: r, frames, start: loops ? memo.frame : 0 });
    return () => {
      const last = stop();
      if (loops) memo.frame = last;
      // An interrupted meter resumes from the cell it had reached.
      if (anim === 'meter') memo.fill = fillFrom + Math.sign(fillTo - fillFrom) * Math.min(last, Math.abs(fillTo - fillFrom));
    };
  }, [anim, def, c, r, f, p, reduced]);

  const Tag = as as 'span';
  return (
    <Tag
      ref={ref as Ref<HTMLSpanElement>}
      data-slot="ascii"
      data-anim={anim}
      data-ink={ink ?? def.ink}
      data-size={size}
      data-rows={r > 1 ? r : undefined}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn('ascii', className)}
    />
  );
}
