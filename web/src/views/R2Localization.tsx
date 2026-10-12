// #r2 — BLE-Based Localization (port of V.r2, app.js 797-950; spec 02 §2).
// Row 1: the 2-D map with the target switch, beside the localization result and the distance formula.
// Row 2: RSSI matrix and nearest node. Row 3: distance estimates and the N1 error over time.
// Row 4: the same localization for the other three nodes.
import { useState } from 'react';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { EmptyState } from '@/components/aq/EmptyState';
import { FormulaBlock } from '@/components/aq/FormulaBlock';
import { StatTile } from '@/components/aq/StatTile';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { isNodeId } from '@/components/viz/patterns';
import { useSnapshot } from '@/data/hooks';
import { positions, series } from '@/data/selectors';
import type { LocTarget, NodeId, Num } from '@/data/types';
import { NODE_IDS } from '@/lib/constants';
import { fmt, toneLo } from '@/lib/format';
import { arr, num } from '@/lib/safe';
import { LocErrChart } from './r2/LocErrChart';
import { LocMap, LocMapLegend } from './r2/LocMap';
import {
  bleMatrix, distanceRows, formulaLines, localization, nearestRows, pathLoss, pickTarget, targetId, xyText,
  type DistRow, type NearRow,
} from './r2/loc';
import { NodeTag } from './r2/NodeTag';
import { RssiMatrix } from './r2/RssiMatrix';
import { TargetSwitch } from './r2/TargetSwitch';

/** The target last shown, kept across view changes like the legacy `S.locTarget`. */
let lastTarget: NodeId = 'N1';

/* ---------- tables ---------- */

const NEAR_COLUMNS: Column<NearRow>[] = [
  { id: 'node', header: 'Node', cell: (r) => <NodeTag id={r.id} /> },
  {
    id: 'ble',
    header: <span className="whitespace-normal">Nearest (BLE)</span>,
    cell: (r) => <NodeTag id={r.ble ?? '—'} />,
  },
  { id: 'rssi', header: 'RSSI', mono: true, align: 'right', cell: (r) => r.rssi },
  {
    id: 'true',
    header: <span className="whitespace-normal">Nearest (true)</span>,
    cell: (r) => (
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5 whitespace-normal">
        <NodeTag id={r.best ?? '—'} />
        <span className="tabular font-mono text-[13px] whitespace-nowrap text-muted-foreground">({fmt(r.bestCm, 0, 'cm')})</span>
      </span>
    ),
  },
  {
    id: 'match',
    header: 'Match',
    cell: (r) => (r.ble === null
      ? <span className="font-mono text-muted-foreground">—</span>
      : r.match
        ? <StatusChip tone="ok" size="sm">✓<span className="sr-only"> matches the true geometry</span></StatusChip>
        : <StatusChip tone="warn" size="sm">Differs</StatusChip>),
  },
];

const DIST_COLUMNS: Column<DistRow>[] = [
  {
    id: 'pair',
    header: 'Pair',
    mono: true,
    cell: (r) => <span className="font-medium whitespace-nowrap text-foreground">{r.from} → {r.to}</span>,
  },
  { id: 'rssi', header: 'RSSI', mono: true, align: 'right', cell: (r) => r.rssi },
  { id: 'est', header: 'Estimated', mono: true, align: 'right', cell: (r) => r.est },
  { id: 'true', header: 'True', mono: true, align: 'right', cell: (r) => r.truth },
  { id: 'diff', header: 'Difference', mono: true, align: 'right', cell: (r) => r.diff },
];

const OTHER_COLUMNS: Column<LocTarget>[] = [
  { id: 'node', header: 'Other nodes', cell: (t) => <NodeTag id={targetId(t)} /> },
  { id: 'true', header: 'True (cm)', mono: true, align: 'right', cell: (t) => xyText(t.true, 0) },
  { id: 'est', header: 'Estimated (cm)', mono: true, align: 'right', cell: (t) => xyText(t.est, 1) },
  {
    id: 'err',
    header: 'Error',
    mono: true,
    align: 'right',
    cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{fmt(num(t.err_cm), 1, 'cm')}</span>,
  },
];

/** How the estimate and its error are computed: the weighted centroid of the three anchors. */
const CENTROID = [
  'est   = Σ wᵢ·Pᵢ / Σ wᵢ      wᵢ = 1/dᵢ²',
  'error = | est − true |     (cm)',
];

/* ---------- view ---------- */

