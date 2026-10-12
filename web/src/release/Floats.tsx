// #floats — where the floats are: the localization map in a box, then the node table.
import { useState } from 'react';
import { isNodeId } from '@/components/viz/patterns';
import { useSnapshot } from '@/data/hooks';
import { node, positions } from '@/data/selectors';
import type { LocTarget, NodeId } from '@/data/types';
import { NODE_IDS } from '@/lib/constants';
import { dist, fmtAgo } from '@/lib/format';
import { arr } from '@/lib/safe';
import { localization, pickTarget, targetId } from '@/views/r2/loc';
import { LocMap, LocMapLegend } from '@/views/r2/LocMap';
import { TargetSwitch } from '@/views/r2/TargetSwitch';
import { Box, Decode, Dim, Grid, Table } from '@/release/ui';

const CARDS: Record<NodeId, { name: string; role: string }> = {
  N1: { name: 'Float 1', role: 'Floats on the water; board temperature with a heat alert' },
  N2: { name: 'Float 2', role: 'Floats on the water with the turbidity probe; also relays Float 1\'s data' },
  N3: { name: 'Bank node', role: 'On the shore; gathers the readings' },
  N4: { name: 'Dock node', role: 'At the dock; drives the light and the dashboard' },
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

  const rows = NODE_IDS.map((id) => {
    const n = node(s, id);
    const up = String(n.status || '').toLowerCase() === 'active';
    const near = NODE_IDS.filter((o) => o !== id)
      .map((o) => ({ o, cm: dist(P[id], P[o]) }))
      .filter((x): x is { o: NodeId; cm: number } => x.cm !== null);
    return [
      <span key="n" className="inline-flex items-baseline gap-2">{CARDS[id].name}<span className="font-mono">{id}</span></span>,
      CARDS[id].role,
      up ? '● online' : '○ waiting',
      <span key="ls" className="font-mono">{fmtAgo(n.last_seen_s)}</span>,
      near.length ? near.map((x) => `${CARDS[x.o].name} ${Math.round(x.cm)} cm`).join(', ') : 'Appears once this node reports',
    ];
  });

  return (
    <>
      <Decode as="h1">Where the floats are</Decode>
      <Grid>
        <Box title="Float map" span={12} dim="fig. 1 · estimated vs placed">
          {targets.length || d ? (
            <div className="@container flex flex-col gap-3">
              <div className="cy-screen cy-screen--map">
                <div className="w-full">
                  <LocMap positions={P} target={shown.target} targetId={shown.id} />
                  <LocMapLegend targetId={shown.id} />
                </div>
              </div>
              <TargetSwitch targets={switchIds} value={shown.id} onChange={(id) => { lastTarget = id; setWant(id); }} />
            </div>
          ) : (
            <p>The map draws once the first position estimate arrives.</p>
          )}
          <p><Dim>Float 1's position is estimated from Bluetooth signal strength relative to the other three nodes; expect tens of centimetres of error.</Dim></p>
        </Box>
        <Box title="The four nodes" span={12}>
          <Table
            cols={['Node', 'Role', 'Status', 'Last seen', 'Distances']}
            rows={rows}
          />
        </Box>
      </Grid>
    </>
  );
}
