// 2-D localization map of view r2 (port of renderLocMap, app.js 902-950, spec 02 §2.3).
// The nodes other than the target are anchors at their true positions; a dashed ring around each
// is the distance estimated from RSSI; the target's true position is a hollow ring, its weighted
// centroid estimate a filled dot, and the dashed line between them is the localization error.
//
// The reference drawing is 640 × 580 (the legacy viewBox). The box is measured and drawn 1 unit =
// 1 CSS px, so text keeps its size on a phone; `topoGeom` fits and centres the layout in whatever
// box it gets, which is what `preserveAspectRatio="xMidYMid meet"` did.
import { EmptyState } from '@/components/aq/EmptyState';
import { useElementSize, usePatternDefs } from '@/components/viz/hooks';
import { NodeGlyph } from '@/components/viz/NodeGlyph';
import { NODE_ORDER, isNodeId } from '@/components/viz/patterns';
import { topoGeom } from '@/components/viz/topoLayout';
import type { LocTarget, NodeId, Num, XY } from '@/data/types';
import { fmt, fmtI } from '@/lib/format';
import { arr, nId, num } from '@/lib/safe';
import { cn } from '@/lib/utils';
import { xyText } from './loc';

export interface LocMapProps {
  /** True positions in cm. */
  positions: Record<NodeId, XY>;
  /** The localization result drawn, or null before the sink has one. */
  target: LocTarget | null;
  /** Its node; every other node is an anchor. Null draws all four as anchors. */
  targetId: NodeId | null;
  className?: string;
}

/** A box narrower than this draws smaller glyphs and labels every other grid line. */
const COMPACT_BELOW = 480;
const PAD = 16;
/** Keeps rings of about 100 cm inside the map. */
const MARGIN_CM = 110;
const GRID_CM = 30;
const MAX_LINES = 120;
/** Geist Mono advance, em. */
const CHAR = 0.6;
const EDGE = 4;

const HALO = 'stroke-card [paint-order:stroke]';

function textW(text: string, fs: number): number {
  return text.length * fs * CHAR;
}
function clamp(x: number, lo: number, hi: number): number {
  return hi < lo ? lo : x < lo ? lo : x > hi ? hi : x;
}
/* ---------- label placement ---------- */

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Box of a start-anchored line of mono text with its baseline at `y`. */
function textBox(x: number, y: number, w: number, fs: number): Box {
  return { x0: x, y0: y - fs * 0.8, x1: x + w, y1: y + fs * 0.25 };
}
function around(cx: number, cy: number, half: number): Box {
  return { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half };
}
function hits(a: Box, b: Box, gap: number = 2): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
}

/**
 * Put a label at the first candidate (x = text start, y = baseline) that stays clear of everything
 * already on the map; the first candidate is the legacy position and wins when nothing is free.
 * The chosen box is added to `taken`.
 */
function place(cands: [number, number][], w: number, fs: number, W: number, H: number, taken: Box[]): [number, number] {
  let chosen: [number, number] | null = null;
  for (const [cx, cy] of cands) {
    const at: [number, number] = [clamp(cx, EDGE, W - EDGE - w), clamp(cy, fs + 2, H - EDGE)];
    if (chosen === null) chosen = at;
    const box = textBox(at[0], at[1], w, fs);
    if (!taken.some((t) => hits(box, t))) { chosen = at; break; }
  }
  const at = chosen ?? [EDGE, fs + 2];
  taken.push(textBox(at[0], at[1], w, fs));
  return at;
}

/** A numeric [x, y] pair, or null. */
function pair(p: Num[] | null | undefined): XY | null {
  const a = arr<Num>(p), x = num(a[0]), y = num(a[1]);
  return a.length === 2 && x !== null && y !== null ? [x, y] : null;
}

/* ---------- marks ---------- */

