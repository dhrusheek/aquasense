import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtI } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDocumentHidden, useDpr, useReducedMotion, useThemeTokens } from './hooks';
import { createPondEngine, pondDensity } from './pond';

export interface PondFieldProps {
  /** CSS px, from PondStage's ResizeObserver. */
  width: number;
  height: number;
  /** node('N2').value (raw 12-bit ADC); null when missing. */
  turbidity: number | null;
  /** node('N2').status === 'active'. */
  n2Active: boolean;
  /** node('N2').threshold; used in the text alternative only. */
  turbid: boolean | null;
  className?: string;
}

const TOKENS = ['--ground', '--ink-3'];

/**
 * Dithered canvas whose dot density is N2's live turbidity: sparse and regular when the water is
 * clear, nearly solid when it is murky. The background layer of PondStage.
 */
export function PondField({ width, height, turbidity, n2Active, turbid, className }: PondFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tokens = useThemeTokens(TOKENS);
  const reduced = useReducedMotion();
  const dpr = useDpr();
  const hidden = useDocumentHidden();
  const [onScreen, setOnScreen] = useState(true);

  const { d: target, unknown } = pondDensity(turbidity, n2Active);
  const [engine] = useState(() => createPondEngine(target));
  /** The density last handed to the engine; a new reading must differ by 0.005 to count. */
  const accepted = useRef<number | null>(null);

  // Effects run in this order on every commit: colours, then the density, then the grid.

  useLayoutEffect(() => {
    engine.setColours(tokens['--ground'] || 'canvas', tokens['--ink-3'] || 'graytext');
  }, [engine, tokens]);

  // A new reading tweens to its density. It jumps instead on the first reading, in unknown mode,
  // under reduced motion, in a hidden tab and when the canvas is less than 10 % visible, so a
  // paused field is already at its target when it is looked at again.
  const still = unknown || reduced || hidden || !onScreen;
  useLayoutEffect(() => {
    const first = accepted.current === null;
    if (first || unknown || Math.abs(target - (accepted.current as number)) >= 0.005) {
      accepted.current = target;
      engine.setTarget(target, !first && !still);
    } else if (still) {
      engine.settle();
    }
  }, [engine, target, unknown, still]);

  // Allocate only when the box, the pixel ratio or the mode (shaped / flat) changes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    engine.resize(canvas, width, height, dpr, unknown);
  }, [engine, width, height, dpr, unknown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      setOnScreen(e.isIntersecting && e.intersectionRatio >= 0.1);
    }, { threshold: [0, 0.1] });
    io.observe(canvas);
    return () => io.disconnect();
  }, []);

  useEffect(() => () => engine.dispose(), [engine]);

  const label = unknown
    ? `Pond field: turbidity unknown, N2 ${n2Active ? 'has no sample' : 'inactive'}`
    : `Pond field: turbidity ${fmtI(turbidity)} raw ADC, ${turbid === true ? 'turbid' : turbid === false ? 'clear' : 'flag unknown'}, dither density ${Math.round(target * 100)} %`;

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      data-slot="pond-field"
      data-density={target.toFixed(2)}
      data-mode={unknown ? 'unknown' : 'live'}
      className={cn('absolute inset-0 block', className)}
      style={{ width, height }}
    >
      {label}
    </canvas>
  );
}
