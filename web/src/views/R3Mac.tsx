// #r3 — Wi-Fi MAC Protocol (port of app.js 953-1077, spec 02 §3).
// Row 1: the contention test (lanes, legend, explanation) beside the CSMA/CA parameters and the
// cumulative retransmission chart. Row 2: MAC counters, one column per node. Row 3: the event timeline.
import { CommandButton } from '@/components/aq/CommandButton';
import { KeyValue, type KeyValueItem } from '@/components/aq/KeyValue';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { CellChart } from '@/components/viz/CellChart';
import { useSnapshot } from '@/data/hooks';
import { netNow, series } from '@/data/selectors';
import type { MacLogRow } from '@/data/types';
import { arr } from '@/lib/safe';
import { ContentionLanes, ContentionLegend } from './r3/ContentionLanes';
import { explainCT, maxUsOf, parseCT } from './r3/contention';
import { ExplainList } from './r3/ExplainList';
import { MacCounterTable } from './r3/MacCounterTable';
import { MacLog } from './r3/MacLog';

// From firmware config.h (docs/PROTOCOL_SPEC.md §4); verbatim from app.js 1037.
const CSMA: KeyValueItem[] = [
  { k: 'Backoff slot', v: '1 ms', mono: true },
  { k: 'DIFS (idle before TX)', v: '2 ms', mono: true },
  { k: 'Channel busy window', v: '3 ms since last frame', mono: true },
  { k: 'Contention window', v: '4 → 32 slots (×2 per retry)', mono: true },
  { k: 'ACK timeout', v: '40 ms', mono: true },
  { k: 'Max retries', v: '3', mono: true },
  { k: 'TX deadline', v: '400 ms (fits a slot)', mono: true },
];

export default function R3Mac() {
  const s = useSnapshot();
  const now = netNow(s);
  const ser = series(s);

  const ct = s.data?.contention_test ?? null;
  const n1 = parseCT(ct?.N1), n2 = parseCT(ct?.N2);
  const explanation = explainCT(ct);

  return (
    <>
      <ViewHeader view="r3" />
      <div className="grid grid-cols-12 gap-4">
        <Tray
          title="Contention test"
          actions={<CommandButton label="Run contention test" command={{ c: 'CONTENTION_TEST' }} variant="default" cooldownMs={3000} />}
          className="col-span-12 xl:col-span-8"
        >
          <div className="flex flex-col gap-4">
            <ContentionLanes
              lanes={[{ name: 'N1', events: n1 }, { name: 'N2', events: n2 }]}
              maxUs={maxUsOf(n1, n2)}
            />
            <ContentionLegend />
            {explanation && <ExplainList title={explanation.title} steps={explanation.steps} verdict={explanation.verdict} />}
          </div>
        </Tray>

        <Tray title="CSMA/CA parameters" className="col-span-12 xl:col-span-4">
          <div className="flex flex-col gap-5">
            <KeyValue items={CSMA} />
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <h3 className="tray-title">Retransmissions (cumulative, all nodes)</h3>
              <CellChart
                mode="single"
                title="Retransmissions over time"
                series={[{ id: 'retx_total', label: 'Retransmissions', node: 'total', values: arr<number | null>(ser.retx_total) }]}
                t={arr<number | null>(ser.t)}
                stepped
                integer
                yMin={0}
                fit="bucket"
                height={168}
                emptyText="The network-wide retry count appears here, one point per superframe (every 3 s)."
              />
            </div>
          </div>
        </Tray>

        <Tray title="MAC counters" className="col-span-12">
          <MacCounterTable src={s} />
        </Tray>

        <Tray title="MAC event timeline" className="col-span-12">
          <MacLog log={arr<MacLogRow>(s.data?.mac_log)} now={now} />
        </Tray>
      </div>
    </>
  );
}