export default function R2Localization() {
  const s = useSnapshot();
  const d = s.data;
  const loading = d === null && !s.fetchFailed;

  const loc = localization(d);
  const P = positions(d);
  const mat = bleMatrix(d);
  const targets = arr<LocTarget | null>(loc.targets).filter((t): t is LocTarget => !!t && typeof t === 'object');

  // Map target: the one picked, else the first the sink reports.
  const [want, setWant] = useState<NodeId>(lastTarget);
  const shown = pickTarget(targets, want);
  const switchIds = targets.map(targetId).filter(isNodeId);
  const pick = (id: NodeId) => { lastTarget = id; setWant(id); };

  // Result tiles are for N1, the demo target; the other nodes go in their own table.
  const t1 = targets.find((t) => targetId(t) === 'N1') ?? null;
  const others = targets.filter((t) => targetId(t) !== 'N1');
  const err = t1 ? num(t1.err_cm) : null;

  const ser = series(d);

  return (
    <>
      <ViewHeader view="r2" />
      <div className="grid grid-cols-12 gap-4">
        <Tray title="2-D localization map" className="col-span-12 xl:col-span-8">
          <div className="@container flex flex-col gap-4 xl:h-full">
            <LocMap
              positions={P}
              target={shown.target}
              targetId={shown.id}
              className="xl:aspect-auto xl:max-h-none xl:min-h-[min(90.625cqw,640px)] xl:flex-1"
            />
            <LocMapLegend targetId={shown.id} />
            <TargetSwitch targets={switchIds} value={shown.id} onChange={pick} />
          </div>
        </Tray>

        <Tray title="Localization result" bare className="col-span-12 xl:col-span-4">
          <div className="flex flex-col gap-3">
            {t1 || loading ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <StatTile
                    label="N1 error (demo target)"
                    value={err}
                    decimals={1}
                    unit="cm"
                    tone={toneLo(err, 20, 40)}
                    loading={loading}
                    className="col-span-2 sm:col-span-1"
                  />
                  <StatTile
                    label="True position"
                    value={t1 ? <span className="text-base sm:text-lg">{xyText(t1.true, 0)}</span> : null}
                    size="md"
                    sub="cm"
                    loading={loading}
                  />
                  <StatTile
                    label="Estimated"
                    value={t1 ? <span className="text-base sm:text-lg">{xyText(t1.est, 1)}</span> : null}
                    size="md"
                    sub="cm"
                    loading={loading}
                  />
                </div>
                <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground sm:p-6">
                  N1 sits inside the triangle of its anchors N2, N3, N4, so the weighted centroid works well. The other
                  nodes are corners of the layout: a centroid can never land outside its anchors&apos; hull, so their
                  error is large by construction (shown for completeness).
                </p>
              </>
            ) : (
              <EmptyState
                compact
                title="No localization result yet"
                description="N1's error and its true and estimated positions appear here once the sink has RSSI from three anchors."
              />
            )}

            <section aria-labelledby="r2-formula-title" className="flex flex-col gap-2">
              <div className="px-1 pt-1">
                <h3 id="r2-formula-title" className="tray-title">Distance formula (log-distance path loss)</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Each RSSI is EMA-smoothed first: <span className="font-mono">rssi = 0.7·rssi + 0.3·new</span>.
                </p>
              </div>
              <FormulaBlock lines={formulaLines(mat, pathLoss(loc))} />
            </section>

            <section aria-labelledby="r2-centroid-title" className="flex flex-col gap-2">
              <h3 id="r2-centroid-title" className="tray-title px-1 pt-1">Position and error (weighted centroid)</h3>
              <FormulaBlock lines={CENTROID} />
            </section>
          </div>
        </Tray>

        <Tray title="RSSI matrix (dBm)" className="col-span-12 xl:col-span-6">
          <RssiMatrix matrix={mat} nodes={NODE_IDS} />
        </Tray>

        <Tray title="Nearest node" className="col-span-12 xl:col-span-6">
          <DataTable
            columns={NEAR_COLUMNS}
            rows={nearestRows(d, loc, P, mat)}
            rowKey={(r) => r.id}
            caption="Nearest node by BLE RSSI against the nearest node by true geometry, per node"
            empty="No nodes yet. One row per node appears with its strongest BLE neighbour once the sink reports."
          />
        </Tray>

        <Tray title="Distance estimates" className="col-span-12 xl:col-span-6">
          <DataTable
            columns={DIST_COLUMNS}
            rows={distanceRows(mat, P)}
            rowKey={(r) => r.key}
            caption="Distance estimated from RSSI against the true distance, per directed pair"
            empty="No BLE measurements yet. One row per directed pair appears as the sink reports each node's scan results."
            dense
            stickyHeader
            maxHeight={440}
          />
        </Tray>

        <Tray title="Localization error of N1 over time" meta="cm" className="col-span-12 xl:col-span-6">
          <LocErrChart values={arr<Num>(ser.loc_err_N1)} t={arr<Num>(ser.t)} loading={loading} />
        </Tray>

        <Tray title="Other targets" className="col-span-12">
          <DataTable
            columns={OTHER_COLUMNS}
            rows={others}
            rowKey={(t, i) => `${targetId(t)}-${i}`}
            caption="Localization result of the nodes other than N1: true position, estimate and error"
            empty="No localization result yet. One row per node appears once the sink has located it from its three anchors."
          />
        </Tray>
      </div>
    </>
  );
}
