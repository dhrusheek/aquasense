import { EmptyState } from '@/components/aq/EmptyState';
import { NodePattern } from '@/components/viz/NodePattern';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { axisTicks, laneMarks, laneSegments, type CtEvent, type SegKind } from './contention';

export interface ContentionLane {
  name: 'N1' | 'N2';
  events: CtEvent[];
}

export interface ContentionLanesProps {
  lanes: ContentionLane[];
  /** Right edge of the time axis in µs. */
  maxUs: number;
  className?: string;
}

/**
 * The four segment fills, told apart by tone in one ink: a light tone (backoff), a dashed outline (defer),
 * a dark tone (wait for the ACK) and a solid --bad block (timeout / retransmission, the failure mark).
 */
const SEG_FILL: Record<SegKind, string> = {
  backoff: 'rounded-md bg-n4',
  defer: 'rounded-md border border-dashed border-foreground',
  wait: 'rounded-md bg-n2',
  retx: 'rounded-md bg-bad',
};

const LEGEND: { kind: SegKind; label: string }[] = [
  { kind: 'backoff', label: 'random backoff' },
  { kind: 'defer', label: 'deferred (channel busy)' },
  { kind: 'wait', label: 'transmit → ACK wait' },
  { kind: 'retx', label: 'timeout / retransmission' },
];

// Labels sit under the track on three rows so neighbours do not overlap (app.js 979).
const LABEL_ROW = ['top-[46px]', 'top-[60px]', 'top-[74px]'];

const LANE_GRID = 'grid grid-cols-[56px_minmax(0,1fr)] gap-x-3';

function Lane({ lane, maxUs }: { lane: ContentionLane; maxUs: number }) {
  const segs = laneSegments(lane.events, maxUs);
  const marks = laneMarks(lane.events, maxUs);
  return (
    // 40 px track + 48 px for the three label rows
    <div data-slot="contention-lane" data-node={lane.name} className={cn(LANE_GRID, 'pb-12')}>
      <NodePattern id={lane.name} size={12} label className="h-10" />
      <div aria-hidden="true" className="relative h-10 rounded-xl border border-border bg-card">
        {segs.map((sg, i) => (
          <span
            key={`s${i}`}
            data-seg={sg.kind}
            title={sg.ev}
            className={cn('absolute top-2 bottom-2', SEG_FILL[sg.kind])}
            style={{ left: `${sg.left}%`, width: `${sg.width}%` }}
          />
        ))}
        {/* the transmit instant: a full-height ink tick at the head of the ACK wait */}
        {segs.map((sg, i) => sg.tick !== null && (
          <span key={`t${i}`} data-seg="tx" className="absolute inset-y-0 bg-foreground" style={{ left: `${sg.left}%`, width: `${sg.tick}%` }} />
        ))}
        {marks.map((m, i) => (
          <span key={`m${i}`} className="absolute -top-0.5 -bottom-0.5 w-px bg-foreground" style={{ left: `${m.left}%` }} />
        ))}
        {marks.map((m, i) => (
          <span
            key={`l${i}`}
            className={cn('tabular absolute font-mono text-xs leading-none whitespace-nowrap text-muted-foreground', LABEL_ROW[i % 3])}
            // anchored at the mark, growing towards the middle of the track, so no label leaves it
            style={m.left <= 50 ? { left: `${m.left}%` } : { right: `${100 - m.left}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <ol className="sr-only" aria-label={`${lane.name} events, offset from the trigger`}>
        {lane.events.map((e, i) => <li key={i}>+{fmt(e.us / 1000, 1)} ms {e.ev}</li>)}
      </ol>
    </div>
  );
}

/** N1 and N2 contending for the channel: one track per node on a shared time axis. */
export function ContentionLanes({ lanes, maxUs, className }: ContentionLanesProps) {
  if (!lanes.some((l) => l.events.length > 0)) {
    return (
      <EmptyState
        className={className}
        description="No contention test yet — press “Run contention test”. The sink schedules it ≥ 1.5 s ahead inside the CONTROL slot; results arrive with the next STAT frames."
      />
    );
  }
  return (
    // Below 480 px the lanes scroll sideways inside the tray; the page never does.
    <div
      data-slot="contention-lanes"
      role="group"
      aria-label="Contention test timelines, offsets from the trigger"
      tabIndex={0}
      className={cn('overflow-x-auto', className)}
    >
      <div className="min-w-[30rem] pt-1">
        {lanes.map((l) => <Lane key={l.name} lane={l} maxUs={maxUs} />)}
        <div aria-hidden="true" className={LANE_GRID}>
          <span />
          <div className="tabular relative h-5 border-t border-border font-mono text-xs text-muted-foreground">
            {axisTicks(maxUs).map((t, i, all) => (
              <span
                key={i}
                className={cn(
                  'absolute top-1 whitespace-nowrap',
                  i === all.length - 1 ? '-translate-x-full' : i > 0 && '-translate-x-1/2',
                )}
                style={{ left: `${i * 25}%` }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Key to the four segment fills. */
export function ContentionLegend({ className }: { className?: string }) {
  return (
    <ul data-slot="contention-legend" className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground', className)}>
      {LEGEND.map((l) => (
        <li key={l.kind} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('h-2.5 w-5 shrink-0', SEG_FILL[l.kind])}
          />
          {l.label}
        </li>
      ))}
      <li className="tabular text-[13px]">axis: ms from trigger</li>
    </ul>
  );
}
