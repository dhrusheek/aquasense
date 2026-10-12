// #live — the demo pond: the same live composition as the dashboard Overview, in plain words.
import { EmptyState } from '@/components/aq/EmptyState';
import { StatTile } from '@/components/aq/StatTile';
import { TONE_DOT, TONE_WORD } from '@/components/aq/tone';
import { Tray } from '@/components/aq/Tray';
import { LightCard } from '@/components/viz/LightCard';
import { PondStage } from '@/components/viz/PondStage';
import { postCommand } from '@/data/api';
import { useSnapshot } from '@/data/hooks';
import { SIM } from '@/lib/constants';
import { isOnline, lightOf, netNow, tAgo } from '@/data/selectors';
import { arr } from '@/lib/safe';
import { eventKey, interpretEvent, newestFirst } from '@/lib/interpret';
import { cn } from '@/lib/utils';
import { readings } from '@/views/overview/readings';
import { ArtScene } from '@/components/art';
import { ArtEmpty, CardMedia, PageTitle } from './parts';
import { PondLifeRow } from '@/release/PondLifeRow';

const testLight = () => postCommand({ c: 'LIGHT_TEST' });

const LABEL: Record<string, string> = {
  N1: 'Float 1 board temperature',
  N2: 'Water turbidity',
  N3: 'Bank node board temperature',
};
const NOTE = 'The temperature of the electronics, not the water.';

export default function Live() {
  const s = useSnapshot();
  const now = netNow(s);
  const rows = readings(s);
  const events = newestFirst(s.data ? arr(s.data.events) : undefined).slice(0, 6);
  const seen = new Map<string, number>();

  return (
    <>
      <PageTitle title="The live pond" note={SIM ? 'Demo pond: simulated data. Your own floats replace it.' : undefined} />
      <div className="@container flex max-w-[1280px] flex-col gap-6">
        <CardMedia kind="band"><ArtScene scene="waves" mode="ascii" tint="night" aspect="3/1" animate="shimmer" className="h-full w-full rounded-none" /></CardMedia>
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Floats and radio links" bare className="col-span-12 @4xl:col-span-7">
            <PondStage showField={false} linkLabels="down-only" />
          </Tray>
          <div className="col-span-12 min-w-0 @4xl:col-span-5">
            <LightCard compact light={lightOf(s)} netNow={now} online={isOnline(s)} mock={s.mock} onTest={testLight} />
          </div>
        </div>

        <section aria-labelledby="lv-readings">
          <h2 id="lv-readings" className="sr-only">Readings</h2>
          {rows.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {rows.map((r) => (
                <StatTile
                  key={r.id}
                  label={LABEL[r.id] ?? r.label}
                  value={r.value}
                  unit={r.unit}
                  sub={(
                    <span title={r.id === 'N2' ? undefined : NOTE}>
                      {r.flag.label} · <span className="tabular font-mono">{r.id}</span>
                      {r.id !== 'N2' && <span className="block">Electronics, not the water</span>}
                    </span>
                  )}
                  tone={r.flag.tone === 'bad' || r.flag.tone === 'warn' || r.flag.tone === 'ok' ? r.flag.tone : undefined}
                />
              ))}
            </div>
          ) : (
            <ArtEmpty><EmptyState compact description={SIM ? 'Readings appear here once the first report arrives from the dock node.' : 'No floats connected yet — start the dock node and the readings appear here.'} /></ArtEmpty>
          )}
        </section>

        <Tray title="What is happening">
          {events.length === 0 ? (
            <ArtEmpty><EmptyState compact description="Events appear here when a route changes, the schedule updates or the light changes." /></ArtEmpty>
          ) : (
            <ul aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
              {events.map((e) => {
                const base = eventKey(e);
                const n = seen.get(base) ?? 0;
                seen.set(base, n + 1);
                const l = interpretEvent(e);
                return (
                  <li key={n ? `${base}#${n}` : base} className="flex items-start gap-3">
                    <span className="tabular w-24 shrink-0 font-mono text-[13px] leading-5 text-muted-foreground">{tAgo(now, e.t)}</span>
                    <span className="flex h-5 shrink-0 items-center">
                      <span aria-hidden="true" className={cn('size-2', TONE_DOT[l.tone])} />
                      <span className="sr-only">{TONE_WORD[l.tone]}: </span>
                    </span>
                    <span className="min-w-0 text-sm leading-5 text-foreground">{l.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Tray>

        <div className="flex items-center justify-between gap-3 border-t border-ink-3 pt-4 text-sm text-foreground">
          <span aria-hidden="true">Pond life</span>
          <PondLifeRow />
        </div>
      </div>
    </>
  );
}
