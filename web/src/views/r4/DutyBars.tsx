import { EmptyState } from '@/components/aq/EmptyState';
import { Meter } from '@/components/aq/Meter';
import { NodePattern } from '@/components/viz/NodePattern';
import type { NodeId, Num } from '@/data/types';
import { fmt, fmtSec } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DutyRow {
  node: NodeId;
  /** Share of time awake in %, or null when the node has not reported it. */
  duty: number | null;
  awakeMs: Num;
  sleepMs: Num;
}

export interface DutyBarsProps {
  rows: DutyRow[];
  className?: string;
}

/** Sleep / wake per node: a thin progress bar, filled for the share of time spent awake. */
export function DutyBars({ rows, className }: DutyBarsProps) {
  if (!rows.length) {
    return (
      <EmptyState
        compact
        className={className}
        description="No duty-cycle figures yet. Each node reports its awake and asleep time in its STAT frame; one bar per node appears here."
      />
    );
  }
  return (
    <ul data-slot="duty-bars" className={cn('flex flex-col divide-y divide-border', className)}>
      {rows.map((r) => {
        const text = fmt(r.duty, 1, '%');
        return (
          <li
            key={r.node}
            data-node={r.node}
            // on a phone the percentage sits under the meter, so the bar keeps the row to itself
            className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[56px_minmax(0,1fr)_auto]"
          >
            <NodePattern id={r.node} size={12} label />
            <Meter value={r.duty} max={100} label={`${r.node} awake ${text}`} />
            <span
              className={cn(
                'tabular col-start-2 font-mono text-sm sm:col-start-3 sm:w-16 sm:text-right',
                r.duty === null ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {text}
            </span>
            <p className="col-start-2 text-[13px] text-muted-foreground sm:col-span-2">
              awake <span className="tabular font-mono">{fmtSec(r.awakeMs)}</span>
              {' · '}
              asleep <span className="tabular font-mono">{fmtSec(r.sleepMs)}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
