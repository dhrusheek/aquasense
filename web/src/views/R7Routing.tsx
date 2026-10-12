// #r7 — Adaptive Multi-Hop Routing (port of app.js 1221-1305, spec 03 §3).
// Row 1: the routes on the map, beside the link-failure commands and the route metric.
// Row 2: one route card per node. Row 3: the neighbour tables with the cost of every candidate.
// Row 4: link statistics and the failure / recovery timeline. Row 5: the path trace of the last frames.
import type { ReactNode } from 'react';
import { Check, Star, X } from 'lucide-react';
import { CommandButton } from '@/components/aq/CommandButton';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { EventTimeline, type EventTimelineItem } from '@/components/aq/EventTimeline';
import { FormulaBlock, type FormulaSegment } from '@/components/aq/FormulaBlock';
import { RoutePath } from '@/components/aq/RoutePath';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { NodePattern } from '@/components/viz/NodePattern';
import { PondStage } from '@/components/viz/PondStage';
import { useSnapshot } from '@/data/hooks';
import { derived, link, linkState, netNow, netT, node, tAgo, whenStr } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { Command, EventRow, Link, MsgLogRow, RouteHist, Tone } from '@/data/types';
import { ALL_PAIRS, SHORT_ROLE } from '@/lib/constants';
import { fmt, fmtI } from '@/lib/format';
import { arr, get, nId, nNum, num, obj } from '@/lib/safe';
import { candidates, type Candidate } from './r7/candidates';
import { RouteCard } from './r7/RouteCard';

/* ---------- Row 1: commands and metric ---------- */

// Exact command objects of the legacy buttons (app.js 1248-1249).
const LINK_TESTS: { pair: string; fail: { label: string; command: Command }; restore: { label: string; command: Command } }[] = [
  {
    pair: 'N1–N3',
    fail: { label: 'Simulate link failure N1–N3 (40 s)', command: { c: 'LINK_FAIL', a: 1, b: 3, dur: 40 } },
    restore: { label: 'Restore N1–N3', command: { c: 'LINK_RESTORE', a: 1, b: 3 } },
  },
  {
    pair: 'N2–N3',
    fail: { label: 'Simulate link failure N2–N3 (40 s)', command: { c: 'LINK_FAIL', a: 2, b: 3, dur: 40 } },
    restore: { label: 'Restore N2–N3', command: { c: 'LINK_RESTORE', a: 2, b: 3 } },
  },
];

// A long label may wrap instead of leaving a narrow tray.
const CMD_BUTTON = 'h-auto min-h-10 py-2 whitespace-normal';

function FailureCommands() {
  return (
    <div data-slot="link-commands" className="@container flex flex-col gap-3">
      {LINK_TESTS.map((p) => (
        // one row per link from 512 px of tray width; stacked full-width buttons below that
        <div key={p.pair} role="group" aria-label={`Link ${p.pair}`} className="grid grid-cols-1 gap-2 @lg:grid-cols-[max-content_max-content]">
          <CommandButton label={p.fail.label} command={p.fail.command} variant="destructive" cooldownMs={3000} className={CMD_BUTTON} />
          <CommandButton label={p.restore.label} command={p.restore.command} cooldownMs={3000} className={CMD_BUTTON} />
        </div>
      ))}
    </div>
  );
}

// Verbatim from app.js 1250; the right-hand words are side notes.
const ROUTE_METRIC: FormulaSegment[] = [
  'cost = 10·(hops+1)            ', { dim: 'hops' },
  '\n     + (100 − ACK%) / 5        ', { dim: 'loss' },
  '\n     + max(0, −70 − RSSI) / 2  ', { dim: 'RSSI' },
  '\n     + 20 if a member (N1/N2)  ', { dim: 'prefer CH' },
  '\n       bypasses cluster head N3',
  'next hop  = argmin cost',
  'alternate = 2nd best',
  'link down: 2 failed sends in a row',
  '           or no HELLO for 9 s',
];

/* ---------- Row 2: route per node ---------- */

const ROUTED = ['N1', 'N2', 'N3'] as const;

function RouteCards({ s }: { s: Snapshot }) {
  return (
    <div data-slot="route-cards" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {ROUTED.map((id) => {
        const n = node(s, id);
        const viaAlt = String(n.route || '').indexOf('>2>') > 0 && id === 'N1';
        const alt = nNum(n.alt_next_hop);
        return (
          <RouteCard
            key={id}
            node={id}
            role={SHORT_ROLE[id]}
            routeChip={viaAlt
              ? <StatusChip tone="warn">Alternate route</StatusChip>
              : <StatusChip tone="ok">Primary route</StatusChip>}
            path={n.route ?? null}
            kv={[
              { k: 'Next hop', v: nId(n.next_hop), mono: true },
              { k: 'Hops to sink', v: fmtI(n.hops), mono: true },
              { k: 'Route cost', v: fmt(n.route_cost, 0), mono: true },
              { k: 'Alternate', v: alt ? 'N' + alt + ' · cost ' + fmt(n.alt_cost, 0) : 'none', mono: true },
              { k: 'Forwarded', v: fmtI(n.fwd_count), mono: true },
              { k: 'Out-of-range drops', v: fmtI(n.oor), mono: true },
            ]}
          />
        );
      })}
      <RouteCard node="N4" role="Sink" sub="hops = 0, advertises cost 0" />
    </div>
  );
}

