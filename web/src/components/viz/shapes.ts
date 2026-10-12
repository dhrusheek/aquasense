// Four roles, four silhouettes (spec 06 §2.1). All are drawn in a 24-unit box, y down, and filled with
// the node's three-stop gradient by <NodeGlyph>. The shape tells the role before the colour does:
// a sensor eye (N1), a probe that dips into the water (N2), the hub cell (N3), the farm office (N4).
import type { NodeId } from './patterns';

export const NODE_SHAPE: Record<NodeId, string> = {
  N1: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20z',
  N2: 'M12 22C7 16 4.5 13 4.5 9.5a7.5 7.5 0 0 1 15 0C19.5 13 17 16 12 22z',
  N3: 'M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75z',
  N4: 'M12 1.5L22 10.5V22H2V10.5z',
};

/** Silhouette name per node, for labels and docs. */
export const NODE_SHAPE_NAME: Record<NodeId, 'circle' | 'teardrop' | 'hexagon' | 'house'> = {
  N1: 'circle', N2: 'teardrop', N3: 'hexagon', N4: 'house',
};

/**
 * Where the id sits inside a glyph, as a shift from the centre of the 24-unit box: the teardrop's
 * mass is in its bulb (up), the house's in its walls (down).
 */
export const NODE_LABEL_DY: Record<NodeId, number> = { N1: 0, N2: -2.4, N3: 0, N4: 2.4 };

/** Centre of the specular glint, in the 24-unit box. */
export const NODE_GLINT: Record<NodeId, [number, number]> = {
  N1: [8.2, 7.2], N2: [8.6, 6.4], N3: [8.6, 7.6], N4: [9.6, 9.8],
};

/** Parameter positions that are lengths (scaled) for each path command; flags and angles are not. */
const ARC_SCALED = new Set([0, 1, 5, 6]);

/** The path of a node's silhouette scaled from the 24-unit box to a `size` px box (origin top left). */
export function shapePath(id: NodeId, size: number): string {
  const k = size / 24;
  const tokens = NODE_SHAPE[id].match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [];
  let cmd = '';
  let argIdx = 0;
  const out: string[] = [];
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  for (const t of tokens) {
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      argIdx = 0;
      out.push(t);
      continue;
    }
    const v = Number(t);
    const scaled = cmd.toLowerCase() === 'a' ? ARC_SCALED.has(argIdx % 7) : true;
    out.push(f(scaled ? v * k : v));
    argIdx++;
  }
  // Re-join: a command letter hugs its first number, numbers are space separated.
  let s = '';
  out.forEach((tok, i) => {
    const isCmd = /[a-zA-Z]/.test(tok);
    const prevCmd = i > 0 && /[a-zA-Z]/.test(out[i - 1]);
    s += (isCmd || prevCmd || i === 0 ? '' : ' ') + tok;
  });
  return s;
}
