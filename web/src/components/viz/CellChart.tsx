import { memo, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { netT } from '@/data/selectors';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  applyWindow, columnPath, lastOf, maxOf, niceCeil, quantise, relLabel, rowPath, sample, tickText, windowOf,
} from './cellMath';
import { useElementSize, usePatternDefs } from './hooks';
import { NodePattern } from './NodePattern';
import { NODE_FILL, fillFor, isNodeId, strokeWidthFor, type CellFill, type NodeId } from './patterns';

/** One series of a cell chart. Node series use `fill: NODE_FILL[id]`, which is that node's colour. */
export type Series = {
  id: string;
  label: string;
  fill: CellFill;
  /** Aligned to `t`. Null (or a missing sample) draws a hairline tick. */
  values: (number | null | undefined)[];
  /** Tooltip formatting: fmt(v, dec) + unit. */
  unit?: string;
  dec?: number;
  /** Multiples: this band's own min / max; overrides the chart's. */
  domain?: [number, number];
};

/**
 * Additive form (spec 02 §5, request 5): a series named by its node instead of a fill.
 * `'total'` is a network-wide series and is drawn as ink lines (the `water` fill).
 */
export type NodeSeries = Omit<Series, 'fill'> & { node: NodeId | 'total'; fill?: CellFill };
export type SeriesSpec = Series | NodeSeries;

export interface CellChartProps {
  /**
   * `single`: one series. `stacked`: series stacked in one band. `multiples`: one band per series, shared x.
   * Additive aliases: `series` = single for one series, multiples for more; `bar` = horizontal categorical bars.
   */
  mode: 'single' | 'stacked' | 'multiples' | 'series' | 'bar';
  /** `horizontal` = categorical bars: one row per series, each with one value. */
  orientation?: 'vertical' | 'horizontal';
  series: SeriesSpec[];
  /** Sample times (network ms) for the x labels and the tooltip. */
  t?: (number | string | null | undefined)[];
  /** Cell and gap in px. Default 6 and 2 (pitch 8). */
  cell?: number;
  gap?: number;
  /** Cells per band. Default 16 (single, stacked) or 6 per band (multiples); derived from `height` when that is set. */
  rows?: number;
  /** Default 0 and 'auto' (the next of 1, 2, 5 × 10ⁿ above the data). */
  min?: number;
  max?: number | 'auto';
  /** Default 3: first, middle, 'now'. */
  xTicks?: number;
  /** Default 3: min, mid, max. */
  yTicks?: number;
  /** For the accessible name and the caption of the fallback table. */
  title: string;
  loading?: boolean;
  emptyText?: string;

  /* ---- additive (spec 04 decision 9) ---- */
  /** Aliases of `min` / `max`. */
  yMin?: number;
  yMax?: number | 'auto';
  /** Defaults for every series' `unit` / `dec`. */
  unit?: string;
  decimals?: number;
  /** A cumulative counter: buckets keep their last value instead of the mean. */
  stepped?: boolean;
  /** Whole-number values: integer ticks and tooltip. */
  integer?: boolean;
  /** Colour key under the chart. Default: shown when there is more than one series. Not drawn for bars (label the fills in the view). */
  legend?: boolean;
  /** Total height in px; the row count is derived from it. */
  height?: number;
  /** `tail` (default) shows the newest samples one per column; `bucket` averages all samples into the columns. */
  fit?: 'tail' | 'bucket';
  className?: string;
}

interface Norm {
  id: string; label: string; fill: CellFill;
  values: (number | null)[];
  unit: string; dec: number;
  domain?: [number, number];
}

const GUTTER = 46, X_H = 18, BAND_GAP = 12;
const DEFAULT_EMPTY = 'One point arrives per superframe (every 3 s).';

function normalise(series: SeriesSpec[], unit: string | undefined, decimals: number | undefined, integer: boolean): Norm[] {
  return series.map((s) => {
    const fill: CellFill = s.fill ?? ('node' in s ? (s.node === 'total' ? 'water' : NODE_FILL[s.node]) : 'solid');
    return {
      id: s.id, label: s.label, fill,
      values: s.values.map(sample),
      unit: s.unit ?? unit ?? '',
      dec: s.dec ?? decimals ?? (integer ? 0 : 1),
      domain: s.domain,
    };
  });
}

function valueText(v: number | null, s: Norm): string {
  return v === null ? '—' : fmt(v, s.dec) + (s.unit ? ' ' + s.unit : '');
}

