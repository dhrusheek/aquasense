// #system — the network facts in detail (spec 05 §7.2): what the network is running, what the
// sink reports about itself, how this dashboard is fed, and one row per node.
import type { MouseEvent } from 'react';
import { Download, ExternalLink, RotateCcw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/aq/DataTable';
import { KeyValue } from '@/components/aq/KeyValue';
import { RoutePath } from '@/components/aq/RoutePath';
import { StatusChip } from '@/components/aq/StatusChip';
import { Tray } from '@/components/aq/Tray';
import { ViewHeader } from '@/components/aq/ViewHeader';
import { ThemeToggle } from '@/components/shell/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { NodePattern } from '@/components/viz/NodePattern';
import { isNodeId } from '@/components/viz/patterns';
import { SlotStrip } from '@/components/viz/SlotStrip';
import { BASE, csvUrl } from '@/data/api';
import { useNetNow, useSnapshot } from '@/data/hooks';
import {
  ageNow, currentSlot, derived, isOnline, macAddr, netT, node, nodes, onlineText, schedule, slots, sourceBadge,
  sourceLabel, whenStr,
} from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { NodeState } from '@/data/types';
import { POLL_MS, SHORT_ROLE, TIMEOUT_MS } from '@/lib/constants';
import { fmtAgo, fmtDur } from '@/lib/format';
import { PondLifeRow } from '@/release/PondLifeRow';
import { arr, get, nId, nNum, num } from '@/lib/safe';

const SIDEBAR_KEYS = ['aq-sidebar', 'aq-rubric-open'];
const SOURCE_WORD = { hw: 'Hardware', sim: 'Simulator', mock: 'Preview · mock', none: '—' } as const;

const LINK = 'inline-flex items-center gap-1 font-sans text-[13px] text-foreground underline underline-offset-4 transition-colors duration-150 hover:bg-[var(--ink-4)]';

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/* ---------- Network ---------- */

/** The superframe with its live cursor. Its own component, so only the strip re-renders four times a second. */
function LiveSlots() {
  useNetNow(250);
  const s = useSnapshot();
  const sc = schedule(s);
  return (
    <SlotStrip
      variant="mini"
      slots={slots(s)}
      master={num(sc.master)}
      slotMs={num(sc.slot_ms) || 500}
      current={currentSlot(s)}
      stale={!isOnline(s)}
    />
  );
}

function Network({ s }: { s: Snapshot }) {
  const d = s.data, sc = schedule(s);
  const active = nodes(s).filter((n) => String(n.status).toLowerCase() === 'active').length;
  const master = nNum(get<unknown>(d, 'sched_master', sc.master ?? null));
  const sf = num(get<unknown>(d, 'sf', sc.sf ?? null));
  const slotCount = arr(sc.slots).length, slotMs = num(sc.slot_ms);
  return (
    <KeyValue
      items={[
        { k: 'Active nodes', v: `${active} / 4`, mono: true },
        { k: 'Wi-Fi channel', v: text(get<unknown>(d, 'channel', null)), mono: true },
        { k: 'Scheduler', v: master ? `${nId(master)}${master === 4 ? ' (backup)' : ''}` : '—', mono: true },
        {
          k: 'Superframe', mono: true,
          v: `${sf !== null ? `#${sf}` : '—'} · ${slotCount && slotMs !== null ? `${slotCount} × ${slotMs} ms` : '—'}`,
        },
        { k: 'Schedule', v: sc.ver != null ? `v${sc.ver} · ${sc.why || '—'}` : '—', mono: true },
        { k: 'Slots', v: <LiveSlots /> },
        { k: 'N1 route', v: <RoutePath path={node(s, 'N1').route ?? null} /> },
        { k: 'N2 route', v: <RoutePath path={node(s, 'N2').route ?? null} /> },
        { k: 'N3 route', v: <RoutePath path={node(s, 'N3').route ?? null} /> },
      ]}
    />
  );
}

/* ---------- Sink ---------- */

function Sink({ s }: { s: Snapshot }) {
  const d = s.data;
  const received = derived(s).received_at;
  return (
    <KeyValue
      items={[
        { k: 'Sink', v: d?.sink ? nId(d.sink) : '—', mono: true },
        { k: 'IP', v: text(d?.sink_ip), mono: true },
        { k: 'MAC', v: text(d?.sink_mac), mono: true },
        { k: 'Uptime', v: fmtDur(d?.uptime_s), mono: true },
        { k: 'Last uplink', v: received ? `${whenStr(null, received)} · ${fmtAgo(ageNow(s))}` : '—', mono: true },
        { k: 'Net time', v: netT(d?.net_time), mono: true },
      ]}
    />
  );
}

/* ---------- Dashboard ---------- */

function ExportCsv({ mock }: { mock: boolean }) {
  // Preview mode has no server to export from (same toast as #r8).
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

function ResetLayout() {
  const { setOpen } = useSidebar();
  const reset = () => {
    setOpen(true); // expanded is the default; the provider stores it, so clear the keys afterwards
    try {
      SIDEBAR_KEYS.forEach((k) => window.localStorage.removeItem(k));
    } catch { /* storage blocked: nothing was stored */ }
    toast.success('Sidebar layout reset', { id: 'layout-reset', description: 'Expanded, with the rubric group closed on the next load.' });
  };
  return (
    <Button type="button" variant="outline" size="lg" onClick={reset}>
      <RotateCcw aria-hidden="true" />
      Reset layout
    </Button>
  );
}

function Dashboard({ s }: { s: Snapshot }) {
  const { resolvedTheme } = useTheme();
  const badge = sourceBadge(s);
  return (
    <KeyValue
      className="items-center"
      items={[
        {
          k: 'Data source',
          v: (
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusChip tone="neutral" title={sourceLabel(s)}>{SOURCE_WORD[badge.kind]}</StatusChip>
              {s.mock && <span className="tabular font-mono text-[13px] text-muted-foreground">{s.mockFile}</span>}
            </span>
          ),
        },
        { k: 'Poll', v: `${POLL_MS / 1000} s · timeout ${TIMEOUT_MS / 1000} s`, mono: true },
        { k: 'Status', v: onlineText(s).text },
        {
          k: 'Theme',
          v: (
            <span className="inline-flex items-center gap-2">
              {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
              <ThemeToggle />
            </span>
          ),
        },
        { k: 'Pond life', v: <PondLifeRow /> },
        { k: 'Sidebar', v: <ResetLayout /> },
        { k: 'Export', v: <ExportCsv mock={s.mock} /> },
        {
          k: 'Legacy',
          v: (
            <a href={`${BASE}legacy.html`} className={LINK}>
              Open the legacy dashboard
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ),
        },
      ]}
    />
  );
}

/* ---------- Nodes ---------- */

function NodeStatus({ status }: { status: NodeState['status'] }) {
  const st = String(status || '').toLowerCase();
  if (st === 'active') return <StatusChip tone="ok" dot size="sm">Active</StatusChip>;
  if (st === 'inactive') return <StatusChip tone="bad" dot size="sm">Inactive</StatusChip>;
  return <StatusChip tone="neutral" size="sm">{status ? String(status) : 'Unknown'}</StatusChip>;
}

function nodeColumns(s: Snapshot): Column<NodeState>[] {
  const owners = arr(schedule(s).slots);
  const owned = (n: NodeState) => {
    const k = nNum(n.id ?? n.num);
    return owners.flatMap((o, i) => (num(o) === k ? [i] : []));
  };
  return [
    {
      id: 'node', header: 'Node', mono: true, width: 'w-20',
      cell: (n) => {
        const id = nId(n.id ?? n.num);
        return isNodeId(id) ? <NodePattern id={id} size={12} label /> : id;
      },
    },
    {
      id: 'role', header: 'Role',
      cell: (n) => {
        const id = nId(n.id ?? n.num);
        return <span className="whitespace-nowrap">{n.role || (isNodeId(id) ? SHORT_ROLE[id] : '—')}</span>;
      },
    },
    { id: 'status', header: 'Status', cell: (n) => <NodeStatus status={n.status} /> },
    { id: 'mac', header: 'MAC', mono: true, cell: (n) => <span className="whitespace-nowrap">{macAddr(s, n) || '—'}</span> },
    { id: 'heard', header: 'Last heard', mono: true, cell: (n) => <span className="whitespace-nowrap">{fmtAgo(n.last_seen_s)}</span> },
    {
      id: 'slots', header: 'TDMA slots', mono: true,
      cell: (n) => {
        const mine = owned(n);
        return mine.length ? mine.join(', ') : nNum(n.id ?? n.num) === 4 ? 'listens' : '—';
      },
    },
    { id: 'next', header: 'Next hop', cell: (n) => (nNum(n.id ?? n.num) === 4 ? 'is the sink' : nId(n.next_hop)) },
    { id: 'uptime', header: 'Uptime', mono: true, cell: (n) => <span className="whitespace-nowrap">{fmtDur(n.uptime_s)}</span> },
  ];
}

/* ---------- view ---------- */

export default function System() {
  const s = useSnapshot();
  return (
    <>
      <ViewHeader view="system" />
      {/* A size container: three columns only when each has room for a MAC address on one line. */}
      <div className="@container flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @5xl:grid-cols-3">
          <Tray title="Network" className="@3xl:row-span-2 @5xl:row-span-1">
            <Network s={s} />
          </Tray>
          <Tray title="Sink">
            <Sink s={s} />
          </Tray>
          <Tray title="Dashboard">
            <Dashboard s={s} />
          </Tray>
        </div>
        <Tray title="Nodes">
          <DataTable
            columns={nodeColumns(s)}
            rows={nodes(s)}
            rowKey={(n, i) => `${n.id ?? n.num ?? 'x'}-${i}`}
            caption="One row per node: role, status, address, schedule and route"
            empty="Waiting for the first uplink."
          />
        </Tray>
      </div>
    </>
  );
}
