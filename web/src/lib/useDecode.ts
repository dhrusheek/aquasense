import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/components/viz/hooks';
import { decodeFrames } from '@/lib/decode';

export interface DecodeOptions {
  /** Total run time (default 350 ms). */
  ms?: number;
  /** At most one run per this many ms (default 2000). */
  minGap?: number;
}

const STEP_MS = 30;

/**
 * The text to show for `value`: it decodes only when `value` changes (never on mount), at most once
 * per `minGap`, and never under reduced motion. `decoding` is true while scrambled digits are shown.
 */
export function useDecode(value: string | null, opts: DecodeOptions = {}): { text: string | null; decoding: boolean } {
  const { ms = 350, minGap = 2000 } = opts;
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState<string | null>(null);
  const prev = useRef(value);
  const last = useRef(-Infinity);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (value === null || from === null || from === value) return;
    window.clearInterval(timer.current);
    const now = performance.now();
    if (reduced || now - last.current < minGap || !/\d/.test(value)) {
      setFrame(null);
      return;
    }
    last.current = now;
    const frames = decodeFrames(from, value, Math.max(2, Math.round(ms / STEP_MS)));
    let i = 0;
    setFrame(frames[0]);
    timer.current = window.setInterval(() => {
      i += 1;
      if (i >= frames.length) {
        window.clearInterval(timer.current);
        setFrame(null);
      } else setFrame(frames[i]);
    }, STEP_MS);
  }, [value, reduced, ms, minGap]);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const decoding = frame !== null && value !== null && frame !== value;
  return { text: decoding ? frame : value, decoding };
}
