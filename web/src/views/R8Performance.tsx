// #r8 — Performance Analysis (port of app.js 1308-1378, spec 03 §4).
// Row 1: the seven measured metrics with formula, value and a generated interpretation, plus
// Export CSV and Reset statistics. Rows 2-5: eight charts of derived.series, two per row.
import type { MouseEvent, ReactNode } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { CommandButton } from '@/components/aq/CommandButton';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { Button } from '@/components/ui/button';
import { CellChart, type CellChartProps, type SeriesSpec } from '@/components/viz/CellChart';
import { niceCeil } from '@/components/viz/cellMath';
import { csvUrl } from '@/data/api';
import { useSnapshot } from '@/data/hooks';
import { metrics, series } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { MinMax, NodeId } from '@/data/types';
import { fmt, fmtI, mean, tempC } from '@/lib/format';
import { arr, get, obj } from '@/lib/safe';
import { interpretations } from './r8/interpretations';
import { alignSeries, column, extent, type Sample } from './r8/series';

/* ---------- Row 1: measured metrics ---------- */

interface MetricRow {
  metric: string;
  /** Verbatim from PROTOCOL_SPEC §11 (app.js 1366-1372). */
  formula: string;
  measured: string;
  note: string;
}

function metricRows(s: Snapshot): MetricRow[] {
  const m = metrics(s), it = interpretations(s);
  const pdr = obj<Record<string, unknown>>(m.pdr);
  const pdrAvg = mean(Object.keys(pdr).map((k) => pdr[k]));
  const d = obj<Record<string, unknown>>(m.delay_ms), le = obj<MinMax>(get<unknown>(m, 'loc_err_cm.N1', null));
  return [
    { metric: 'Packet delivery ratio', formula: 'rx_unique / (max_seq − first_seq + 1) × 100', measured: fmt(pdrAvg, 1, '% avg'), note: it.pdr },
    { metric: 'Packet loss', formula: '100 − PDR;  lost = expected − rx_unique', measured: fmtI(m.lost_total) + ' packets', note: it.loss },
    {
      metric: 'End-to-end delay', formula: 't_sink_rx − t_created (network time)',
      measured: fmtI(mean(Object.keys(d).map((k) => get<unknown>(d[k], 'avg', null))), 'ms avg'), note: it.delay,
    },
    { metric: 'Throughput', formula: 'Σ payload bytes at sink in 30 s / 30 × 8', measured: fmtI(get<unknown>(m, 'throughput_bps.total', null), 'bps'), note: it.thr },
    { metric: 'Retransmissions', formula: 'Σ STAT.mac.retx (MAC retries)', measured: fmtI(get<unknown>(m, 'retransmissions.total', null)), note: it.retx },
    { metric: 'Localization error', formula: '|est − true| (weighted centroid)', measured: fmt(le.last, 1, 'cm'), note: it.loc },
    {
      metric: 'Data reduction', formula: '(in − out) / in × 100',
      measured: fmt(get<unknown>(m, 'reduction_pct.packets', null), 1, '% pkts') + ' · ' + fmt(get<unknown>(m, 'reduction_pct.bytes', null), 1, '% bytes'),
      note: it.red,
    },
  ];
}

// The Formula and Interpretation cells wrap; the table scrolls inside its tray when it is still too wide.
const METRIC_COLUMNS: Column<MetricRow>[] = [
  { id: 'metric', header: 'Metric', cell: (r) => <b className="font-semibold">{r.metric}</b> },
  { id: 'formula', header: 'Formula', mono: true, cell: (r) => <span className="block min-w-56 text-[13px] whitespace-normal">{r.formula}</span> },
  { id: 'measured', header: 'Measured', mono: true, align: 'right', cell: (r) => <b className="font-semibold">{r.measured}</b> },
  {
    id: 'note', header: 'Interpretation',
    cell: (r) => <span className="block max-w-[72ch] min-w-72 text-[13px] whitespace-normal text-muted-foreground">{r.note}</span>,
  },
];