/** Cell paint for a fill: a solid tone step of the one ink (N1 100 %, N2 70 %, N3 45 %, N4 25 %), the total ink-2. */
function cellAttrs(fill: CellFill): { className?: string; fill?: string; inset: number } {
  const f = fillFor(fill);
  return { className: f.className, fill: f.fill, inset: strokeWidthFor(fill) / 2 };
}

/* ---------- visually hidden table: the chart for people who cannot see it ---------- */

const SrTable = memo(function SrTable({ id, title, head, rows }: { id: string; title: string; head: string[]; rows: string[][] }) {
  // The clip sits on a wrapper: `sr-only` on the <table> itself does not stop a table from laying
  // out at its unwrapped content width, which widened the page on phones.
  return (
    <div className="sr-only">
      <table id={id}>
        <caption>{title}</caption>
        <thead>
          <tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{r[0]}</th>
              {r.slice(1).map((c, j) => <td key={j}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function Legend({ series }: { series: Norm[] }) {
  return (
    <ul data-slot="cell-chart-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-muted-foreground">
      {series.map((s) => (
        <li key={s.id} className="inline-flex items-center gap-1.5">
          <NodePattern id={s.fill} size={12} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The one chart of the dashboard: columns of quantised cells. A node's series is drawn in that
 * node's tone step, a network-wide total as ink lines; every series is also named in the legend, the
 * tooltip and the hidden table. Hover or arrow keys read one column.
 */
export function CellChart(props: CellChartProps) {
  usePatternDefs();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const horizontal = props.orientation === 'horizontal' || props.mode === 'bar';
  return (
    <div ref={ref} data-slot="cell-chart" data-mode={props.mode} className={cn('relative w-full min-w-0', props.className)}>
      {size.width > 0 && (horizontal ? <Bars {...props} width={size.width} /> : <Columns {...props} width={size.width} />)}
    </div>
  );
}

/* ---------- vertical: time series ---------- */

interface Band {
  series: Norm[];
  min: number; max: number;
  top: number;
}

function Columns({
  mode, series, t, cell = 6, gap = 2, rows: rowsProp, min: minProp, max: maxProp, xTicks = 3, yTicks = 3,
  title, loading = false, emptyText, yMin, yMax, unit, decimals, stepped = false, integer = false,
  legend, height, fit = 'tail', width,
}: CellChartProps & { width: number }) {
  const uid = useId();
  const [active, setActive] = useState<number | null>(null);

  const multiples = mode === 'multiples' || (mode === 'series' && series.length > 1);
  const stacked = mode === 'stacked';
  const pitch = cell + gap, u = pitch / 8, cs = cell / u;
  const columns = Math.max(1, Math.floor((width - GUTTER) / pitch));
  const min = yMin ?? minProp ?? 0;
  const maxIn = yMax ?? maxProp ?? 'auto';

  const model = useMemo(() => {
    // `single` draws one series; anything after the first is ignored rather than half-shown.
    const all = normalise(series, unit, decimals, integer);
    const norm = multiples || stacked ? all : all.slice(0, 1);
    const n = norm.reduce((m, s) => Math.max(m, s.values.length), 0);
    const win = windowOf(n, columns, fit);
    const shown = norm.map((s) => ({ ...s, values: applyWindow(s.values, win, stepped) }));
    const times = win.to.map((b) => (t && b - 1 < t.length ? t[b - 1] : null));
    const empty = !norm.some((s) => s.values.some((v) => v !== null));
    return { norm, n, win, shown, times, empty };
  }, [series, t, unit, decimals, integer, columns, fit, stepped, multiples, stacked]);
  const { n, win, shown, times, empty } = model;

  const bandCount = multiples ? Math.max(1, shown.length) : 1;
  const rows = Math.max(2, rowsProp ?? (height
    ? Math.floor((height - X_H - (bandCount - 1) * BAND_GAP) / bandCount / pitch)
    : multiples ? 6 : 16));
  const bandH = rows * pitch;
  const plotH = bandCount * bandH + (bandCount - 1) * BAND_GAP;
  const svgH = plotH + X_H;
  const plotW = columns * pitch;
  const offset = columns - win.shown; // newest sample sits in the right-most column

  // Scales: a band's own `domain`, else the chart's min and max ('auto' is shared by every band without one).
  const bands: Band[] = useMemo(() => {
    let auto = 1;
    if (maxIn === 'auto') {
      let m = 0;
      if (stacked) {
        for (let k = 0; k < win.shown; k++) {
          let sum = 0;
          for (const s of shown) sum += s.values[k] ?? 0;
          if (sum > m) m = sum;
        }
      } else {
        for (const s of shown) if (!s.domain) m = Math.max(m, maxOf(s.values) ?? 0);
      }
      auto = Math.max(niceCeil(m), min + 1);
    }
    const max = maxIn === 'auto' ? auto : maxIn;
    if (!multiples) return [{ series: shown, min, max, top: 0 }];
    return shown.map((s, i) => ({
      series: [s],
      min: s.domain ? s.domain[0] : min,
      max: s.domain ? s.domain[1] : max,
      top: i * (bandH + BAND_GAP),
    }));
  }, [shown, win.shown, maxIn, min, stacked, multiples, bandH]);

  const tLast = times.length ? times[times.length - 1] : null;
  const tLabels = useMemo(() => times.map((x) => relLabel(x, tLast)), [times, tLast]);

  const tableId = `${uid}-table`;
  const table = useMemo(() => ({
    head: ['t', ...shown.map((s) => s.label + (s.unit ? ` (${s.unit})` : ''))],
    rows: tLabels.map((lab, k) => [
      (typeof times[k] === 'number' ? netT(times[k]) + ' · ' : '') + (lab || `sample ${k + 1}`),
      ...shown.map((s) => (s.values[k] === null ? '—' : fmt(s.values[k], s.dec))),
    ]),
  }), [shown, tLabels, times]);

  const label = `${title}: ${shown.map((s) => `${s.label} latest ${valueText(lastOf(s.values), s)}`).join(', ')}, ${n} samples`;
  const showLegend = legend ?? shown.length > 1;
  const note = win.bucketed
    ? `${n} samples in ${win.shown} columns`
    : n > win.shown ? `last ${win.shown} of ${n} samples` : null;

  if (loading) {
    let d = '';
    for (let b = 0; b < bandCount; b++) for (let c = 0; c < columns; c++) {
      d += `M${GUTTER + c * pitch + gap / 2} ${b * (bandH + BAND_GAP) + gap / 2}`;
      for (let r = 0; r < rows; r++) d += `h${cell}v${cell}h${-cell}v${-cell}m0 ${pitch}`;
    }
    return (
      <svg width={width} height={svgH} role="img" aria-label={`${title}: loading`} aria-busy="true" className="block motion-safe:animate-pulse">
        <path d={d} className="fill-hairline" />
      </svg>
    );
  }
  if (empty) {
    return (
      <div className="flex" style={{ minHeight: svgH }}>
        <EmptyState compact title="No samples yet" description={emptyText ?? DEFAULT_EMPTY} className="flex-1" />
      </div>
    );
  }

  const act = active !== null && active >= 0 && active < win.shown ? active : null;
  const shownCount = win.shown;
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = (from: (prev: number | null) => number) => {
      e.preventDefault();
      setActive((prev) => clampIndex(from(prev !== null && prev < shownCount ? prev : null), shownCount));
    };
    if (e.key === 'ArrowLeft') step((p) => (p ?? shownCount) - 1);
    else if (e.key === 'ArrowRight') step((p) => (p ?? -1) + 1);
    else if (e.key === 'Home') step(() => 0);
    else if (e.key === 'End') step(() => shownCount - 1);
    else if (e.key === 'Escape') setActive(null);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = Math.floor((e.clientX - r.left - GUTTER) / pitch) - offset;
    const y = e.clientY - r.top;
    setActive(k >= 0 && k < win.shown && y <= plotH + 2 ? k : null);
  };

  // x labels: first, …, 'now'; evenly spaced over the shown columns, never more than six.
  const ticks: number[] = [];
  const want = Math.max(1, Math.min(6, Math.max(2, xTicks), win.shown, Math.floor((win.shown * pitch) / 48)));
  for (let i = 0; i < want; i++) {
    const k = want === 1 ? win.shown - 1 : Math.round((i * (win.shown - 1)) / (want - 1));
    if (!ticks.includes(k) && tLabels[k]) ticks.push(k);
  }

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <svg
        width={width}
        height={svgH}
        viewBox={`0 0 ${width} ${svgH}`}
        role="img"
        aria-label={label}
        aria-describedby={tableId}
        aria-activedescendant={act !== null ? `${uid}-c${act}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        className="block"
      >
        {/* axes */}
        <g aria-hidden="true">
          {bands.map((b, bi) => {
            const bottom = b.top + bandH;
            const s0 = b.series[0];
            const count = multiples ? 2 : Math.max(2, yTicks);
            return (
              <g key={bi}>
                {Array.from({ length: count }, (_, i) => {
                  const f = i / (count - 1);
                  const v = b.min + (b.max - b.min) * f;
                  // top label hangs from the top edge, bottom label sits on the baseline, the rest are centred
                  const y = f === 1 ? b.top + 8 : f === 0 ? bottom : bottom - f * bandH + 3.5;
                  return (
                    <text key={i} x={GUTTER - 6} y={y} textAnchor="end" fontSize="12" className="tabular fill-graphite font-mono">
                      {tickText(v, integer)}
                    </text>
                  );
                })}
                {multiples && s0 && (
                  <g transform={`translate(${GUTTER - 6 - (isNodeId(s0.id) ? 26 : 10)} ${b.top + bandH / 2 - 5})`}>
                    <NodePattern id={s0.fill} size={10} />
                    {isNodeId(s0.id) && (
                      <text x="14" y="8.5" fontSize="12" className="fill-ink font-mono font-semibold">{s0.id}</text>
                    )}
                  </g>
                )}
                {Array.from({ length: count - 1 }, (_, i) => {
                  const gy = Math.round(bottom - ((i + 1) / (count - 1)) * bandH) + 0.5;
                  return <line key={i} x1={GUTTER} y1={gy} x2={GUTTER + plotW} y2={gy} className="stroke-[var(--ink-4)]" strokeWidth="1" strokeDasharray="1 3" />;
                })}
                <line x1={GUTTER} y1={bottom + 0.5} x2={GUTTER + plotW} y2={bottom + 0.5} className="stroke-hairline" strokeWidth="1" />
              </g>
            );
          })}
          {ticks.map((k, i) => {
            const x0 = GUTTER + (offset + k) * pitch;
            const first = i === 0 && k === 0, last = k === win.shown - 1;
            return (
              <text
                key={k}
                x={last ? x0 + pitch - gap / 2 : first ? x0 + gap / 2 : x0 + pitch / 2}
                y={plotH + 14}
                textAnchor={last ? 'end' : first ? 'start' : 'middle'}
                fontSize="12"
                className="tabular fill-graphite font-mono"
              >
                {tLabels[k]}
              </text>
            );
          })}
        </g>

        {/* active column: a hover band behind the cells */}
        {act !== null && (
          <rect x={GUTTER + (offset + act) * pitch} y={0} width={pitch} height={plotH} className="fill-hover" aria-hidden="true" />
        )}

        {/* columns */}
        {Array.from({ length: win.shown }, (_, k) => {
          const on = act === k;
          return (
            <g
              key={k}
              id={`${uid}-c${k}`}
              aria-label={`${table.rows[k][0]}: ${shown.map((s) => `${s.label} ${valueText(s.values[k], s)}`).join(', ')}`}
              transform={`translate(${GUTTER + (offset + k) * pitch} 0)`}
            >
              {bands.map((b, bi) => {
                let cum = 0, q0 = 0, anyNull = false, any = false;
                const parts = b.series.map((s) => {
                  const v = s.values[k];
                  if (v === null) { anyNull = true; return null; }
                  any = true;
                  cum += v;
                  const q1 = quantise(stacked ? cum : v, b.min, b.max, rows) ?? 0;
                  const a = cellAttrs(s.fill);
                  const d = columnPath(rows, stacked ? q0 : 0, q1, cs, a.inset);
                  q0 = Math.max(q0, q1);
                  return d ? <path key={s.id} d={d} className={a.className} fill={a.fill} strokeWidth={a.inset ? a.inset * 2 : undefined} /> : null;
                });
                return (
                  <g key={bi} transform={`translate(0 ${b.top}) scale(${u})`}>
                    {parts}
                    {anyNull && !any && <rect x={(8 - cs) / 2} y={rows * 8 - 1 / u - (8 - cs) / 2} width={cs} height={1 / u} className="fill-hairline" />}
                    {on && q0 > 0 && (
                      <path d={columnPath(rows, 0, q0, cs, 0)} className="fill-none stroke-ink" strokeWidth={1 / u} />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* tooltip, anchored to the active column */}
      <Tooltip open={act !== null}>
        <TooltipTrigger asChild>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0"
            style={{ left: GUTTER + (offset + (act ?? 0)) * pitch, width: pitch, height: plotH }}
          />
        </TooltipTrigger>
        {act !== null && (
          <TooltipContent side="top" sideOffset={6} updatePositionStrategy="always" className="pointer-events-none block max-w-none px-2.5 py-2">
            <div className="tabular flex flex-col gap-1 text-xs">
              <div className="font-mono opacity-70">{table.rows[act][0]}</div>
              {shown.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5">
                  <NodePattern id={s.fill} size={12} />
                  <span>{s.label}</span>
                  <span className="ml-auto pl-3 font-mono font-semibold">{valueText(s.values[act], s)}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        )}
      </Tooltip>

      {(showLegend || note) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {showLegend ? <Legend series={shown} /> : <span />}
          {note && <span data-slot="cell-chart-note" className="tabular text-[13px] text-muted-foreground">{note}</span>}
        </div>
      )}

      <SrTable id={tableId} title={title} head={table.head} rows={table.rows} />
    </TooltipProvider>
  );
}

function clampIndex(k: number, n: number): number {
  return n <= 0 ? 0 : k < 0 ? 0 : k > n - 1 ? n - 1 : k;
}

/* ---------- horizontal: categorical bars ---------- */

const LABEL_W = 72, ROW_GAP = 6;

function Bars({
  series, cell = 6, gap = 2, min: minProp, max: maxProp, title, loading = false, emptyText,
  yMin, yMax, unit, decimals, integer = false, width,
}: CellChartProps & { width: number }) {
  const uid = useId();
  const pitch = cell + gap, u = pitch / 8, cs = cell / u;
  const rowH = Math.max(pitch + ROW_GAP * 2, 20);
  const norm = useMemo(() => normalise(series, unit, decimals, integer), [series, unit, decimals, integer]);
  const vals = norm.map((s) => lastOf(s.values));
  const texts = norm.map((s, i) => valueText(vals[i], s));
  const empty = !vals.some((v) => v !== null);
  const min = yMin ?? minProp ?? 0;
  const maxIn = yMax ?? maxProp ?? 'auto';
  // The longest bar fills the track: categories are compared with each other, not with a round number.
  const max = maxIn === 'auto' ? Math.max(maxOf(vals) ?? 1, min + 1) : maxIn;

  const valueW = Math.ceil(texts.reduce((m, s) => Math.max(m, s.length), 1) * 6.6) + 8;
  const cols = Math.max(1, Math.floor((width - LABEL_W - valueW) / pitch));
  const svgH = Math.max(1, norm.length) * rowH;
  const tableId = `${uid}-table`;
  const maxChars = Math.floor((LABEL_W - 6) / 6.6);

  if (loading) {
    return (
      <svg width={width} height={svgH} role="img" aria-label={`${title}: loading`} aria-busy="true" className="block motion-safe:animate-pulse">
        {norm.map((s, i) => (
          <g key={s.id} transform={`translate(${LABEL_W} ${i * rowH + (rowH - pitch) / 2}) scale(${u})`}>
            <path d={rowPath(0, cols, cs)} className="fill-hairline" />
          </g>
        ))}
      </svg>
    );
  }
  if (empty) {
    return (
      <div className="flex" style={{ minHeight: svgH }}>
        <EmptyState compact title="No samples yet" description={emptyText ?? DEFAULT_EMPTY} className="flex-1" />
      </div>
    );
  }

  return (
    <>
      <svg
        width={width}
        height={svgH}
        viewBox={`0 0 ${width} ${svgH}`}
        role="img"
        aria-label={`${title}: ${norm.map((s, i) => `${s.label} ${texts[i]}`).join(', ')}`}
        aria-describedby={tableId}
        className="block"
      >
        {norm.map((s, i) => {
          const q = quantise(vals[i], min, max, cols) ?? 0;
          const a = cellAttrs(s.fill);
          const mid = i * rowH + rowH / 2;
          return (
            <g key={s.id} data-bar={s.id}>
              <title>{`${s.label}: ${texts[i]}`}</title>
              <text x={0} y={mid + 4} fontSize="12" className="fill-ink">
                {s.label.length > maxChars ? s.label.slice(0, maxChars - 1) + '…' : s.label}
              </text>
              <g transform={`translate(${LABEL_W} ${mid - pitch / 2}) scale(${u})`}>
                {q > 0 && <path d={rowPath(0, q, cs, a.inset)} className={a.className} fill={a.fill} strokeWidth={a.inset ? a.inset * 2 : undefined} />}
                {vals[i] === null && <rect x={(8 - cs) / 2} y={(8 - cs) / 2} width={1 / u} height={cs} className="fill-hairline" />}
              </g>
              <text x={width} y={mid + 4} textAnchor="end" fontSize="12" className="tabular fill-ink font-mono font-medium">{texts[i]}</text>
            </g>
          );
        })}
      </svg>
      <SrTable id={tableId} title={title} head={['Item', 'Value']} rows={norm.map((s, i) => [s.label, texts[i]])} />
    </>
  );
}
