// #live: the demo pond as an instrument panel: pond map and lamp, readout table, log, pond life.
import { useMemo } from 'react';
import { Ascii } from '@/components/ascii/Ascii';
import { Box, Btn, Dim, Grid, Table } from './ui';
import { PondLifeRow } from '@/release/PondLifeRow';
import { PondStage } from '@/components/viz/PondStage';
import { useCommand, useSnapshot } from '@/data/hooks';
import { isOnline, lightOf, netNow, node, sensorText } from '@/data/selectors';
import { SIM } from '@/lib/constants';
import { fmtAgo } from '@/lib/format';
import { eventKey, interpretEvent, newestFirst } from '@/lib/interpret';
import { arr } from '@/lib/safe';
import { useDecode } from '@/lib/useDecode';
import { readings } from '@/views/overview/readings';

const NAMES = [
  { id: 'N1', name: 'Float 1' },
  { id: 'N2', name: 'Float 2' },
  { id: 'N3', name: 'Bank node' },
  { id: 'N4', name: 'Dock node' },
] as const;

const hms = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
const TONES = { ok: 'ok', check: 'check', wait: 'wait', test: 'test' } as const;

function Reading({ value, unit }: { value: string; unit: string }) {
  const { text } = useDecode(value);
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="cy-readout">{text ?? value}</span>
      <span className="font-mono">{unit}</span>
    </span>
  );
}

type Lamp = { word: string; shape: string; k: keyof typeof TONES };
function lampOf(state: string, waiting: boolean): Lamp {
  if (waiting || state === 'off' || state === 'stale') return { word: 'waiting', shape: '○', k: 'wait' };
  if (state === 'green') return { word: 'ok', shape: '●', k: 'ok' };
  if (state === 'test') return { word: 'test', shape: '◐', k: 'test' };
  return { word: 'check', shape: '▲', k: 'check' };
}

export default function Live() {
  const s = useSnapshot();
  const { pending, send } = useCommand();
  const now = netNow(s);
  const light = lightOf(s);
  const online = isOnline(s);
  const rows = readings(s);
  const flags = new Map(rows.map((r) => [r.id as string, r.flag.label]));
  const waiting = now === null && light.since === null && !light.reason;
  const lamp = lampOf(light.state, waiting);
  const events = newestFirst(s.data ? arr(s.data.events) : undefined).slice(0, 12);
  const lit = light.state === 'green' || light.state === 'red' || light.state === 'hot';
  const stamp = useMemo(() => Date.now() - (now ?? 0), [now]); // eslint-disable-line react-hooks/purity
  const seen = new Map<string, number>();
  const hasData = rows.length > 0;

  const tableRows = NAMES.map(({ id, name }) => {
    const n = node(s, id);
    const v = sensorText(s, { ...n, id });
    const unit = v.u === 'raw ADC' ? 'ADC' : v.u;
    const status = flags.get(id) ?? (String(n.status || '').toLowerCase() === 'active' ? 'Active' : n.status ? 'Inactive' : 'No data');
    return [
      <span key="n" className="inline-flex items-baseline gap-2">{name}<span className="font-mono">{id}</span></span>,
      <Reading key={id} value={v.v} unit={unit} />,
      status,
      typeof n.last_seen_s === 'number' ? fmtAgo(n.last_seen_s) : '—',
    ];
  });

  return (
    <div className="flex max-w-[1280px] flex-col gap-6">
      <h1 className="sr-only">The live pond</h1>
      {SIM && <Dim>demo pond: simulated readings; your own floats replace them.</Dim>}
      <Grid>
        <Box title="Floats and radio links" span={8} dim="fig. 1 · radio links · live">
          <div className="cy-screen cy-screen--map"><PondStage showField={false} linkLabels="down-only" /></div>
        </Box>
        <Box title="Pond light" titleAs="h2" span={4} dim="dock node">
          <span className={`cy-readout cy-lamp cy-lamp--${lamp.k}`}><span aria-hidden="true">{lamp.shape} </span>{lamp.word}</span>
          <div className="cy-screen cy-screen--lg"><Ascii anim="pulse" params={{ off: !lit }} size="lg" /></div>
          <p aria-live="polite">{waiting ? 'waiting for the first uplink' : light.reason || '—'}</p>
          <div>
            <Btn pending={pending} disabled={!online} onClick={() => void send({ c: 'LIGHT_TEST' })}>Test light</Btn>
          </div>
        </Box>
      </Grid>

      <section aria-labelledby="lv-readings" className="flex flex-col gap-3">
        <h2 id="lv-readings" className="sr-only">Readings</h2>
        {hasData ? (
          <Table cols={['Node', 'Reading', 'Status', 'Last seen']} rows={tableRows} />
        ) : (
          <Box>
            <p>{SIM ? 'Readings appear here once the first report arrives from the dock node.' : 'No floats connected yet — start the dock node and the readings appear here.'}</p>
          </Box>
        )}
        <Dim>Float 1 and the bank node report the temperature of the electronics, not the water.</Dim>
      </section>

      <Box title="What is happening" dim="log, newest first">
        {events.length === 0 ? (
          <p>Events appear here when a route changes, the schedule updates or the light changes.</p>
        ) : (
          <ul className="cy-log" aria-live="polite" aria-relevant="additions">
            {events.map((e) => {
              const base = eventKey(e);
              const n = seen.get(base) ?? 0;
              seen.set(base, n + 1);
              const l = interpretEvent(e);
              const t = now !== null && typeof e.t === 'number' ? hms(stamp + e.t) : '--:--:--';
              return (
                <li key={n ? `${base}#${n}` : base}>
                  <span className="font-mono tabular-nums">{t}</span>{'  '}{l.text}
                </li>
              );
            })}
          </ul>
        )}
      </Box>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--cy-ink)] pt-4">
        <span aria-hidden="true" className="font-mono">Pond life</span>
        <PondLifeRow />
      </div>
    </div>
  );
}