/** The estimate: a solid ink dot with a card-coloured rim so it reads over grid and rings. */
function EstDot({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return <circle cx={cx} cy={cy} r={r - 0.5} className="fill-foreground stroke-card" strokeWidth="1.5" />;
}

/** An anchor: the node's glyph (its own silhouette and tone step) with its id inside. */
function Anchor({ id, cx, cy, size }: { id: NodeId; cx: number; cy: number; size: number }) {
  return (
    <g data-anchor={id}>
      <NodeGlyph as="g" id={id} size={28} label="inside" x={cx} y={cy} />
      <text
        x={cx}
        y={Math.round(cy + size / 2) + 13}
        textAnchor="middle"
        fontSize="12"
        strokeWidth="3"
        strokeLinejoin="round"
        className={cn('fill-graphite', HALO)}
      >
        anchor
      </text>
    </g>
  );
}

/* ---------- the drawing ---------- */

function MapSvg({ W, H, positions: P, target, targetId }: { W: number; H: number } & Omit<LocMapProps, 'className'>) {
  const compact = W < COMPACT_BELOW;
  const G = topoGeom(P, W, H, PAD, MARGIN_CM);

  // Grid every 30 cm across the whole box, not only across the fitted extent.
  const [ox, by] = G.m([G.minX, G.minY]);
  const cmX0 = G.minX - ox / G.s, cmX1 = G.minX + (W - ox) / G.s;
  const cmY0 = G.minY - (H - by) / G.s, cmY1 = G.minY + by / G.s;
  const labelEvery = G.s * GRID_CM < 30 ? GRID_CM * 2 : GRID_CM;
  const gridX: number[] = [], gridY: number[] = [];
  for (let g = Math.ceil(cmX0 / GRID_CM) * GRID_CM; g <= cmX1 && gridX.length < MAX_LINES; g += GRID_CM) gridX.push(g);
  for (let g = Math.ceil(cmY0 / GRID_CM) * GRID_CM; g <= cmY1 && gridY.length < MAX_LINES; g += GRID_CM) gridY.push(g);

  const size = 28;
  const ringFs = 12, capFs = 12, errFs = compact ? 12 : 13;
  const rTrue = compact ? 10 : 13, swTrue = compact ? 2.5 : 3, rEst = compact ? 6 : 8;

  const anchors = NODE_ORDER.filter((id) => id !== targetId);
  const centre = (id: NodeId): XY => G.m(P[id]);

  /* ---- target: true position, estimate ---- */
  const trueCm = target ? (pair(target.true) ?? (targetId ? P[targetId] : null)) : null;
  const estCm = target ? pair(target.est) : null;
  const tp = trueCm ? G.m(trueCm) : null;
  const ep = tp && estCm ? G.m(estCm).map(Math.round) as XY : null;

  /* ---- labels: caption, error, then one per ring; each avoids what is already there ---- */
  const taken: Box[] = [];
  anchors.forEach((id) => {
    const [cx, cy] = centre(id);
    taken.push(around(cx, cy, size / 2 + 2));
    taken.push({ x0: cx - 18, y0: cy + size / 2 + 4, x1: cx + 18, y1: cy + size / 2 + 16 }); // "anchor"
  });
  if (tp) taken.push(around(tp[0], tp[1], rTrue + swTrue / 2));
  if (ep) taken.push(around(ep[0], ep[1], rEst));

  let caption: { x: number; y: number; text: string } | null = null;
  let errLabel: { x: number; y: number; text: string } | null = null;
  if (tp) {
    const text = `${targetId ?? '—'} true ○ / estimate ●`;
    const w = textW(text, capFs);
    const top = Math.min(tp[1], ep ? ep[1] : tp[1]);
    const bottom = Math.max(tp[1] + rTrue + swTrue / 2, ep ? ep[1] + rEst : 0);
    const right = Math.max(tp[0] + rTrue, ep ? ep[0] + rEst : 0), left = Math.min(tp[0] - rTrue, ep ? ep[0] - rEst : Infinity);
    const [x, y] = place([
      [tp[0] - w / 2, top - (compact ? 17 : 20)],        // above the higher mark (legacy)
      [tp[0] - w / 2, bottom + capFs + 5],
      [right + 10, top - 4],
      [left - 10 - w, top - 4],
    ], w, capFs, W, H, taken);
    caption = { text, x, y };
  }
  if (tp && ep && target) {
    const text = `error ${fmt(target.err_cm, 1, 'cm')}`;
    const w = textW(text, errFs);
    const mx = (tp[0] + ep[0]) / 2, my = (tp[1] + ep[1]) / 2;
    const bottom = Math.max(tp[1] + rTrue + swTrue / 2, ep[1] + rEst), top = Math.min(tp[1] - rTrue, ep[1] - rEst);
    const right = Math.max(tp[0] + rTrue, ep[0] + rEst), left = Math.min(tp[0] - rTrue, ep[0] - rEst);
    const [x, y] = place([
      [Math.max(tp[0], ep[0]) + (compact ? 14 : 18), my + (compact ? 20 : 22)], // right of the pair (legacy)
      [right + 10, my + errFs * 0.36],
      [left - 10 - w, my + errFs * 0.36],
      [mx - w / 2, bottom + errFs + 4],
      [mx - w / 2, top - 8],
    ], w, errFs, W, H, taken);
    errLabel = { text, x, y };
  }

  /* ---- anchor range rings ---- */
  const rings = arr<{ id?: unknown; dist_cm?: unknown } | null>(target?.anchors).flatMap((an) => {
    const aid = nId(an?.id), r = num(an?.dist_cm);
    if (!isNodeId(aid) || r === null) return [];
    const p = centre(aid);
    const text = `d = ${fmt(r, 0)} cm`;
    const w = textW(text, ringFs);
    const dx = compact ? 18 : 24, dy = compact ? 14 : 18;
    const [tx, ty] = place([
      [p[0] + dx, p[1] - dy],                            // up and right of the anchor (legacy)
      [p[0] - dx - w, p[1] - dy],
      [p[0] + dx, p[1] + dy + ringFs * 0.7],
      [p[0] - dx - w, p[1] + dy + ringFs * 0.7],
      [p[0] - w / 2, p[1] - size / 2 - 8],
    ], w, ringFs, W, H, taken);
    return [{ aid, text, cx: p[0], cy: p[1], r: Math.max(0, r * G.s), tx, ty }];
  });

  const label = target && targetId
    ? `Localization map. ${targetId} true position ${xyText(trueCm, 0)} cm, estimated ${xyText(target.est, 1)} cm, error ${fmt(target.err_cm, 1, 'cm')}. `
      + (rings.length ? `Distance estimated from each anchor: ${rings.map((r) => `${r.aid} ${r.text.slice(4)}`).join(', ')}.` : 'No anchor distances reported.')
    : 'Localization map. No localization result yet: the four nodes are drawn at their true positions.';

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      data-slot="loc-map-svg"
      data-target={targetId ?? undefined}
      data-compact={compact || undefined}
      className="absolute inset-0 block select-none"
    >
      {/* grid every 30 cm, labelled in cm along the bottom and the left edge */}
      <g data-slot="loc-map-grid" aria-hidden="true">
        {gridX.map((g) => {
          const x = Math.round(G.m([g, 0])[0]) + 0.5;
          return <line key={`x${g}`} x1={x} y1={0} x2={x} y2={H} className="stroke-foreground/10" strokeWidth="1" />;
        })}
        {gridY.map((g) => {
          const y = Math.round(G.m([0, g])[1]) + 0.5;
          return <line key={`y${g}`} x1={0} y1={y} x2={W} y2={y} className="stroke-foreground/10" strokeWidth="1" />;
        })}
        {gridX.map((g) => {
          const x = Math.round(G.m([g, 0])[0]) + 3;
          const text = fmtI(g);
          if (g % labelEvery !== 0 || x < 26 || x + textW(text, 10) > W - 2) return null;
          return (
            <text key={`xt${g}`} x={x} y={H - 4} fontSize="12" strokeWidth="3" strokeLinejoin="round" className={cn('tabular fill-graphite font-mono', HALO)}>
              {text}
            </text>
          );
        })}
        {gridY.map((g) => {
          const y = Math.round(G.m([0, g])[1]) - 3;
          if (g % labelEvery !== 0 || y < 12 || y > H - 16) return null;
          return (
            <text key={`yt${g}`} x={4} y={y} fontSize="12" strokeWidth="3" strokeLinejoin="round" className={cn('tabular fill-graphite font-mono', HALO)}>
              {fmtI(g)}
            </text>
          );
        })}
      </g>

      {/* rings: the distance each anchor estimates from RSSI */}
      <g data-slot="loc-map-rings" aria-hidden="true">
        {rings.map((r) => (
          <circle key={r.aid} cx={r.cx} cy={r.cy} r={r.r} className="fill-none stroke-foreground/60" strokeWidth="1" strokeDasharray="4 4" />
        ))}
      </g>

      {/* error: true position → estimate */}
      {tp && ep && (
        <line
          data-slot="loc-map-error"
          x1={tp[0]} y1={tp[1]} x2={ep[0]} y2={ep[1]}
          className="stroke-ink"
          strokeWidth="2"
          strokeDasharray="3 3"
          aria-hidden="true"
        />
      )}

      <g data-slot="loc-map-anchors" aria-hidden="true">
        {anchors.map((id) => {
          const p = centre(id);
          return <Anchor key={id} id={id} cx={p[0]} cy={p[1]} size={size} />;
        })}
      </g>

      {tp && (
        <circle data-slot="loc-map-true" cx={tp[0]} cy={tp[1]} r={rTrue} className="fill-none stroke-ink" strokeWidth={swTrue}>
          <title>True position</title>
        </circle>
      )}
      {ep && targetId && (
        <g data-slot="loc-map-estimate">
          <title>Estimated position</title>
          <EstDot cx={ep[0]} cy={ep[1]} r={rEst} />
        </g>
      )}

      {/* labels last, each on a card-coloured halo so grid and rings never cut through the text */}
      <g data-slot="loc-map-labels" aria-hidden="true">
        {rings.map((r) => (
          <text key={r.aid} x={r.tx} y={r.ty} fontSize={ringFs} strokeWidth="3" strokeLinejoin="round" className={cn('tabular fill-graphite font-mono', HALO)}>
            {r.text}
          </text>
        ))}
        {caption && (
          <text x={caption.x} y={caption.y} fontSize={capFs} strokeWidth="3" strokeLinejoin="round" className={cn('fill-graphite', HALO)}>
            {caption.text}
          </text>
        )}
        {errLabel && (
          <text x={errLabel.x} y={errLabel.y} fontSize={errFs} strokeWidth="3" strokeLinejoin="round" className={cn('tabular fill-ink font-mono font-semibold', HALO)}>
            {errLabel.text}
          </text>
        )}
      </g>
    </svg>
  );
}

