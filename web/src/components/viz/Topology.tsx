import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { KeyValue, type KeyValueItem } from '@/components/aq/KeyValue';
import { RoutePath } from '@/components/aq/RoutePath';
import { StatusChip } from '@/components/aq/StatusChip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useSnapshot } from '@/data/hooks';
import {
  link as linkOf, linkState, macAddr, node as nodeOf, positions, sensorText, slots as slotsOf, thresholdFlag,
} from '@/data/selectors';
import type { Link, NodeState } from '@/data/types';
import { ALL_PAIRS, SHORT_ROLE } from '@/lib/constants';
import { parsePath } from '@/lib/events';
import { fmtAgo, fmtI } from '@/lib/format';
import { nId, num } from '@/lib/safe';
import { cn } from '@/lib/utils';
import { useReducedMotion } from './hooks';
import { NodeGlyph } from './NodeGlyph';
import { NODE_ORDER, PATTERN_ID, type NodeId } from './patterns';
import {
  layoutTopology, PAD_X, routePath, routeSegments, type LinkInput, type NodeLabelText, type Rect, type RouteSegment,
  type TopoLayout, type TopoLayoutInput, type XY,
} from './topoLayout';
import './viz.css';

export type TopologyTarget = { kind: 'node'; id: NodeId } | { kind: 'link'; a: NodeId; b: NodeId };

export interface TopologyProps {
  /** The stage box; viewBox = `0 0 ${width} ${height}`, so 1 unit = 1 CSS px. */
  width: number;
  height: number;
  /** True on a small stage: pad 40, node 24, label 10 px. */
  compact?: boolean;
  /** Default true; forced false under reduced motion. */
  showPackets?: boolean;
  /** Dim every segment that is not on this node's route to a hairline. */
  highlightRoute?: NodeId | null;
  onSelect?: (target: TopologyTarget) => void;

  /* ---- additive (spec 03 §6, request 6) ---- */
  /** Draw the link lines. Default true. */
  showLinks?: boolean;
  /** Draw the current route of N1–N3. Default true. */
  showRoutes?: boolean;
  /** Alias of `showPackets`; both must be true for packets to move. Default true. */
  animatePackets?: boolean;
  /**
   * `true` (default): ACK % on links that are up, plus `link down` and `not in range`.
   * `'down-only'`: the two state labels without ACK % (the Overview). `false`: none.
   */
  linkLabels?: boolean | 'down-only';
  /** Render the legend list after the map. Default false (PondStage places its own). */
  legend?: boolean;
  /**
   * True only when something is drawn behind the map: Topology then leaves its background clear.
   * Default false (the dither field is gone; the map paints its own card background).
   */
  showField?: boolean;
  /** Optional top-right caption in a knockout box, longest wording first; the first that fits is drawn. */
  captionRight?: string | string[];
  className?: string;
}

interface RouteDraw { nid: NodeId; hops: number[]; d: string; idx: number }

/** One directed hop, shared by every route that takes it; drawn once. */
interface SegmentDraw extends RouteSegment { key: string; users: NodeId[] }

type LinkKind = 'up' | 'down' | 'oor' | 'unknown';

const LINK_STROKE: Record<LinkKind, { className: string; width: number; dash?: string }> = {
  // the route is the 2 px ink line; a link that is merely up stays a 1 px ink-3 line
  up: { className: 'stroke-hairline', width: 1 },
  down: { className: 'stroke-bad', width: 1.5, dash: '5 4' },
  oor: { className: 'stroke-hairline', width: 1, dash: '2 4' },
  unknown: { className: 'stroke-hairline', width: 1 },
};

/** Baseline that centres a line of Geist Mono on `cy` (cap height ≈ 0.72 em), without dominant-baseline. */
function baseline(cy: number, fs: number): number {
  return Math.round((cy + fs * 0.36) * 2) / 2;
}

function isInactive(n: NodeState): boolean {
  return String(n.status || '').toLowerCase() === 'inactive';
}
function statusWord(n: NodeState): string {
  const s = String(n.status || '').toLowerCase();
  return s === 'active' || s === 'inactive' ? s : (n.status ? String(n.status) : 'status unknown');
}
function pairKey(a: number, b: number): string {
  return `${a}-${b}`;
}
function linkKind(d: Parameters<typeof linkState>[0], a: number, b: number): LinkKind {
  if (a === 1 && b === 4) return 'oor';
  return linkState(d, a, b);
}

