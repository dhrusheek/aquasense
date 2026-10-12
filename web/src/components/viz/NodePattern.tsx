import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { usePatternDefs } from './hooks';
import { NodeGlyph } from './NodeGlyph';
import { fillFor, fillOf, isNodeId, nodeOfFill, type CellFill, type NodeId } from './patterns';

export interface NodePatternProps {
  /** A node (its identity glyph) or a named fill. */
  id: NodeId | CellFill;
  /** Side of the glyph in px. 10 / 12 / 16 are swatches; 18 / 28 / 36 are avatars. Default 12. */
  size?: 10 | 12 | 16 | 18 | 28 | 36;
  /**
   * `true` (or `'after'`) writes the id in mono 12 px after the swatch.
   * `'inside'` writes the id on the colour (28 and 36 px; smaller sizes fall back to `'after'`).
   */
  label?: boolean | 'after' | 'inside';
  className?: string;
}

/**
 * A node's identity mark: its silhouette (circle, teardrop, hexagon, house) in its tone step, the one
 * way node identity is shown in legends, readings, slot strips, chart legends and tables. Given a node
 * id or a node's named fill (a chart series) it is the map glyph; `hatch`, `hairline` and `water`
 * (the network-wide total) are round swatches in their own tone.
 */
export function NodePattern({ id, size = 12, label = false, className }: NodePatternProps) {
  usePatternDefs();
  const fill = fillOf(id);
  const node = nodeOfFill(id);
  const text = isNodeId(id) ? id : null;

  if (node) {
    return (
      <NodeGlyph
        id={node}
        size={size}
        label={text ? label : false}
        title={text ?? undefined}
        svgProps={{ 'data-fill': fill, 'data-slot': 'node-pattern' } as SVGProps<SVGSVGElement>}
        className={className}
      />
    );
  }

  // Named fills that are not a node (control, nothing here, the total): a round swatch in the fill's tone.
  const attrs = fillFor(fill);
  const r = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      data-slot="node-pattern"
      data-fill={fill}
      className={cn('shrink-0', className)}
    >
      <circle cx={r} cy={r} r={r - 0.5} className={attrs.className} />
    </svg>
  );
}