function ExportCsv({ mock }: { mock: boolean }) {
  // Preview mode has no server to export from (app.js 1657-1658).
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!mock) return;
    e.preventDefault();
    toast.message('Preview mode', { id: 'csv-export', description: 'CSV export needs the server (GET /api/export.csv).' });
  };
  return (
    <Button asChild variant="outline" size="lg">
      <a href={csvUrl} download onClick={onClick}>
        <Download aria-hidden="true" />
        Export CSV
      </a>
    </Button>
  );
}

/* ---------- Rows 2-5: charts ---------- */

const CHART_H = 220;
const WAITING = 'Waiting for the first superframe…';

/**
 * A time-series chart of this view: all samples bucketed into the columns that fit.
 *
 * The box clips its overflow. CellChart carries a visually hidden table of its numbers; a <table>
 * takes `width: 1px` as a minimum and is laid out at its full, unwrapped width, so the three-column
 * table of the sensor chart reached past a 375 px viewport and made the page scroll sideways. The
 * 4 px of padding (cancelled by the margin) leaves room for the chart's focus ring.
 */
function Chart(props: Omit<CellChartProps, 'mode' | 'fit' | 'emptyText'>) {
  return (
    <div data-slot="chart-box" className="-m-1 overflow-hidden p-1">
      <CellChart mode="series" fit="bucket" emptyText={WAITING} height={CHART_H} {...props} />
    </div>
  );
}

/** One chart per tray; `unit` is the mono note beside the title. */
function ChartTray({ title, unit, children }: { title: string; unit?: string; children: ReactNode }) {
  return <Tray title={title} meta={unit} className="col-span-12 lg:col-span-6">{children}</Tray>;
}

/** One series per node, drawn in the node's tone step. */
function byNode(ids: NodeId[], cols: Sample[][], labels?: string[]): SeriesSpec[] {
  return ids.map((id, i) => ({ id, label: labels?.[i] ?? id, node: id, values: cols[i] }));
}

/**
 * Lower bound of the PDR axis. The legacy chart let the axis start just under the data (only its
 * top was pinned to 100), so a drop from 100 to 97.5 % stays visible: the next ten below the data,
 * at most 90.
 */
function pdrFloor(cols: Sample[][]): number {
  const e = extent(cols);
  if (!e) return 90;
  const f = Math.floor(e.lo / 10) * 10;
  return Math.max(0, Math.min(90, f === e.lo ? f - 10 : f));
}

/** A 5 °C grid around the enclosure temperatures, shared by N1 and N3 (the legacy auto-scaled °C axis). */
function tempDomain(cols: Sample[][]): { yMin: number; yMax: number | 'auto' } {
  const e = extent(cols);
  if (!e) return { yMin: 0, yMax: 'auto' };
  let lo = Math.floor(e.lo / 5) * 5;
  if (lo === e.lo) lo -= 5;
  return { yMin: lo, yMax: Math.max(Math.ceil(e.hi / 5) * 5, lo + 5) };
}