/**
 * A pill label: the card colour, a 1 px ink-3 border (a failed link's label: the `bad` border and
 * text), mono text. Opaque, so it hides whatever it sits across.
 */
function Knockout({ box, fs, down, words, children }: { box: Rect; fs: number; down?: boolean; words?: boolean; children: ReactNode }) {
  const x = Math.round(box.x) + 0.5, y = Math.round(box.y) + 0.5, w = Math.round(box.w) - 1, h = Math.round(box.h) - 1;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} className={cn('fill-card', down ? 'stroke-bad' : 'stroke-hairline')} strokeWidth="1" />
      <text fontSize={fs} className={cn(words ? 'font-sans' : 'tabular font-mono', down ? 'fill-bad' : 'fill-ink')}>{children}</text>
    </g>
  );
}

/**
 * The network as a map: nodes at their true positions in cm as four glyphs (circle, teardrop,
 * hexagon, house) in their fills, links by state, and the current routes drawn hop by hop as 2 px ink
 * lines with a 6 px square packet moving along each. One ink on the ground; red only for a failed link.
 */
export function Topology({
  width, height, compact = false, showPackets = true, highlightRoute = null, onSelect,
  showLinks = true, showRoutes = true, animatePackets = true, linkLabels = true, legend = false,
  showField = false, captionRight, className,
}: TopologyProps) {
  const snap = useSnapshot();
  const reduced = useReducedMotion();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const d = snap.data;
  const packets = showPackets && animatePackets && !reduced;

  /* ---- data → drawable facts ---- */
  const nodes = NODE_ORDER.map((id) => nodeOf(d, id));
  const P = positions(d);
  const sensors = nodes.map((n) => sensorText(d, n));
  // In full for the hover card and the accessible name …
  const readings = sensors.map((sv, i) => (NODE_ORDER[i] === 'N4' ? `${sv.v} status light` : `${sv.v} ${sv.u}`));
  // … and short for the one-line label on the map: `28.89 °C`, `1,854 ADC`, `Green`.
  const short = sensors.map((sv, i) => (NODE_ORDER[i] === 'N4' ? sv.v : `${sv.v} ${sv.u.replace(/^raw\s+/i, '')}`.trim()));
  const kinds = ALL_PAIRS.map(([a, b]) => linkKind(d, a, b));
  const linkText = ALL_PAIRS.map(([a, b], i): string | null => {
    if (!linkLabels || !showLinks) return null;
    const k = kinds[i];
    if (k === 'oor') return 'Not in range';
    if (k === 'down') return 'Link down';
    if (k === 'unknown') return null;
    // The Overview asks for the states only. A compact stage has room for those (down, out of
    // range) but not for six boxes either: ACK % stays in the hover card there.
    if (linkLabels === 'down-only' || compact) return null;
    const ack = num(linkOf(d, a, b)?.ack_pct);
    return ack !== null ? `ACK ${fmtI(ack)} %` : null;
  });
  const captions = captionRight == null ? [] : Array.isArray(captionRight) ? captionRight : [captionRight];

  // The layout depends only on a handful of strings and numbers. Its input is serialised and used
  // as the memo key, so the label search runs when something visible changes, not on every poll.
  const labels = Object.fromEntries(NODE_ORDER.map((id, i) => [
    id, { id, reading: short[i], inactive: isInactive(nodes[i]) },
  ])) as Record<NodeId, NodeLabelText>;
  const links: LinkInput[] = ALL_PAIRS.map(([a, b], i) => ({
    a, b, label: linkText[i], oor: a === 1 && b === 4, down: kinds[i] === 'down',
  }));
  const input: TopoLayoutInput = {
    width: Math.max(1, width), height: Math.max(1, height), compact, positions: P, labels, links,
    captionLeft: null, captionRight: captions, scaleBar: true,
  };
  const inputKey = JSON.stringify(input);
  const L: TopoLayout = useMemo(() => layoutTopology(JSON.parse(inputKey) as TopoLayoutInput), [inputKey]);

  /* ---- routes (N1..N3, active, ≥ 2 hops) ---- */
  const routes: RouteDraw[] = [];
  if (showRoutes) {
    (['N1', 'N2', 'N3'] as NodeId[]).forEach((nid) => {
      const n = nodeOf(d, nid);
      if (isInactive(n)) return;
      const hops = parsePath(n.route).filter((h) => h >= 1 && h <= 4);
      if (hops.length < 2) return;
      const idx = routes.length;
      routes.push({ nid, hops, idx, d: routePath(hops, L.centre) });
    });
  }
  // The same hop on two routes is one segment: N3 → N4 carries N1, N2 and N3 but is drawn once.
  const segments: SegmentDraw[] = [];
  routes.forEach((rt) => {
    routeSegments(rt.hops, L.centre).forEach((sg) => {
      const key = `${sg.a}-${sg.b}`.toLowerCase();
      const seen = segments.find((x) => x.key === key);
      if (seen) seen.users.push(rt.nid);
      else segments.push({ ...sg, key, users: [rt.nid] });
    });
  });
  const usedBy = (a: number, b: number): string[] => {
    const out: string[] = [];
    (['N1', 'N2', 'N3'] as NodeId[]).forEach((nid) => {
      const n = nodeOf(d, nid);
      if (isInactive(n)) return;
      const hops = parsePath(n.route);
      for (let i = 0; i + 1 < hops.length; i++) {
        if ((hops[i] === a && hops[i + 1] === b) || (hops[i] === b && hops[i + 1] === a)) { out.push(nid); break; }
      }
    });
    return out;
  };

  const { n: G, fs, hx } = L;
  const showBackdrop = !showField;
  const routeW = 2, packetS = 6;
  const allSlots = slotsOf(d);

  /* ---- hover-card plumbing ---- */
  const cardProps = (key: string) => ({
    open: openKey === key,
    onOpenChange: (o: boolean) => setOpenKey((prev) => (o ? key : prev === key ? null : prev)),
    openDelay: 150,
    closeDelay: 100,
  });
  const triggerProps = (key: string, target: TopologyTarget) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => onSelect?.(target),
    onKeyDown: (e: KeyboardEvent<SVGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(target); }
      if (e.key === 'Escape') setOpenKey(null);
    },
    // Hover cards ignore touch; a tap toggles the card instead.
    onPointerUp: (e: PointerEvent<SVGElement>) => {
      if (e.pointerType === 'touch') setOpenKey((prev) => (prev === key ? null : key));
    },
  });

  const svg = (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Network topology map, nodes at their true positions in cm"
      data-slot="topology"
      data-compact={compact || undefined}
      className={cn('block select-none', className)}
    >
      <title>Network topology map, nodes at their true positions in cm</title>
      {/* backdrop: the ground and a faint dot matrix */}
      <g data-slot="topology-backdrop" aria-hidden="true">
        <rect width={width} height={height} className="fill-card" />
        {showBackdrop && <rect width={width} height={height} fill={`url(#${PATTERN_ID.matrix})`} />}
      </g>

      {/* scale: a 30 cm bar (and a caption, when the caller hands one in) */}
      <g data-slot="topology-scale" aria-hidden="true">
        {L.scale && (
          <g>
            <path
              d={`M${L.scale.x} ${L.scale.y - 4}V${L.scale.y}H${L.scale.x + L.scale.len}V${L.scale.y - 4}`}
              className="fill-none stroke-graphite"
              strokeWidth="1"
            />
            <text x={L.scale.x + L.scale.len / 2} y={L.scale.y - 8} textAnchor="middle" fontSize="12" className="tabular fill-graphite font-mono">
              30 cm
            </text>
          </g>
        )}
        {L.captionRight && (
          <Knockout box={L.captionRight.box} fs={12}>
            <tspan x={L.captionRight.box.x + PAD_X} y={baseline(L.captionRight.box.y + L.captionRight.box.h / 2, 12)} className="fill-graphite">
              {L.captionRight.text}
            </tspan>
          </Knockout>
        )}
      </g>

      {/* links: 1 px ink-3 lines; a failed link is dashed red, an out-of-range one is dotted */}
      {showLinks && (
        <g data-slot="topology-links" aria-hidden="true">
          {L.links.map((l, i) => {
            const st = LINK_STROKE[kinds[i]];
            return (
              <g key={pairKey(l.a, l.b)}>
                <line
                  data-link={pairKey(l.a, l.b)}
                  data-state={kinds[i]}
                  x1={l.A[0]} y1={l.A[1]} x2={l.B[0]} y2={l.B[1]}
                  className={st.className}
                  strokeWidth={st.width}
                  strokeDasharray={st.dash}
                  strokeLinecap={kinds[i] === 'oor' ? 'square' : undefined}
                />
              </g>
            );
          })}
        </g>
      )}

      {/* routes: one path per hop, 2 px ink; a packet (a 6 px ink square) travels each route */}
      <g data-slot="topology-routes" aria-hidden="true">
        {segments.map((sg) => {
          const dim = highlightRoute != null && !sg.users.includes(highlightRoute);
          return (
            <g key={sg.key} data-route-segment={sg.key} data-used-by={sg.users.join(' ')} data-dim={dim || undefined}>
              <path d={sg.d} className={cn('fill-none', dim ? 'stroke-hairline' : 'stroke-ink')} strokeWidth={dim ? 1 : routeW} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {/* packets: keyed by the hop list so an animation restarts only on a route change. A negative
            begin starts mid-loop. No halo and no trail. */}
        {packets && routes.map((rt) => {
          const dur = `${(0.9 * (rt.hops.length - 1) + 0.6).toFixed(1)}s`;
          const t0 = -(rt.idx * 0.45 + 1);
          return (
            <g key={`pkt:${rt.nid}:${rt.hops.join('>')}`} data-packet={rt.nid}>
              <g>
                <circle r={packetS / 2} className="fill-ink stroke-card" strokeWidth="1.5" />
                <animateMotion dur={dur} begin={`${t0.toFixed(2)}s`} repeatCount="indefinite" path={rt.d} />
              </g>
            </g>
          );
        })}
      </g>

      {/* link labels */}
      <g data-slot="topology-link-labels" aria-hidden="true">
        {L.links.map((l, i) => l.label && (
          <Knockout key={pairKey(l.a, l.b)} box={l.label.box} fs={12} down={kinds[i] === 'down'} words={kinds[i] !== 'up'}>
            <tspan
              x={l.label.box.x + l.label.box.w / 2}
              y={baseline(l.label.box.y + l.label.box.h / 2, 12)}
              textAnchor="middle"
              className={kinds[i] === 'down' ? 'fill-bad' : kinds[i] === 'oor' ? 'fill-graphite' : 'fill-ink'}
            >
              {l.label.text}
            </tspan>
          </Knockout>
        ))}
      </g>

      {/* nodes: colour glyph, one-line label box, hover / focus detail. Tab order N1..N4. */}
      <g data-slot="topology-nodes">
        {NODE_ORDER.map((id, i) => {
          const n = nodes[i];
          const [cx, cy] = L.centre[id];
          const inactive = isInactive(n);
          const lab = L.nodeLabels[id];
          const key = `node:${id}`;
          const x0 = Math.round(cx - G / 2), y0 = Math.round(cy - G / 2);
          return (
            <HoverCard key={id} {...cardProps(key)}>
              <HoverCardTrigger asChild>
                <g
                  {...triggerProps(key, { kind: 'node', id })}
                  aria-label={`${id}, ${SHORT_ROLE[id]}, ${statusWord(n)}, ${readings[i]}`}
                  data-node={id}
                  data-inactive={inactive || undefined}
                  className="group cursor-pointer outline-none"
                >
                  {/* hover: a faint ink-4 disc behind the glyph. Focus: a 2 px ink ring, 2 px off. */}
                  <rect
                    x={x0 - 6} y={y0 - 6} width={G + 12} height={G + 12} rx={(G + 12) / 2}
                    className="fill-[var(--ink-4)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  />
                  <rect
                    x={x0 - 6} y={y0 - 6} width={G + 12} height={G + 12} rx={(G + 12) / 2}
                    className="fill-none stroke-ink opacity-0 group-focus-visible:opacity-100"
                    strokeWidth="2"
                  />
                  <NodeGlyph as="g" id={id} size={G} x={cx} y={cy} state={inactive ? 'inactive' : 'active'} />
                  <Knockout box={lab.box} fs={fs}>
                    <tspan x={lab.box.x + PAD_X} y={baseline(lab.box.y + lab.box.h / 2, fs)}>
                      <tspan className="font-semibold">{lab.id}</tspan>
                      <tspan className="fill-graphite">{' · '}</tspan>
                      <tspan>{lab.text}</tspan>
                    </tspan>
                  </Knockout>
                </g>
              </HoverCardTrigger>
              <HoverCardContent side="right" align="start" sideOffset={10} className="w-76 p-4">
                <NodeDetail id={id} n={n} reading={readings[i]} slots={allSlots} mac={macAddr(d, n)} />
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </g>

      {/* link hit lines, after the nodes so Tab reaches them in ALL_PAIRS order once the nodes are done */}
      {showLinks && (
        <g data-slot="topology-link-hits">
          {L.links.map((l, i) => {
            const a = ('N' + l.a) as NodeId, b = ('N' + l.b) as NodeId;
            const key = `link:${pairKey(l.a, l.b)}`;
            const lk = linkOf(d, l.a, l.b);
            const kind = kinds[i];
            const ack = num(lk?.ack_pct);
            // Stop short of the glyphs so the hit area never covers a node.
            const dx = l.B[0] - l.A[0], dy = l.B[1] - l.A[1], len = Math.hypot(dx, dy) || 1;
            const trim = Math.min(hx + 2, len / 3);
            const ux = dx / len, uy = dy / len;
            const p1: XY = [l.A[0] + ux * trim, l.A[1] + uy * trim], p2: XY = [l.B[0] - ux * trim, l.B[1] - uy * trim];
            const nx = -uy * 7, ny = ux * 7;
            const ring = `M${p1[0] + nx} ${p1[1] + ny}L${p2[0] + nx} ${p2[1] + ny}L${p2[0] - nx} ${p2[1] - ny}L${p1[0] - nx} ${p1[1] - ny}Z`;
            const word = kind === 'up' ? 'up' : kind === 'down' ? 'down' : kind === 'oor' ? 'not in range' : 'not seen';
            return (
              <HoverCard key={key} {...cardProps(key)}>
                <g data-link-hit={pairKey(l.a, l.b)}>
                  <HoverCardTrigger asChild>
                    <line
                      {...triggerProps(key, { kind: 'link', a, b })}
                      aria-label={`Link ${a}–${b}, ${word}${ack !== null && kind !== 'oor' ? `, ACK ${fmtI(ack)} %` : ''}`}
                      x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]}
                      className="peer cursor-pointer stroke-transparent outline-none [pointer-events:stroke]"
                      strokeWidth="14"
                    />
                  </HoverCardTrigger>
                  <path
                    d={ring}
                    className="pointer-events-none fill-none stroke-ink opacity-0 transition-opacity duration-150 peer-hover:opacity-40 peer-focus-visible:opacity-100"
                    strokeWidth="2"
                    strokeDasharray="2 2"
                  />
                </g>
                <HoverCardContent side="top" sideOffset={6} className="w-64 p-4">
                  <LinkDetail a={a} b={b} kind={kind} link={lk} usedBy={usedBy(l.a, l.b)} />
                </HoverCardContent>
              </HoverCard>
            );
          })}
        </g>
      )}
    </svg>
  );

  if (!legend) return svg;
  return (
    <>
      {svg}
      <TopologyLegend className="mt-3" />
    </>
  );
}

/* ---------- hover-card bodies ---------- */

function NodeDetail({ id, n, reading, slots, mac }: { id: NodeId; n: NodeState; reading: string; slots: number[]; mac: string | null }) {
  const k = Number(id.slice(1));
  const flag = thresholdFlag(n);
  const st = String(n.status || '').toLowerCase();
  const own = slots.map((o, i) => (o === k ? i : -1)).filter((i) => i >= 0);
  const wifi = num(n.wifi_rssi), ble = num(n.ble_rssi);
  const altCost = num(n.alt_cost), altHop = num(n.alt_next_hop);
  const items: KeyValueItem[] = [
    { k: 'Role', v: n.role || '—' },
    {
      k: 'Status',
      v: st === 'active' ? <StatusChip tone="ok" dot size="sm">Active</StatusChip>
        : st === 'inactive' ? <StatusChip tone="bad" dot size="sm">Inactive</StatusChip>
          : <StatusChip tone="neutral" size="sm">{n.status || 'Unknown'}</StatusChip>,
    },
    {
      k: 'Reading',
      v: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="tabular font-mono">{reading}</span>
          {flag && <StatusChip tone={flag.tone} size="sm">{flag.label}</StatusChip>}
        </span>
      ),
    },
    { k: 'Route', v: id === 'N4' ? '—' : <RoutePath path={n.route ?? null} /> },
    { k: 'Next hop', v: id === 'N4' ? 'is the sink' : nId(n.next_hop), mono: id !== 'N4' },
    { k: 'Hops', v: id === 'N4' ? '—' : fmtI(n.hops), mono: true },
    {
      k: 'Route cost',
      v: num(n.route_cost) === null ? '—' : fmtI(n.route_cost) + (altCost !== null ? ` · alt ${fmtI(altCost)} via ${nId(altHop)}` : ''),
      mono: true,
    },
    { k: 'Wi-Fi / BLE RSSI', v: wifi === null && ble === null ? '—' : `${wifi ?? '—'} / ${ble ?? '—'} dBm`, mono: true },
    { k: 'TDMA slot', v: own.length ? own.join(', ') : id === 'N4' ? 'listens' : '—', mono: own.length > 0 },
    { k: 'Last heard', v: num(n.last_seen_s) === null ? '—' : fmtAgo(n.last_seen_s), mono: true },
    { k: 'MAC', v: mac || '—', mono: true },
  ];
  return (
    <div data-slot="topology-node-detail" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <NodeGlyph id={id} size={16} />
        <span className="font-mono text-sm font-semibold">{id}</span>
        <span className="text-[13px] text-muted-foreground">{SHORT_ROLE[id]}</span>
      </div>
      <KeyValue items={items} dense />
    </div>
  );
}

function LinkDetail({ a, b, kind, link, usedBy }: { a: NodeId; b: NodeId; kind: LinkKind; link: Link | null; usedBy: string[] }) {
  const state = kind === 'up' ? <StatusChip tone="ok" size="sm">Up</StatusChip>
    : kind === 'down' ? (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <StatusChip tone="bad" size="sm">Down</StatusChip>
        {link?.blocked === true && <span className="text-muted-foreground">· blocked by dashboard</span>}
      </span>
    )
      : kind === 'oor' ? <StatusChip tone="neutral" size="sm">Not in range</StatusChip>
        : <StatusChip tone="neutral" size="sm">Not seen</StatusChip>;
  const ack = num(link?.ack_pct), wifi = num(link?.wifi_rssi), ble = num(link?.ble_rssi);
  const items: KeyValueItem[] = [
    { k: 'State', v: state },
    { k: 'ACK', v: ack === null ? '—' : `${fmtI(ack)} %`, mono: true },
    { k: 'Wi-Fi RSSI', v: wifi === null ? '—' : `${wifi} dBm`, mono: true },
    { k: 'BLE RSSI', v: ble === null ? '—' : `${ble} dBm`, mono: true },
    { k: 'Used by', v: usedBy.length ? usedBy.join(', ') : kind === 'oor' ? 'no route: N1 must multi-hop' : 'no current route', mono: usedBy.length > 0 },
  ];
  return (
    <div data-slot="topology-link-detail" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <NodeGlyph id={a} size={12} />
        <NodeGlyph id={b} size={12} />
        <span className="font-mono text-sm font-semibold">{a}–{b}</span>
      </div>
      <KeyValue items={items} dense />
    </div>
  );
}

/* ---------- legend ---------- */

function LineSample({ className, dash, width = 1.25 }: { className: string; dash?: string; width?: number }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" focusable="false" className="shrink-0">
      <line x1="1" y1="5" x2="21" y2="5" className={className} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

export interface TopologyLegendProps {
  /** Unused: the dither field it explained is gone. Kept so existing callers still compile. */
  field?: boolean;
  className?: string;
}

/** Key to the map, one line: the four node colours with their ids and the three link states. */
export function TopologyLegend({ className }: TopologyLegendProps) {
  const item = 'inline-flex items-center gap-1.5 whitespace-nowrap';
  return (
    <ul data-slot="topology-legend" className={cn('legend flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] leading-5 text-muted-foreground', className)}>
      {NODE_ORDER.map((id) => (
        <li key={id} className={item}>
          <NodeGlyph id={id} size={12} />
          <span className="font-mono text-ink">{id}</span>
        </li>
      ))}
      <li className={item}><LineSample className="stroke-ink" width={2} />route</li>
      <li className={item}><LineSample className="stroke-hairline" width={1} />link</li>
      <li className={item}><LineSample className="stroke-bad" dash="5 4" width={1.5} />down</li>
      <li className={item}><LineSample className="stroke-hairline" dash="2 4" width={1} />not in range</li>
    </ul>
  );
}