/* ---------- Row 3: neighbour tables ---------- */

function candidateColumns(id: string, nextHop: number | null): Column<Candidate>[] {
  return [
    {
      id: 'via', header: 'Via', mono: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {nextHop === r.nb && (
            <>
              <Star aria-hidden="true" className="size-3.5 fill-current" />
              <span className="sr-only">Chosen next hop: </span>
            </>
          )}
          N{r.nb}
        </span>
      ),
    },
    {
      id: 'link', header: 'Link',
      cell: (r) => (r.st === 'up' ? <StatusChip tone="ok" size="sm">Up</StatusChip>
        : r.st === 'down' ? <StatusChip tone="bad" size="sm">Down</StatusChip>
          : <StatusChip tone="neutral" size="sm">Unseen</StatusChip>),
    },
    { id: 'hops', header: 'Hops', mono: true, align: 'right', cell: (r) => fmtI(r.h) },
    {
      id: 'cost', header: 'Cost', mono: true, align: 'right',
      cell: (r) => (r.cost !== null ? (
        <span className="inline-flex flex-col items-end">
          <b className="font-semibold text-foreground">{fmt(r.cost, 1)}</b>
          <span className="text-[13px] text-muted-foreground">{r.parts}</span>
        </span>
      ) : (
        <span className="font-sans text-[13px] text-muted-foreground">{r.loop ? `loop (routes via ${id})` : 'excluded'}</span>
      )),
    },
  ];
}

