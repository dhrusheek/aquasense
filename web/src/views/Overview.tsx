// #overview — the live system on one screen (spec 05 §4).
// Row A: the map beside the readings and the status light. Row B: six headline metrics.
// Then two single-line sections: the demo-flow strip (full list on #r9) and the newest events as
// sentences (raw table on #events). Network facts live on #system, the project text on #home.
import { useId } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { StatTile } from '@/components/aq/StatTile';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { CellSpark } from '@/components/viz/CellSpark';
import { LightCard } from '@/components/viz/LightCard';
import { NodeGlyph } from '@/components/viz/NodeGlyph';
import { PondStage } from '@/components/viz/PondStage';
import { postCommand } from '@/data/api';
import { useSnapshot } from '@/data/hooks';
import { demoFlow, isOnline, lightOf, macCnt, metrics, netNow, nodes, series, tAgo } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import { fmt, fmtI, mean, sum, toneHi, toneLo } from '@/lib/format';
import { arr, get, num, obj } from '@/lib/safe';
import { DemoStrip } from './overview/DemoStrip';
import { LiveEvents } from './overview/LiveEvents';
import { readings } from './overview/readings';

const testLight = () => postCommand({ c: 'LIGHT_TEST' });

/* ---------- Row A, right column ---------- */

function LiveReadings({ s }: { s: Snapshot }) {
  const rows = readings(s);
  if (!rows.length) {
    return <EmptyState compact description="Waiting for the first uplink from the sink." />;
  }
  return (
    <ul data-slot="readings" className="flex h-full flex-col divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id} className="-mx-2 flex flex-1 items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[var(--ink-4)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <NodeGlyph id={r.id} size={20} />
              <span className="tabular font-mono text-[13px] leading-5 text-foreground">{r.id}</span>
              <span className="min-w-0 text-sm leading-5 text-foreground">{r.label}</span>
            </div>
            {/* indented to sit under the id, clear of the glyph */}
            <StatusChip tone={r.flag.tone} size="sm" className="ml-7 self-start">{r.flag.label}</StatusChip>
          </div>
          <div className="flex shrink-0 items-baseline gap-1.5">
            <span className="tabular font-mono text-[28px] leading-8 text-foreground">{r.value}</span>
            <span className="font-mono text-[13px] text-muted-foreground">{r.unit}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Row B ---------- */

function Kpis({ s }: { s: Snapshot }) {
  const m = metrics(s), ser = series(s);
  const pdr = mean(Object.values(obj<Record<string, unknown>>(m.pdr)));
  const lost = num(m.lost_total), rx = num(m.rx_total);
  const dl = obj<Record<string, { avg?: unknown }>>(m.delay_ms);
  const delay = mean(Object.keys(dl).map((k) => get<unknown>(dl[k], 'avg', null)));
  const thr = num(get<unknown>(m, 'throughput_bps.total', null));
  let thrB = num(get<unknown>(m, 'throughput_Bps.total', null));
  if (thrB === null && thr !== null) thrB = thr / 8;
  let timeouts = num(get<unknown>(m, 'timeouts.total', null));
  if (timeouts === null) timeouts = sum(nodes(s).map((n) => macCnt(n).to));
  const le = obj<{ last?: unknown; avg?: unknown }>(get<unknown>(m, 'loc_err_cm.N1', null));
  const locLast = num(le.last);

  // Sparks: an N1 series is drawn in N1's tone step, a network total in full ink.
  return (
    <div data-slot="kpis" className="grid grid-cols-2 gap-4 @xl:grid-cols-3 @5xl:grid-cols-6">
      <StatTile
        label="Delivery ratio" aria-label="Packet delivery ratio" value={pdr} decimals={1} unit="%"
        sub={lost !== null && rx !== null ? `${fmtI(lost)} lost of ${fmtI(lost + rx)}` : 'average of N1–N3'}
        tone={toneHi(pdr, 95, 85)}
        spark={<CellSpark width="fill" fill="N1" values={arr<number | null>(ser.pdr_N1)} min={80} max={100} />}
      />
      <StatTile
        label="Delay" aria-label="End-to-end delay" value={delay} decimals={0} unit="ms"
        sub={`N3 ${fmtI(get<unknown>(dl, 'N3.avg', null), 'ms')}`}
        spark={<CellSpark width="fill" fill="N1" values={arr<number | null>(ser.delay_N1)} min={0} />}
      />
      <StatTile
        label="Throughput" aria-label="Throughput at the sink" value={thr} decimals={0} unit="bps"
        sub={thrB !== null ? `${fmt(thrB, 1)} B/s` : undefined}
        spark={<CellSpark width="fill" fill="total" values={arr<number | null>(ser.throughput)} min={0} />}
      />
      <StatTile
        label="Retransmissions" value={num(get<unknown>(m, 'retransmissions.total', null))} decimals={0}
        sub={`ACK timeouts ${fmtI(timeouts)}`}
        spark={<CellSpark width="fill" fill="total" values={arr<number | null>(ser.retx_total)} min={0} />}
      />
      <StatTile
        label="Location error" aria-label="Localization error of N1" value={locLast} decimals={1} unit="cm"
        sub={`avg ${fmt(le.avg, 1, 'cm')}`}
        tone={toneLo(locLast, 20, 40)}
        spark={<CellSpark width="fill" fill="N1" values={arr<number | null>(ser.loc_err_N1)} min={0} />}
      />
      <StatTile
        label="Data reduction" value={num(get<unknown>(m, 'reduction_pct.packets', null))} decimals={1} unit="%"
        sub={`bytes ${fmt(get<unknown>(m, 'reduction_pct.bytes', null), 1, '%')}`}
        spark={<CellSpark width="fill" fill="total" values={arr<number | null>(ser.reduction)} min={0} max={100} />}
      />
    </div>
  );
}

/* ---------- view ---------- */

export default function Overview() {
  const s = useSnapshot();
  const now = netNow(s);
  const metricsId = useId();

  return (
    <>
      <ViewHeader view="overview" className="mb-4" />
      {/* A size container: the columns follow the room the view really has, whatever the sidebar does. */}
      <div className="@container flex flex-col gap-6">
        {/* Row A. One column on a phone; from 896 px of room the map takes 7 columns and the readings
            and the light stack in the other 5. */}
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Live network topology" bare className="col-span-12 @4xl:col-span-7">
            <PondStage showField={false} linkLabels="down-only" />
          </Tray>
          <div className="col-span-12 grid min-w-0 grid-cols-1 gap-4 @2xl:grid-cols-2 @4xl:col-span-5 @4xl:flex @4xl:flex-col">
            <Tray title="Live readings" className="@4xl:flex-1">
              <LiveReadings s={s} />
            </Tray>
            <LightCard compact light={lightOf(s)} netNow={now} online={isOnline(s)} mock={s.mock} onTest={testLight} />
          </div>
        </div>

        {/* Row B: the tiles are their own cards, so they sit straight on the page. */}
        <section aria-labelledby={metricsId}>
          <h2 id={metricsId} className="sr-only">Key metrics</h2>
          <Kpis s={s} />
        </section>

        <DemoStrip flow={demoFlow(s)} />

        <LiveEvents events={s.data ? arr(s.data.events) : undefined} ago={(t) => tAgo(now, t)} />
      </div>
    </>
  );
}
