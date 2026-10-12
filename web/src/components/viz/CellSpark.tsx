import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { maxOf, niceCeil, quantise, sample } from './cellMath';
import { useElementSize } from './hooks';
import { isNodeId, nodeFill, nodeOfFill, type CellFill, type NodeId } from './patterns';

export interface CellSparkProps {
  values: (number | null | undefined)[];
  /** Default 0. */
  min?: number;
  /** Default 'auto': the next of 1, 2, 5 × 10ⁿ above the shown data. */
  max?: number | 'auto';
  /**
   * Width in px; `floor(width / 4)` samples are shown, newest at the right. Default 120 (30 samples).
   * `'fill'` (additive) measures the container instead and spans it.
   */
  width?: number | 'fill';
  /**
   * Tone of the cells: a node (`'N1'` or `'n1'` → `fill-n1`, its step of the one ink), `'total'` /
   * `'water'` / `'ink'` → full ink, a named fill, or a ready `fill-*` class. Default `'total'`.
   */
  fill?: SparkFill;
  className?: string;
}

export type SparkFill =
  | NodeId | 'n1' | 'n2' | 'n3' | 'n4' | 'total' | 'ink' | CellFill
  | `fill-${string}`;

function sparkClass(fill: SparkFill): string {
  if (fill === 'total' || fill === 'water' || fill === 'ink') return 'fill-ink';
  if (fill.startsWith('fill-')) return fill;
  const node = fill.toUpperCase();
  if (isNodeId(node)) return nodeFill(node);
  // A pattern has no meaning at 3 px: the named node fills take their tone step, the rest ink-2.
  const named = nodeOfFill(fill as CellFill);
  return named ? nodeFill(named) : 'fill-graphite';
}

const CELL = 3, PITCH = 4, ROWS = 5, HEIGHT = 20;

/**
 * A tile-sized cell chart: one series, 3 px cells, no axes and no tooltip, in a node's tone step or
 * full ink for a total. Decorative: the tile's value carries the meaning. The `spark` slot of StatTile.
 */
export function CellSpark({ values, min = 0, max = 'auto', width: widthProp = 120, fill = 'total', className }: CellSparkProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const width = widthProp === 'fill' ? size.width : widthProp;
  const d = useMemo(() => {
    const columns = Math.max(1, Math.floor(width / PITCH));
    const tail = values.slice(Math.max(0, values.length - columns)).map(sample);
    const hi = max === 'auto' ? Math.max(niceCeil(maxOf(tail) ?? 1), min + 1) : max;
    const x0 = (columns - tail.length) * PITCH;
    let path = '';
    tail.forEach((v, i) => {
      const q = quantise(v, min, hi, ROWS);
      if (!q) return;
      const x = x0 + i * PITCH;
      for (let r = 0; r < q; r++) path += `M${x} ${HEIGHT - (r + 1) * PITCH}h${CELL}v${CELL}h${-CELL}z`;
    });
    return path;
  }, [values, min, max, width]);

  const svg = width > 0 && (
    <svg
      width={width}
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
      data-slot="cell-spark"
      className={cn('block max-w-full', className)}
    >
      {/* the row the cells stand on */}
      <rect x="0" y={HEIGHT - 1} width={Math.floor(width / PITCH) * PITCH - 1} height="1" className="fill-hairline" />
      <path d={d} className={sparkClass(fill)} />
    </svg>
  );
  if (widthProp !== 'fill') return svg || null;
  return <div ref={ref} aria-hidden="true" className="h-5 w-full min-w-0">{svg}</div>;
}