/**
 * The map in its box (640 : 580, at most 640 px tall). Pass sizing classes to let it grow with a
 * taller grid row. Before the sink reports a result it shows the grid and the four nodes only.
 */
export function LocMap({ positions, target, targetId, className }: LocMapProps) {
  usePatternDefs();
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-slot="loc-map"
      className={cn('relative aspect-[32/29] max-h-[640px] w-full overflow-hidden rounded-xl border border-border bg-card', className)}
    >
      {width > 0 && height > 0 && (
        <MapSvg W={width} H={height} positions={positions} target={target} targetId={target ? targetId : null} />
      )}
      {!target && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex">
          <EmptyState
            compact
            description="No localization result yet — the sink computes it once three anchors report RSSI."
            className="bg-card"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- legend ---------- */

export interface LocMapLegendProps {
  /** The node drawn as the target (N1 before any result, as in the legacy legend). */
  targetId: NodeId | null;
  className?: string;
}

/** Key to the map: true position, estimate, error line, axes and rings. */
export function LocMapLegend({ targetId, className }: LocMapLegendProps) {
  usePatternDefs();
  const tid = targetId ?? 'N1';
  const item = 'inline-flex items-center gap-1.5';
  const id = <span className="font-mono text-ink">{tid}</span>;
  return (
    <ul data-slot="loc-map-legend" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] leading-5 text-muted-foreground', className)}>
      <li className={cn(item, 'whitespace-nowrap')}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="shrink-0">
          <circle cx="7" cy="7" r="5" className="fill-none stroke-ink" strokeWidth="2.5" />
        </svg>
        <span>{id} true position</span>
      </li>
      <li className={cn(item, 'whitespace-nowrap')}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" className="shrink-0">
          <EstDot cx={7} cy={7} r={5} />
        </svg>
        <span>{id} estimate</span>
      </li>
      <li className={cn(item, 'whitespace-nowrap')}>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" focusable="false" className="shrink-0">
          <line x1="1" y1="5" x2="21" y2="5" className="stroke-ink" strokeWidth="2" strokeDasharray="3 3" />
        </svg>
        error
      </li>
      <li className={item}>
        <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" focusable="false" className="shrink-0">
          <line x1="1" y1="5" x2="21" y2="5" className="stroke-foreground/60" strokeWidth="1" strokeDasharray="4 4" />
        </svg>
        <span>dashed ring = estimated distance · axes in cm</span>
      </li>
    </ul>
  );
}
