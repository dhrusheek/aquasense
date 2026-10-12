import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { KeyValue } from '@/components/aq/KeyValue';
import { NodeGlyph } from '@/components/viz/NodeGlyph';
import { NodePattern } from '@/components/viz/NodePattern';
import { cn } from '@/lib/utils';

export interface FanInput {
  id: 'N1' | 'N2' | 'N3';
  title: string;
  /** Right-aligned chips: the th flag, the sample count. */
  chips: ReactNode;
  value: string;
  unit: string;
  /** Window statistics, mono. Left out for N3, which reads its own sensor. */
  line?: string;
}

export interface FanOutput {
  title: string;
  sub: ReactNode;
  /** Headline pairs, e.g. Packets `2` `→ 1`. */
  tiles: { label: string; value: string; arrow: string }[];
  kv: { key: string; value: ReactNode; mono?: boolean }[];
}

export interface AggFanInProps {
  inputs: FanInput[];
  output: FanOutput;
  /** No AGG frame yet: the output card shows `emptyText` instead of its figures. */
  empty?: boolean;
  emptyText?: string;
  className?: string;
}

/* Connector geometry in px. The column is 72 wide and sits between two 12 px grid gaps, which the
   lines cross so they touch the cards on both sides. */
const COL = 72, GAP = 12, TRUNK = 6, SQ = 20, SQ_X = (COL - SQ) / 2;
const STROKE = 'fill-none stroke-foreground';

interface Geom { h: number; ys: number[] }

/** Height of the connector column and the vertical centre of every input card inside it. */
function useFanGeometry(count: number) {
  const col = useRef<HTMLDivElement | null>(null);
  const cards = useRef<(HTMLLIElement | null)[]>([]);
  const [geom, setGeom] = useState<Geom>({ h: 0, ys: [] });

  useEffect(() => {
    const el = col.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const h = Math.round(box.height); // 0 while the column is hidden (stacked layout)
      const ys = cards.current.slice(0, count).map((c) => {
        if (!c) return h / 2;
        const r = c.getBoundingClientRect();
        return Math.round((r.top - box.top + r.height / 2) * 2) / 2;
      });
      setGeom((prev) => (
        prev.h === h && prev.ys.length === ys.length && prev.ys.every((y, i) => y === ys[i]) ? prev : { h, ys }
      ));
    };
    // The observer reports once on observe(), so no separate first measurement is needed.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    cards.current.slice(0, count).forEach((c) => { if (c) ro.observe(c); });
    return () => ro.disconnect();
  }, [count]);

  return { col, cards, geom };
}

/**
 * The aggregation window as a fan-in: the input cards on the left, one line from each converging on
 * the cluster-head glyph, one line on to the output card, all 1 px lines. Below 560 px of width the three parts stack and the connector is a down arrow.
 */
export function AggFanIn({
  inputs, output, empty = false, emptyText = 'The first AGG frame from N3 fills this window.', className,
}: AggFanInProps) {
  const { col, cards, geom } = useFanGeometry(inputs.length);
  const mid = Math.round(geom.h) / 2;

  return (
    <div data-slot="agg-fan-in" className={cn('@container', className)}>
      <div
        role="group"
        aria-label={`${inputs.length} inputs aggregate at N3 into one AGG frame`}
        className="grid grid-cols-1 gap-3 @[560px]:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)]"
      >
        {/* inputs */}
        <ul aria-label="Inputs of this window" className="flex min-w-0 flex-col gap-2">
          {inputs.map((inp, i) => (
            <li
              key={inp.id}
              ref={(el) => { cards.current[i] = el; }}
              data-slot="agg-input"
              data-node={inp.id}
              className="flex min-w-0 flex-1 flex-col justify-center rounded-2xl border border-border bg-card p-4 text-card-foreground"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <h3 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <NodePattern id={inp.id} size={12} />
                  <span className="min-w-0">{inp.title}</span>
                </h3>
                <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">{inp.chips}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                <span
                  data-slot="agg-input-value"
                  className={cn('tabular font-mono text-[28px] leading-8 font-medium', inp.value === '—' ? 'text-muted-foreground' : 'text-foreground')}
                >
                  {inp.value}
                </span>
                <span className="font-mono text-[13px] text-muted-foreground">{inp.unit}</span>
              </div>
              {inp.line && <p className="tabular mt-1 font-mono text-[13px] text-muted-foreground">{inp.line}</p>}
            </li>
          ))}
        </ul>

        {/* connector, side by side: lines from the input centres to the square, then to the output */}
        <div ref={col} aria-hidden="true" className="relative hidden @[560px]:block">
          {geom.h > 0 && (
            <svg
              width={COL}
              height={geom.h}
              viewBox={`0 0 ${COL} ${geom.h}`}
              focusable="false"
              className="absolute inset-0 block overflow-visible"
            >
              {geom.ys.map((y, i) => (
                <path key={i} d={`M${-GAP} ${y}H${TRUNK}V${mid}H${SQ_X}`} className={STROKE} strokeWidth="1" />
              ))}
              <path d={`M${SQ_X + SQ} ${mid}H${COL + GAP}`} className={STROKE} strokeWidth="1" />
              <path d={`M${COL + GAP - 7} ${mid - 5}L${COL + GAP - 1} ${mid}L${COL + GAP - 7} ${mid + 5}`} className="fill-none stroke-foreground" strokeWidth="1" />
              <NodeGlyph as="g" id="N3" size={20} x={COL / 2} y={mid} />
              {/* the caption clears the trunk at x = 6: nine characters at 12 px are about 55 px wide */}
              <text x={COL / 2 + 5} y={mid + 22} textAnchor="middle" fontSize="12" className="fill-graphite">aggregate</text>
              <text x={COL / 2 + 5} y={mid + 35} textAnchor="middle" fontSize="12" className="fill-graphite">at N3</text>
            </svg>
          )}
        </div>

        {/* connector, stacked: a down arrow */}
        <div aria-hidden="true" className="flex items-center justify-center gap-3 @[560px]:hidden">
          <svg width="24" height="40" viewBox="0 0 24 40" focusable="false" className="block shrink-0 overflow-visible">
            <NodeGlyph as="g" id="N3" size={20} x={12} y={10} />
            <path d="M12 21V38M5 31l7 7 7-7" className="fill-none stroke-foreground" strokeWidth="1" />
          </svg>
          <span className="text-[13px] text-muted-foreground">aggregate at N3</span>
        </div>

        {/* output */}
        <div
          data-slot="agg-output"
          className="flex min-w-0 flex-col gap-4 rounded-2xl border border-foreground bg-card p-4 text-card-foreground"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{output.title}</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">{output.sub}</p>
          </div>
          {empty ? (
            <EmptyState compact description={emptyText} className="flex-1" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {output.tiles.map((t) => (
                  <div
                    key={t.label}
                    role="group"
                    aria-label={`${t.label}: ${t.value} ${t.arrow}`}
                    className="flex min-w-0 flex-col gap-1 rounded-xl bg-[var(--ink-4)] p-3"
                  >
                    <span className="text-[13px] text-muted-foreground">{t.label}</span>
                    <span className={cn('tabular font-mono text-2xl leading-8 font-medium', t.value === '—' ? 'text-muted-foreground' : 'text-foreground')}>{t.value}</span>
                    <span className="tabular font-mono text-sm text-foreground">{t.arrow}</span>
                  </div>
                ))}
              </div>
              <KeyValue
                dense
                items={output.kv.map((r) => ({ k: r.key, v: r.value, mono: r.mono }))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
