// #floats — where the floats are: the localization map, then one card per node.
import { useState } from 'react';
import { EmptyState } from '@/components/aq/EmptyState';
import { KeyValue } from '@/components/aq/KeyValue';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { isNodeId } from '@/components/viz/patterns';
import { useSnapshot } from '@/data/hooks';
import { node, positions } from '@/data/selectors';
import type { NodeId } from '@/data/types';
import { NODE_IDS } from '@/lib/constants';
import { dist, fmtAgo } from '@/lib/format';
import { arr } from '@/lib/safe';
import { localization, pickTarget, targetId } from '@/views/r2/loc';
import { LocMap, LocMapLegend } from '@/views/r2/LocMap';
import { TargetSwitch } from '@/views/r2/TargetSwitch';
import type { LocTarget } from '@/data/types';
import { PageTitle } from './parts';

const CARDS: Record<NodeId, { name: string; role: string; senses: string }> = {
  N1: { name: 'Float 1', role: 'Floats on the water', senses: 'Board temperature, with a heat alert' },
  N2: { name: 'Float 2', role: 'Floats on the water with the turbidity probe; also relays Float 1\'s data', senses: 'Water turbidity' },
  N3: { name: 'Bank node', role: 'On the shore; gathers the readings', senses: 'Board temperature' },
  N4: { name: 'Dock node', role: 'At the dock; drives the light and the dashboard', senses: 'Nothing; it shows the status light' },
};

let lastTarget: NodeId = 'N1';

export default function Floats() {
  const s = useSnapshot();
  const d = s.data;
  const loc = localization(d);
  const P = positions(d);
  const targets = arr<LocTarget | null>(loc.targets).filter((t): t is LocTarget => !!t && typeof t === 'object');
  const [want, setWant] = useState<NodeId>(lastTarget);
  const shown = pickTarget(targets, want);
  const switchIds = targets.map(targetId).filter(isNodeId);

  return (
    <>
      <PageTitle title="Where the floats are" note="Float 1's position is estimated from Bluetooth signal strength relative to the other three nodes; expect tens of centimetres of error." />
      <div className="flex max-w-[1100px] flex-col gap-6">
        <Tray title="Float map">
          {targets.length || d ? (
            <div className="@container flex flex-col gap-4">
              <LocMap positions={P} target={shown.target} targetId={shown.id} />
              <LocMapLegend targetId={shown.id} />
              <TargetSwitch targets={switchIds} value={shown.id} onChange={(id) => { lastTarget = id; setWant(id); }} />
            </div>
          ) : (
            <EmptyState compact description="The map draws once the first position estimate arrives." />
          )}
        </Tray>

        <section aria-labelledby="fl-nodes" className="flex flex-col gap-4">
          <h2 id="fl-nodes" className="text-xl leading-7 font-semibold tracking-[-0.01em] text-foreground">The four nodes</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {NODE_IDS.map((id) => {
              const n = node(s, id);
              const c = CARDS[id];
              const up = String(n.status || '').toLowerCase() === 'active';
              const near = NODE_IDS.filter((o) => o !== id)
                .map((o) => ({ o, cm: dist(P[id], P[o]) }))
                .filter((x): x is { o: NodeId; cm: number } => x.cm !== null);
              return (
                <article key={id} aria-label={c.name} className="surface-card flex min-w-0 flex-col gap-4 p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] leading-6 font-semibold text-foreground">{c.name} · <span className="tabular font-mono">{id}</span></h3>
                      <p className="text-[13px] text-muted-foreground">{c.role}</p>
                    </div>
                    <StatusChip tone={up ? 'ok' : 'neutral'} dot>{up ? 'Online' : 'Waiting'}</StatusChip>
                  </div>
                  <KeyValue
                    items={[
                      { k: 'Senses', v: c.senses },
                      { k: 'Last seen', v: fmtAgo(n.last_seen_s), mono: true },
                      {
                        k: 'Approx. distance',
                        v: near.length ? near.map((x) => `${CARDS[x.o].name} (${x.o}) ${Math.round(x.cm)} cm`).join(', ') : '—',
                      },
                    ]}
                    emptyText="Details appear once this node reports."
                  />
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
