// #r6: Data Aggregation (port of V.r6, app.js 1172-1218; spec 03 §2).
// Row 1: this window at the cluster head as a fan-in (N1 + N2 + N3 → one AGG frame), beside the
//        reduction meters and their formulas.
// Row 2: cumulative reduction over time, beside the alert flags that travel in the AGG.
// Row 3: the N1 over-temperature threshold form (shared with r1).
import { FormulaBlock } from '@/components/aq/FormulaBlock';
import { KeyValue } from '@/components/aq/KeyValue';
import { RoutePath } from '@/components/aq/RoutePath';
import { StatTile } from '@/components/aq/StatTile';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { CellChart } from '@/components/viz/CellChart';
import { TempWarnForm } from '@/components/viz/TempWarnForm';
import { postCommand } from '@/data/api';
import { useSnapshot } from '@/data/hooks';
import { isOnline, lightOf, metrics, node, series } from '@/data/selectors';
import { twText, useTempWarnPending } from '@/data/tempWarn';
import type { AggInput, Aggregation, Tone } from '@/data/types';
import { LIGHT } from '@/lib/constants';
import { fmt, fmtI, tempC } from '@/lib/format';
import { arr, get, num, obj } from '@/lib/safe';
import { AggFanIn, type FanInput, type FanOutput } from './r6/AggFanIn';
import { CellMeter } from './r6/CellMeter';

const sendTempWarn = (v: number) => postCommand({ c: 'TEMP_WARN', a: 1, v });

/* ---------- row 1: the window ---------- */

/** An enclosure temperature (°C × 100) with two decimals, "—" when there is no reading. */
function tempText(v: unknown): string {
  const t = tempC(v);
  return t === null ? '—' : fmt(t, 2);
}

/** The `th` flag of one input as a chip: 1 → the alert word, 0 → the normal word, else nothing. */
function thChip(th: number | null, on: string, onTone: Tone, off: string, prefix: string = '') {
  if (th === 1) return <StatusChip tone={onTone} size="sm" mono>{`${prefix}1 · ${on}`}</StatusChip>;
  if (th === 0) return <StatusChip tone="neutral" size="sm" mono>{`${prefix}0 · ${off}`}</StatusChip>;
  return null;
}

function fanInputs(a: Aggregation): FanInput[] {
  const n1 = obj<AggInput>(a.n1), n2 = obj<AggInput>(a.n2);
  return [
    {
      id: 'N1',
      title: 'N1 · Enclosure temperature (pond edge)',
      chips: (
        <>
          {thChip(num(n1.th), 'hot', 'warn', 'normal', 'th ')}
          <StatusChip tone="info" size="sm" mono>{`cnt ${fmtI(n1.cnt)}`}</StatusChip>
        </>
      ),
      value: tempText(n1.v),
      unit: '°C',
      line: `mean ${tempText(n1.mean)} · min ${tempText(n1.min)} · max ${tempText(n1.max)} · seq ${fmtI(n1.q)}`,
    },
    {
      id: 'N2',
      title: 'N2 · Turbidity',
      chips: (
        <>
          {thChip(num(n2.th), 'turbid', 'bad', 'clear', 'th ')}
          <StatusChip tone="info" size="sm" mono>{`cnt ${fmtI(n2.cnt)}`}</StatusChip>
        </>
      ),
      value: fmtI(n2.v),
      unit: 'raw ADC',
      line: `mean ${fmt(n2.mean, 1)} · min ${fmtI(n2.min)} · max ${fmtI(n2.max)} · seq ${fmtI(n2.q)}`,
    },
    {
      id: 'N3',
      title: 'N3 · Enclosure temperature (own sensor)',
      chips: <StatusChip tone="neutral" size="sm">Uncalibrated</StatusChip>,
      value: tempText(get<unknown>(a, 'n3.v', null)),
      unit: '°C',
    },
  ];
}

function fanOutput(a: Aggregation): FanOutput {
  return {
    title: 'Aggregated output · one AGG frame',
    sub: (
      <>
        window = superframe <span className="tabular font-mono">#{String(get<unknown>(a, 'window', '—'))}</span>, sent in
        slot 3 to N4
      </>
    ),
    tiles: [
      { label: 'Packets', value: fmtI(num(a.in)), arrow: '→ 1' },
      { label: 'Bytes', value: fmtI(num(a.bytes_in)), arrow: `→ ${fmtI(num(a.bytes_out))}` },
    ],
    kv: [
      { key: 'Window reduction', value: fmt(a.reduction_pct, 1, '%'), mono: true },
      { key: 'Path to sink', value: <RoutePath path={a.path || null} /> },
      { key: 'Delay to sink', value: fmtI(a.delay_ms, 'ms'), mono: true },
      {
        key: 'Cumulative in → out',
        value: `${fmtI(get<unknown>(a, 'cum.in', null))} → ${fmtI(get<unknown>(a, 'cum.out', null))} frames`,
        mono: true,
      },
      {
        key: 'Cumulative bytes',
        value: `${fmtI(get<unknown>(a, 'cum.bytes_in', null))} → ${fmtI(get<unknown>(a, 'cum.bytes_out', null))} B`,
        mono: true,
      },
    ],
  };
}

