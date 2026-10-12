import { KeyValue } from '@/components/aq/KeyValue';
import { CellChart, type Series } from '@/components/viz/CellChart';
import type { Num } from '@/data/types';
import { fmt, fmtI, sum } from '@/lib/format';
import { num } from '@/lib/safe';
import { BCAST_TYPES, UCAST_TYPES, type Cast } from './cast';
import { CastMark } from './CastMark';

export interface MessageMixProps {
  /** counters.bcast and counters.ucast. */
  bcast: Record<string, Num>;
  ucast: Record<string, Num>;
  /** msg_log rows with `acked === true`, and rows with `acked` true or false. */
  acked: number;
  ackable: number;
}

const LEGEND: { cast: Cast; swatch: string; label: string }[] = [
  { cast: 'broadcast', swatch: 'bg-n4', label: 'Broadcast' },
  { cast: 'unicast', swatch: 'bg-n1', label: 'Unicast' },
];

/**
 * The legacy "Message mix" donut as seven cell bars in the legacy order. The two hue families of the
 * donut become two tones: broadcast light, unicast dark. Below: the ACK reliability sentence and
 * the totals (app.js 1151-1158).
 */
export function MessageMix({ bcast, ucast, acked, ackable }: MessageMixProps) {
  // Legacy: a missing counter counts as 0.
  const count = (src: Record<string, Num>, k: string) => num(src[k]) || 0;
  const total = BCAST_TYPES.reduce((n, t) => n + count(bcast, t.k), 0) + UCAST_TYPES.reduce((n, t) => n + count(ucast, t.k), 0);
  // Nothing counted at all: null values let the chart show its empty state instead of seven zeros.
  const bar = (src: Record<string, Num>, k: string, fill: 'outline' | 'solid'): Series => ({
    id: k, label: k, fill, values: [total > 0 ? count(src, k) : null],
  });
  const series: Series[] = [
    ...BCAST_TYPES.map((t) => bar(bcast, t.k, 'outline')),
    ...UCAST_TYPES.map((t) => bar(ucast, t.k, 'solid')),
  ];
  const pct = ackable ? fmt((acked / ackable) * 100, 1) : null;

  return (
    <div data-slot="message-mix" className="flex flex-col gap-4">
      <CellChart
        mode="bar"
        orientation="horizontal"
        title="Message mix: frames counted per type"
        series={series}
        integer
        emptyText="No frames counted yet. The seven frame types are counted here as the sink reports them."
      />

      <ul aria-label="Fill key" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
        {LEGEND.map((l) => (
          <li key={l.cast} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${l.swatch}`} />
            <CastMark cast={l.cast} bare className="size-3.5" />
            {l.label}
          </li>
        ))}
      </ul>

      {ackable > 0 && (
        <p data-slot="reliability" className="text-[13px] text-muted-foreground">
          Unicast frames in the feed acknowledged:{' '}
          <b className="tabular font-mono font-semibold text-foreground">{acked} / {ackable}</b>{' '}
          (<span className="tabular font-mono">{pct} %</span>). Unacknowledged frames are retransmitted by the MAC.
        </p>
      )}

      <KeyValue
        className="border-t border-border pt-4"
        items={[
          { k: 'Bcast total', v: fmtI(sum(BCAST_TYPES.map((t) => bcast[t.k]))), mono: true },
          { k: 'Ucast total', v: fmtI(sum(UCAST_TYPES.map((t) => ucast[t.k]))), mono: true },
          { k: 'ACK rate', v: pct === null ? '—' : `${pct} %`, mono: true },
        ]}
      />
    </div>
  );
}
