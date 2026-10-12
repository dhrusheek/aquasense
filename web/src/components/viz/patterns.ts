
// Node identity is a SHAPE (circle, teardrop, hexagon, house) plus a TONE: ink at 100 / 70 / 45 / 25 %
// (`--n1` … `--n4`), solid, no patterns (spec 08 §5). `hatch` is the control / contention fill (a solid
// ink-3), `hairline` is "nothing here" (ink-4), `water` is the network-wide total (ink-2). The names
// `checker`, `dots` and `outline` are kept for callers; they now mean N2, N3 and N4's tone.

export type NodeId = 'N1' | 'N2' | 'N3' | 'N4';
export type CellFill = 'solid' | 'checker' | 'dots' | 'outline' | 'hatch' | 'hairline' | 'water';

export const NODE_FILL: Record<NodeId, CellFill> = { N1: 'solid', N2: 'checker', N3: 'dots', N4: 'outline' };

export const NODE_ORDER: NodeId[] = ['N1', 'N2', 'N3', 'N4'];

/** The custom property that carries each node's colour (tone steps of the one ink, in index.css). */
export const NODE_COLOR_VAR: Record<NodeId, '--n1' | '--n2' | '--n3' | '--n4'> = {
  N1: '--n1', N2: '--n2', N3: '--n3', N4: '--n4',
};

// Tailwind only emits a utility it can read as a whole word in the source, so every class is
// written out; never build one from a template string.
const NODE_FILL_CLASS = { N1: 'fill-n1', N2: 'fill-n2', N3: 'fill-n3', N4: 'fill-n4' } as const;
const NODE_STROKE_CLASS = { N1: 'stroke-n1', N2: 'stroke-n2', N3: 'stroke-n3', N4: 'stroke-n4' } as const;
const NODE_BG_CLASS = { N1: 'bg-n1 node-g-1', N2: 'bg-n2 node-g-2', N3: 'bg-n3 node-g-3', N4: 'bg-n4 node-g-4' } as const;

/** `fill-n1` … for an SVG shape in the node's colour. */
export function nodeFill(id: NodeId): 'fill-n1' | 'fill-n2' | 'fill-n3' | 'fill-n4' {
  return NODE_FILL_CLASS[id];
}
/** `stroke-n1` … for an SVG line in the node's colour. */
export function nodeStroke(id: NodeId): 'stroke-n1' | 'stroke-n2' | 'stroke-n3' | 'stroke-n4' {
  return NODE_STROKE_CLASS[id];
}
/**
 * `bg-n1 node-g-1` … for an HTML box in the node's colour: the flat colour under the node's
 * three-stop gradient, with its rim (spec 06 §1.3).
 */
export function nodeBg(id: NodeId): 'bg-n1 node-g-1' | 'bg-n2 node-g-2' | 'bg-n3 node-g-3' | 'bg-n4 node-g-4' {
  return NODE_BG_CLASS[id];
}

/** Ids of the document-global defs rendered by PatternDefs (and, as a safety net, by `ensurePatternDefs`). */
export const PATTERN_ID = {
  /** Ids kept for callers that still look a def up; the fills no longer use them. */
  hatch: 'pat-hatch',
  checker: 'aq-pt-checker',
  dots: 'aq-pt-dots',
  lines: 'aq-pt-lines',
  glyphChecker: 'aq-pg-checker',
  glyphDots: 'aq-pg-dots',
  /** 16 px dot grid, ink-3: the map's backdrop. */
  matrix: 'aq-matrix',
} as const;

/**
 * Markup of everything document-global: the map's dot grid (and the legacy tiles, unused by the
 * fills). One string, used by the root <PatternDefs/> and by the safety net in hooks.ts. Colours
 * are `style` fills that read the tokens, so a theme switch repaints with no redraw.
 */
export const DEFS_MARKUP: string = (() => {
  const tile = (id: string, w: number, h: number, body: string, tone: string, rot = '') =>
    `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${rot}><g style="fill:var(${tone})">${body}</g></pattern>`;
  const checker = '<rect width="2" height="2"/><rect x="2" y="2" width="2" height="2"/>';
  const dots = '<circle cx="2" cy="2" r="1.2"/>';
  let m = tile(PATTERN_ID.hatch, 6, 6, '<rect width="1" height="6"/>', '--ink-3', ' patternTransform="rotate(45)"');
  m += tile(PATTERN_ID.checker, 4, 4, checker, '--n2');
  m += tile(PATTERN_ID.dots, 4, 4, dots, '--n3');
  m += tile(PATTERN_ID.lines, 3, 4, '<rect width="1.5" height="4"/>', '--n1');
  m += tile(PATTERN_ID.glyphChecker, 4, 4, checker, '--ink');
  m += tile(PATTERN_ID.glyphDots, 4, 4, dots, '--ink');
  m += tile(PATTERN_ID.matrix, 16, 16, '<circle cx="8" cy="8" r="1"/>', '--ink-3');
  return m;
})();

/** The node whose colour a named fill carries (`solid` = N1 … `outline` = N4); null for the other fills. */
export function nodeOfFill(fill: CellFill | NodeId): NodeId | null {
  if (isNodeId(fill)) return fill;
  switch (fill) {
    case 'solid': return 'N1';
    case 'checker': return 'N2';
    case 'dots': return 'N3';
    case 'outline': return 'N4';
    default: return null;
  }
}

export function isNodeId(x: unknown): x is NodeId {
  return x === 'N1' || x === 'N2' || x === 'N3' || x === 'N4';
}

/** A node id or a fill name → the fill. */
export function fillOf(id: NodeId | CellFill): CellFill {
  return isNodeId(id) ? NODE_FILL[id] : id;
}

export interface FillAttrs {
  /** Token classes (fill-n1, fill-n4 stroke-ink …). */
  className?: string;
  /** A `url(#pattern)` reference, when the fill is a pattern (hatch only). */
  fill?: string;
  stroke?: string;
}

/**
 * SVG attributes for a chart cell: a solid fill in the node's tone step (`fill-n1` … `fill-n4`).
 * `hatch` (control / contention) is ink-3, `hairline` ink-4, `water` (the total) ink-2.
 * `small` is accepted for the callers of the first pass and no longer changes the result.
 */
export function fillFor(fill: CellFill, small: boolean = false): FillAttrs {
  void small;
  switch (fill) {
    case 'solid':
      return { className: 'fill-n1' };
    case 'checker':
      return { className: 'fill-n2' };
    case 'dots':
      return { className: 'fill-n3' };
    case 'outline':
      return { className: 'fill-n4' };
    case 'hatch':
      return { className: 'fill-ink-3' };
    case 'hairline':
      return { className: 'fill-ink-4' };
    case 'water':
      return { className: 'fill-ink-2' };
  }
}

/** Stroke width that goes with `fillFor(fill)`; 0 when the fill has no stroke. */
export function strokeWidthFor(fill: CellFill, small: boolean = false): number {
  void small;
  void fill;
  return 0;
}

/**
 * Shift that centred a pattern tile inside a square. Tiles are in px and need none, so it is 0 for
 * every fill; the function stays for the callers that still translate by it.
 */
export function patternShift(fill: CellFill, small: boolean, w: number): number {
  void fill; void small; void w;
  return 0;
}