/* ---------- view ---------- */

export default function R6Aggregation() {
  const s = useSnapshot();
  const raw = s.data?.aggregation;
  const hasAgg = !!raw && typeof raw === 'object' && !Array.isArray(raw);
  const a = obj<Aggregation>(raw);
  const m = metrics(s), ser = series(s);

  // Reduction gauges (app.js 1204): the cumulative ones fall back to the sink's own metrics.
  const gauges: { label: string; v: number | null }[] = [
    { label: 'This window (packets)', v: num(a.reduction_pct) },
    { label: 'Cumulative packets', v: num(get<unknown>(a, 'cum.reduction_packets_pct', get<unknown>(m, 'reduction_pct.packets', null))) },
    { label: 'Cumulative bytes', v: num(get<unknown>(a, 'cum.reduction_bytes_pct', get<unknown>(m, 'reduction_pct.bytes', null))) },
  ];

  const light = lightOf(s), lightMeta = LIGHT[light.state];
  const n1 = node(s, 'N1');
  const tempWarn = num(n1.temp_warn);
  const pending = useTempWarnPending(tempWarn);

  return (
    <>
      <ViewHeader view="r6" />
      <div className="flex flex-col gap-10">
        {/* Row 1 */}
        <div className="grid grid-cols-12 gap-4">
          <Tray
            title="This window at the cluster head · N3"
            description="Latest-value fusion, window count / mean / min / max, OR-fused alert flags."
            bare
            className="col-span-12 xl:col-span-7"
          >
            <AggFanIn inputs={fanInputs(a)} output={fanOutput(a)} empty={!hasAgg} />
          </Tray>

          <Tray title="Reduction in transmitted data" bare className="col-span-12 xl:col-span-5">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-1">
                {gauges.map((g) => (
                  <StatTile
                    key={g.label}
                    label={g.label}
                    value={g.v}
                    decimals={1}
                    unit="%"
                    sub={<CellMeter pct={g.v} className="mt-1" />}
                  />
                ))}
              </div>
              <FormulaBlock
                lines={[
                  'window red  = (in − 1) / in × 100',
                  'packets red = (aggIn − aggOut) / aggIn',
                  'bytes red   = (bytesIn − bytesOut) / bytesIn',
                ]}
              />
            </div>
          </Tray>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Cumulative data reduction over time" meta="packets · %" className="col-span-12 xl:col-span-7">
            <CellChart
              mode="series"
              title="Cumulative data reduction over time"
              series={[{ id: 'reduction', label: 'Reduction', fill: 'solid', values: arr<number | null>(ser.reduction) }]}
              t={arr<number | null>(ser.t)}
              yMin={0}
              yMax={100}
              unit="%"
              decimals={1}
              rows={20}
              xTicks={6}
              fit="bucket"
              emptyText="The packet reduction is plotted here once N3 has sent AGG frames, one point per superframe (every 3 s)."
            />
          </Tray>

          <Tray title="Alert flags → status light" className="col-span-12 xl:col-span-5">
            <KeyValue
              items={[
                { k: 'n1.th · N1 enclosure', v: thChip(num(get<unknown>(a, 'n1.th', null)), 'hot', 'warn', 'normal') ?? '—' },
                { k: 'n2.th · N2 turbidity', v: thChip(num(get<unknown>(a, 'n2.th', null)), 'turbid', 'bad', 'clear') ?? '—' },
                {
                  k: 'Pond status light',
                  v: (
                    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip tone={lightMeta.tone} size="sm">{lightMeta.label}</StatusChip>
                      <span className="text-[13px] text-muted-foreground">{light.reason || lightMeta.rule}</span>
                      <span className="text-[13px] text-muted-foreground">(steady red beats blinking red)</span>
                    </span>
                  ),
                },
                { k: 'N1 threshold', v: twText(n1.temp_warn), mono: true },
              ]}
            />
          </Tray>
        </div>

        {/* Row 3 */}
        <TempWarnForm
          title="N1 alert threshold"
          source="r6"
          tempWarn={tempWarn}
          liveC={tempC(n1.value)}
          flag={n1.threshold === true ? true : n1.threshold === false ? false : null}
          pending={pending}
          online={isOnline(s)}
          mock={s.mock}
          onSubmit={sendTempWarn}
        />
      </div>
    </>
  );
}
