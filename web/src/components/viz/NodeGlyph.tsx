import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { usePatternDefs } from './hooks';
import { nodeFill, type NodeId } from './patterns';
import { NODE_LABEL_DY, shapePath } from './shapes';
import './viz.css';

export interface NodeGlyphProps {
  id: NodeId;
  /** Side of the glyph's box in px. 12 / 16 are swatches, 20+ are map glyphs, 28 / 32 / 36 carry an id inside. Default 16. */
  size?: 12 | 16 | 20 | 28 | 32 | 36 | (number & {});
  /** Inactive nodes are an ink-3 dashed outline on the ground, no fill. Default active. */
  state?: 'active' | 'inactive';
  /** Accepted for the callers of earlier passes; a flat glyph has no halo. */
  halo?: boolean;
  /** `true` or `'after'` writes the id after the glyph (svg only); `'inside'` writes it in a small pill on the body (28 px up). */
  label?: boolean | 'after' | 'inside';
  /** `svg`: its own <svg> (default). `g`: a group for use inside another SVG, drawn centred on (x, y). */
  as?: 'svg' | 'g';
  /** Centre, when `as='g'`. */
  x?: number;
  y?: number;
  /** Accessible name for the standalone svg; without it the svg is decorative. */
  title?: string;
  /** Extra attributes for the standalone <svg>. */
  svgProps?: Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox' | 'className'>;
  /** Accepted for the callers of earlier passes: every glyph is its node's solid tone step. */
  tone?: boolean;
  className?: string;
}

/** The silhouette is drawn on the 24-unit box scaled so that its widest side fills ~91 % of `size`. */
const FILL = 22;

const PATH = new Map<string, string>();
/** The silhouette scaled to px, origin top left; cached, since the swatches repeat a handful of sizes. */
function pathFor(id: NodeId, box: number): string {
  const key = `${id}:${box}`;
  let d = PATH.get(key);
  if (d === undefined) { d = shapePath(id, box); PATH.set(key, d); }
  return d;
}

/**
 * A node as an object, not a square: its role's silhouette (circle, teardrop, hexagon, house) as a
 * solid shape in the node's tone step of the one ink (`--n1` … `--n4`). Drawn from CSS variables, so
 * it follows the theme and needs no redraw.
 */
export function NodeGlyph({
  id, size = 16, state = 'active', label = false, as = 'svg', x = 0, y = 0, title, svgProps, className,
}: NodeGlyphProps) {
  usePatternDefs();
  const active = state === 'active';
  const box = (size * 24) / FILL;
  const d = pathFor(id, box);
  const inside = label === 'inside' && size >= 28;
  const after = (label === true || label === 'after' || (label === 'inside' && !inside)) && as === 'svg';
  const fs = 12;
  // The id plate: a card-coloured pill with an ink-3 border, so the letters never sit on a tone fill.
  const plateW = Math.round(fs * 0.6 * 2 + 12), plateH = fs + 6;

  const body = (
    <>
      <g transform={`translate(${-box / 2} ${-box / 2})`} strokeLinejoin="round">
        {active ? (
          <path d={d} className={cn(nodeFill(id), size >= 20 && 'stroke-ink')} strokeWidth={size >= 20 ? 1.25 : 0} />
        ) : (
          <path d={d} fill="none" className="stroke-border" strokeWidth="1" strokeDasharray="2 3" />
        )}
      </g>
      {inside && (
        <g transform={`translate(0 ${NODE_LABEL_DY[id] * (size / FILL)})`}>
          <rect
            x={-plateW / 2 + 0.5} y={-plateH / 2 + 0.5} width={plateW - 1} height={plateH - 1} rx={plateH / 2}
            className="fill-card stroke-border" strokeWidth="1"
          />
          <text x="0" y="0" textAnchor="middle" dominantBaseline="central" fontSize={fs} className="font-mono font-semibold fill-ink">
            {id}
          </text>
        </g>
      )}
    </>
  );

  if (as === 'g') {
    return <g data-slot="node-glyph" data-node={id} transform={`translate(${x} ${y})`} className={className}>{body}</g>;
  }

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      overflow="visible"
      focusable="false"
      aria-hidden={after || !title ? true : undefined}
      role={after || !title ? undefined : 'img'}
      aria-label={after || !title ? undefined : title}
      data-slot="node-glyph"
      data-node={id}
      className={cn('shrink-0', !after && className)}
      {...svgProps}
    >
      {body}
    </svg>
  );
  if (!after) return svg;
  return (
    <span data-slot="node-glyph-label" className={cn('inline-flex items-center gap-1.5 align-middle', className)}>
      {svg}
      <span className="tabular font-mono text-xs text-ink">{id}</span>
    </span>
  );
}
