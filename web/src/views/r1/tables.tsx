// The three tables of the r1 view: status light history, addressing and allowed topology
// (port of app.js 674-688 and 694-698).
import { DataTable, type Column } from '@/components/aq/DataTable';
import { StatusChip } from '@/components/aq/StatusChip';
import { NodePattern } from '@/components/viz/NodePattern';
import { linkState, macAddr, netT, node, whenStr } from '@/data/selectors';
import type { Snapshot } from '@/data/store';
import type { LightHist, LightState, NodeId, NodeNum } from '@/data/types';
import { ALLOWED, ALL_PAIRS, LIGHT, NODE_IDS } from '@/lib/constants';
import { nNum } from '@/lib/safe';

/** An 18 px identity swatch; the id is written beside it, so the swatch itself is decorative. */
function Swatch({ id }: { id: NodeId }) {
  return (
    <span aria-hidden="true" className="flex shrink-0">
      <NodePattern id={id} size={18} />
    </span>
  );
}

/* ---------- D · status light history ---------- */

function lightState(x: unknown): LightState {
  const st = String(x || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LIGHT, st) ? (st as LightState) : 'off';
}

export interface LightHistoryTableProps {
  /** derived.light_history, newest first. */
  rows: LightHist[];
  /** Network clock in ms, for rows without a server receive time. */
  now: number | null;
}

export function LightHistoryTable({ rows, now }: LightHistoryTableProps) {
  const columns: Column<LightHist>[] = [
    { id: 't', header: 'Network time', mono: true, width: 'w-36', cell: (h) => netT(h.t) },
    { id: 'received', header: 'Received', mono: true, width: 'w-32', cell: (h) => whenStr(now, h) },
    {
      id: 'state', header: 'State', width: 'w-52',
      cell: (h) => {
        const st = lightState(h.state);
        return <StatusChip tone={LIGHT[st].tone} size="sm">{LIGHT[st].label}</StatusChip>;
      },
    },
    {
      id: 'reason', header: 'Reason',
      cell: (h) => <span className="block min-w-40 whitespace-normal">{h.reason || '—'}</span>,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(h, i) => `${h.t ?? 'x'}-${h.state ?? ''}-${i}`}
      caption="Changes of the pond status light reported by the sink, newest first"
      empty="No light changes yet. The sink reports the light with every uplink; each change of state is listed here."
      stickyHeader
      maxHeight={440}
    />
  );
}

/* ---------- E · addressing ---------- */

interface AddressRow {
  key: string;
  /** Null for the broadcast row. */
  node: NodeId | null;
  label: string;
  id: number;
  ble: string;
  mac: string;
  ip: string;
  slot: string;
}

export interface AddressingTableProps {
  s: Snapshot;
  /** Indices of the TDMA slots each node owns. */
  owned: Record<NodeId, number[]>;
  /** The sink's IP on the hotspot, or "—". */
  sinkIp: string;
}

export function AddressingTable({ s, owned, sinkIp }: AddressingTableProps) {
  const rows: AddressRow[] = NODE_IDS.map((id) => {
    const k = nNum(id) as number;
    const own = owned[id];
    return {
      key: id,
      node: id,
      label: id,
      id: k,
      ble: `WSN-N${k}`,
      mac: macAddr(s, { ...node(s, id), id }) || '—',
      ip: id === 'N4' ? sinkIp : '—',
      slot: own.length ? own.join(', ') : '—',
    };
  });
  rows.push({ key: 'all', node: null, label: 'All', id: 0, ble: '—', mac: 'FF:FF:FF:FF:FF:FF', ip: '—', slot: 'broadcast' });

  const columns: Column<AddressRow>[] = [
    {
      id: 'node', header: 'Node', mono: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          {r.node ? <Swatch id={r.node} /> : <span aria-hidden="true" className="size-[18px] shrink-0" />}
          {r.label}
        </span>
      ),
    },
    { id: 'id', header: 'ID', mono: true, cell: (r) => r.id },
    { id: 'ble', header: 'BLE name', mono: true, cell: (r) => r.ble },
    { id: 'mac', header: 'ESP-NOW MAC', mono: true, cell: (r) => r.mac },
    { id: 'ip', header: 'IP', mono: true, cell: (r) => r.ip },
    { id: 'slot', header: 'Slot', mono: true, cell: (r) => r.slot },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      caption="Logical ID, BLE name, ESP-NOW MAC, IP address and TDMA slot of each node, and the broadcast address"
      empty="No addresses yet. Each node gets a row with its ID, BLE name, MAC, IP and slot once it is configured."
    />
  );
}

/* ---------- F · allowed topology ---------- */

const LINK_NOTE: Record<string, string> = {
  '1-2': 'alternate path for N1',
  '1-3': 'N1 primary to cluster head',
  '2-3': 'N2 primary to cluster head',
  '2-4': 'N2 alternate direct to sink',
  '3-4': 'cluster head → sink (AGG)',
  '1-4': 'N1 must multi-hop to reach the sink',
};

interface PairRow {
  a: NodeNum;
  b: NodeNum;
  /** In simulated radio range of each other. */
  allowed: boolean;
  state: 'up' | 'down' | 'unknown';
}

export function AllowedTopologyTable({ s }: { s: Snapshot }) {
  const rows: PairRow[] = ALL_PAIRS.map(([a, b]) => ({
    a, b, allowed: ALLOWED[a].includes(b), state: linkState(s, a, b),
  }));

  const columns: Column<PairRow>[] = [
    {
      id: 'link', header: 'Link', mono: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          <span className="inline-flex items-center gap-1">
            <Swatch id={`N${r.a}`} />
            <Swatch id={`N${r.b}`} />
          </span>
          N{r.a}–N{r.b}
        </span>
      ),
    },
    {
      id: 'allowed', header: 'Allowed',
      cell: (r) => (r.allowed
        ? <StatusChip tone="ok" size="sm">Yes</StatusChip>
        : <StatusChip tone="bad" size="sm">No</StatusChip>),
    },
    {
      id: 'status', header: 'Status now',
      cell: (r) => {
        if (!r.allowed) return <span className="font-mono text-muted-foreground">—</span>;
        if (r.state === 'up') return <StatusChip tone="ok" size="sm">Up</StatusChip>;
        if (r.state === 'down') return <StatusChip tone="bad" size="sm">Down / blocked</StatusChip>;
        return <StatusChip tone="neutral" size="sm">Not seen</StatusChip>;
      },
    },
    {
      id: 'note', header: 'Note',
      cell: (r) => (
        <span className="block min-w-44 text-[13px] whitespace-normal text-muted-foreground">{LINK_NOTE[`${r.a}-${r.b}`] ?? '—'}</span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.a}-${r.b}`}
      caption="Node pairs, whether each is in simulated radio range, and the live state of the link"
      empty="No node pairs are defined. Each pair of nodes is listed here with whether it is allowed and its live link status."
    />
  );
}