function Charts({ s }: { s: Snapshot }) {
  const ser = series(s), t = ser.t;
  const raw = (k: string) => get<unknown>(ser, k, null);

  // pdr_N3 is drawn only when the state provides it (spec 04, decision 11).
  const pdrIds: NodeId[] = arr(raw('pdr_N3')).length > 0 ? ['N1', 'N2', 'N3'] : ['N1', 'N2'];
  const pdr = alignSeries(t, pdrIds.map((id) => column(raw('pdr_' + id))));
  const toLoss = (n: number) => 100 - n;
  const loss = alignSeries(t, [column(ser.pdr_N1, toLoss), column(ser.pdr_N2, toLoss)]);
  const lossHi = extent(loss.cols)?.hi ?? 0;
  const delay = alignSeries(t, [column(ser.delay_N1), column(ser.delay_N2), column(ser.delay_N3)]);
  const thr = alignSeries(t, [column(ser.throughput)]);
  const retx = alignSeries(t, [column(ser.retx_total)]);
  const loc = alignSeries(t, [column(ser.loc_err_N1)]);
  const red = alignSeries(t, [column(ser.reduction)]);
  // N1 and N3 are both ESP32 die temperatures (°C × 100 → °C); N2 is the raw turbidity ADC.
  const val = alignSeries(t, [column(ser.value_N2), column(ser.value_N1, tempC), column(ser.value_N3, tempC)]);
  const temps = [val.cols[1], val.cols[2]];

  return (
    <div data-slot="charts" className="grid grid-cols-12 gap-4">
      <ChartTray title="Packet delivery ratio" unit="%">
        <Chart
          title="Packet delivery ratio per origin node"
          t={pdr.t} series={byNode(pdrIds, pdr.cols)}
          yMin={pdrFloor(pdr.cols)} yMax={100} unit="%" decimals={1}
        />
      </ChartTray>
      <ChartTray title="Packet loss" unit="%">
        <Chart
          title="Packet loss per origin node"
          t={loss.t} series={byNode(['N1', 'N2'], loss.cols)}
          yMin={0} yMax={lossHi > 10 ? niceCeil(lossHi) : 10} unit="%" decimals={1}
        />
      </ChartTray>
      <ChartTray title="End-to-end delay" unit="ms">
        <Chart
          title="End-to-end delay per origin node"
          t={delay.t} series={byNode(['N1', 'N2', 'N3'], delay.cols)}
          yMin={0} unit="ms" decimals={0}
        />
      </ChartTray>
      <ChartTray title="Throughput at sink" unit="bps">
        <Chart
          title="Throughput at the sink"
          t={thr.t} series={[{ id: 'throughput', label: 'Throughput', fill: 'solid', values: thr.cols[0] }]}
          yMin={0} unit="bps" decimals={0}
        />
      </ChartTray>
      <ChartTray title="Retransmissions (cumulative)">
        <Chart
          title="Cumulative retransmissions, all nodes"
          t={retx.t} series={[{ id: 'retx_total', label: 'Retransmissions', fill: 'solid', values: retx.cols[0] }]}
          yMin={0} decimals={0} stepped integer
        />
      </ChartTray>
      <ChartTray title="Localization error N1" unit="cm">
        <Chart
          title="Localization error of N1"
          t={loc.t} series={[{ id: 'loc_err_N1', label: 'N1 error', fill: 'solid', values: loc.cols[0] }]}
          yMin={0} unit="cm" decimals={1}
        />
      </ChartTray>
      <ChartTray title="Data reduction" unit="%">
        <Chart
          title="Packets saved by aggregation"
          t={red.t} series={[{ id: 'reduction', label: 'Reduction', fill: 'solid', values: red.cols[0] }]}
          yMin={0} yMax={100} unit="%" decimals={1}
        />
      </ChartTray>
      <ChartTray title="Sensor values" unit="raw ADC · °C">
        {/* two stacked panels on the same x labels, in place of the legacy left / right axes */}
        <div className="flex flex-col gap-4">
          <Chart
            title="N2 turbidity, raw ADC"
            t={val.t} series={byNode(['N2'], [val.cols[0]], ['N2 turbidity (raw ADC)'])}
            height={150} yMin={0} decimals={1} legend
          />
          <Chart
            title="N1 and N3 enclosure temperature"
            t={val.t} series={byNode(['N1', 'N3'], temps, ['N1 enclosure temp (°C)', 'N3 enclosure temp (°C)'])}
            height={150} {...tempDomain(temps)} unit="°C" decimals={1}
          />
        </div>
      </ChartTray>
    </div>
  );
}

/* ---------- view ---------- */

export default function R8Performance() {
  const s = useSnapshot();
  return (
    <>
      <ViewHeader view="r8" />
      <div className="flex flex-col gap-10">
        <Tray
          title="Measured metrics"
          actions={(
            // capped at the tray's inner width on a phone (100vw − gutters), so the buttons wrap instead of widening the page
            <div className="flex max-w-[calc(100vw-4rem)] flex-wrap items-center gap-2">
              <ExportCsv mock={s.mock} />
              <CommandButton
                label="Reset statistics"
                command={{ c: 'RESET_STATS' }}
                variant="destructive"
                confirm="Reset all statistics on the server?"
                confirmLabel="Reset"
                cooldownMs={3000}
                icon={<RotateCcw />}
              />
            </div>
          )}
        >
          <DataTable
            columns={METRIC_COLUMNS}
            rows={metricRows(s)}
            rowKey={(r) => r.metric}
            caption="The seven measured metrics: formula, measured value and interpretation"
            empty="The seven metrics appear here once the sink reports its first statistics."
          />
        </Tray>
        <Charts s={s} />
      </div>
    </>
  );
}