function NeighbourTables({ s }: { s: Snapshot }) {
  return (
    <div data-slot="neighbour-tables" className="grid grid-cols-1 gap-x-6 gap-y-8 min-[1800px]:grid-cols-3">
      {ROUTED.map((id) => {
        const nextHop = nNum(node(s, id).next_hop);
        return (
          <div key={id} className="flex min-w-0 flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <NodePattern id={id} size={12} />
              <span><span className="font-mono">{id}</span> neighbour table</span>
            </h3>
            <DataTable
              columns={candidateColumns(id, nextHop)}
              rows={candidates(s, id)}
              rowKey={(r) => `${id}-${r.nb}`}
              rowEmphasis={(r) => nextHop === r.nb}
              caption={`${id} neighbour table: link state, hops to the sink and route cost per candidate next hop`}
              empty={`${id} has no radio neighbours configured. Its candidate next hops appear here with their cost.`}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Row 4: links and timeline ---------- */

type Pair = (typeof ALL_PAIRS)[number];

function linkColumns(s: Snapshot): Column<Pair>[] {
  const l = (p: Pair) => obj<Link>(link(s, p[0], p[1]));
  return [
    { id: 'link', header: 'Link', mono: true, cell: (p) => <b className="font-semibold">N{p[0]}–N{p[1]}</b> },
    {
      id: 'status', header: 'Status',
      cell: (p) => {
        const st = linkState(s, p[0], p[1]);
        return st === 'up' ? <StatusChip tone="ok" size="sm">Up</StatusChip>
          : st === 'down' ? <StatusChip tone="bad" size="sm">{l(p).blocked ? 'Blocked' : 'Down'}</StatusChip>
            : <StatusChip tone="neutral" size="sm">Not seen</StatusChip>;
      },
    },
    { id: 'wifi', header: 'Wi-Fi RSSI', mono: true, align: 'right', cell: (p) => fmt(l(p).wifi_rssi, 0, 'dBm') },
    { id: 'ble', header: 'BLE RSSI', mono: true, align: 'right', cell: (p) => fmt(l(p).ble_rssi, 0, 'dBm') },
    { id: 'ack', header: 'ACK', mono: true, align: 'right', cell: (p) => fmt(l(p).ack_pct, 0, '%') },
  ];
}

/** Route changes from derived.route_history merged with the `route` events, newest first (app.js 1286-1297). */
function timelineItems(s: Snapshot, now: number | null): EventTimelineItem[] {
  const tl: { key: string; t: number | null; when?: unknown; tone: Tone; title: ReactNode; detail?: string }[] = [];
  arr<RouteHist>(derived(s).route_history).forEach((r, i) => {
    const restored = /RESTOR/i.test(r.reason || '');
    tl.push({
      key: `history-${i}`,
      t: num(r.t),
      when: get<unknown>(r, 'received_at', null),
      tone: restored ? 'ok' : 'bad',
      title: (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <b className="font-mono font-semibold">{nId(r.node)}</b>
          <span>route</span>
          <RoutePath path={r.from ?? null} />
          <span aria-hidden="true">→</span>
          <span className="sr-only">changed to</span>
          <RoutePath path={r.to ?? null} />
        </span>
      ),
      detail: r.reason || undefined,
    });
  });
  arr<EventRow>(s.data?.events).forEach((e, i) => {
    if (String(e.type).toLowerCase() !== 'route') return;
    const m = String(e.msg || '');
    tl.push({
      key: `event-${i}`,
      t: num(e.t),
      tone: /DOWN|FAIL/i.test(m) ? 'bad' : /RESTOR|UP/i.test(m) ? 'ok' : 'info',
      title: <><b className="font-mono font-semibold">{nId(e.node)}</b> {m}</>,
    });
  });
  tl.sort((a, b) => (b.t || 0) - (a.t || 0));
  return tl.slice(0, 40).map((x) => ({
    key: x.key,
    t: x.t,
    timeLabel: netT(x.t) + ' · ' + (x.when ? whenStr(now, { received_at: x.when }) : tAgo(now, x.t)),
    tone: x.tone,
    title: x.title,
    detail: x.detail,
  }));
}

/* ---------- Row 5: path trace ---------- */

function traceColumns(now: number | null): Column<MsgLogRow>[] {
  return [
    { id: 'when', header: 'When', mono: true, cell: (m) => <span>{tAgo(now, m.t)}</span> },
    { id: 'type', header: 'Type', cell: (m) => <b className="font-semibold">{m.type}</b> },
    { id: 'hop', header: 'Hop', mono: true, cell: (m) => `${nId(m.from)} → ${nId(m.to)}` },
    { id: 'seq', header: 'Seq', mono: true, align: 'right', cell: (m) => fmtI(m.seq) },
    { id: 'path', header: 'Path so far', cell: (m) => <RoutePath path={m.path ?? null} /> },
    {
      id: 'ack', header: 'ACK',
      cell: (m) => (m.acked === true ? (
        <StatusChip tone="ok" size="sm"><Check aria-hidden="true" className="size-3" strokeWidth={3} /><span className="sr-only">Acknowledged</span></StatusChip>
      ) : m.acked === false ? (
        <StatusChip tone="bad" size="sm"><X aria-hidden="true" className="size-3" strokeWidth={3} /><span className="sr-only">Not acknowledged</span></StatusChip>
      ) : '—'),
    },
  ];
}

/* ---------- view ---------- */

export default function R7Routing() {
  const s = useSnapshot();
  const now = netNow(s);
  const trace = arr<MsgLogRow>(s.data?.msg_log)
    .filter((m) => m.type === 'DATA' || m.type === 'AGG')
    .sort((x, y) => (num(y.t) || 0) - (num(x.t) || 0))
    .slice(0, 10);

  return (
    <>
      <ViewHeader view="r7" />
      <div className="flex flex-col gap-10">
        {/* Row 1 */}
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Routes on the map" className="col-span-12 xl:col-span-7">
            <PondStage showField={false} fill />
          </Tray>
          <div className="col-span-12 flex min-w-0 flex-col gap-4 xl:col-span-5">
            <Tray title="Simulate failure & recovery" description="ACK timeouts → LINK_DOWN → alternate route.">
              <FailureCommands />
            </Tray>
            <Tray title="Route metric (lower is better)" bare className="xl:flex-1">
              <FormulaBlock lines={ROUTE_METRIC} className="text-[12.5px]" />
            </Tray>
          </div>
        </div>

        {/* Row 2 */}
        <Tray title="Route per node" bare>
          <RouteCards s={s} />
        </Tray>

        {/* Row 3 */}
        <Tray
          title="Neighbour tables with cost per candidate"
          description={(
            <>
              <Star aria-hidden="true" className="inline size-3 fill-current align-[-1px]" />
              <span className="sr-only">A star</span> = next hop reported by the node.
            </>
          )}
        >
          <NeighbourTables s={s} />
        </Tray>

        {/* Row 4 */}
        <div className="grid grid-cols-12 gap-4">
          <Tray title="Links" className="col-span-12 lg:col-span-6">
            <DataTable
              columns={linkColumns(s)}
              rows={ALL_PAIRS.slice(0, 5)}
              rowKey={(p) => `${p[0]}-${p[1]}`}
              caption="Link statistics for the five radio links: status, Wi-Fi RSSI, BLE RSSI and ACK ratio"
              empty="No links configured. Each radio link appears here with its RSSI and ACK ratio."
            />
          </Tray>
          <Tray title="Failure / recovery timeline" className="col-span-12 lg:col-span-6">
            <EventTimeline
              items={timelineItems(s, now)}
              max={40}
              label="Route failures and recoveries, newest first"
              emptyText="No route changes yet. Press “Simulate link failure”."
            />
          </Tray>
        </div>

        {/* Row 5 */}
        <Tray
          title="Path trace of the last 10 data packets"
          description="The path field grows as each relay forwards the frame."
        >
          <DataTable
            columns={traceColumns(now)}
            rows={trace}
            rowKey={(m, i) => `${m.t ?? 'x'}-${m.type ?? ''}-${m.seq ?? ''}-${i}`}
            caption="Path trace of the ten newest DATA and AGG frames, newest first"
            empty="No DATA / AGG frames yet. The ten newest data and aggregate frames seen by the sink appear here with the path they took."
          />
        </Tray>
      </div>
    </>
  );
}
